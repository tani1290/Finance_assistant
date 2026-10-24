import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'secure_store.dart';

/// Owns the FinPro session credentials and the cached profile.
///
/// Credentials live in the platform keystore. Older builds wrote them to
/// plain-text SharedPreferences (`finpro_*`); those values are migrated on
/// first read and removed only after the secure replacement is confirmed. A
/// failed secure write therefore never destroys the sole usable credential.
class TokenStorage {
  static const _accessTokenKey = 'finpro_access_token';
  static const _refreshTokenKey = 'finpro_refresh_token';
  static const _userIdKey = 'finpro_user_id';
  static const _userEmailKey = 'finpro_user_email';
  static const _userNameKey = 'finpro_user_name';

  /// Every key FinPro owns. Used by [clearAll] so signing out cannot wipe
  /// unrelated secure entries shared by other app components.
  static const _ownedKeys = [
    _accessTokenKey,
    _refreshTokenKey,
    _userIdKey,
    _userEmailKey,
    _userNameKey,
  ];

  static SecureStore _store = const FlutterSecureStore();

  /// Session-only cache. Lets the current launch keep working if the platform
  /// keystore rejects a write, without ever persisting credentials in plain
  /// text in a release build.
  static String? _accessTokenInMemory;
  static String? _refreshTokenInMemory;

  @visibleForTesting
  static void useSecureStoreForTesting(SecureStore store) {
    _store = store;
  }

  @visibleForTesting
  static void resetSecureStoreForTesting() {
    _store = const FlutterSecureStore();
  }

  @visibleForTesting
  static void resetSessionCacheForTesting() {
    _accessTokenInMemory = null;
    _refreshTokenInMemory = null;
  }

  static Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
    String? userId,
    String? email,
    String? name,
  }) async {
    _accessTokenInMemory = accessToken;
    _refreshTokenInMemory = refreshToken;

    final prefs = await SharedPreferences.getInstance();

    final accessPersisted = await _writeSecure(_accessTokenKey, accessToken);
    final refreshPersisted = await _writeSecure(_refreshTokenKey, refreshToken);

    // A cloud-restored SharedPreferences backup can bring back an old token.
    // Delete the plain-text copy only once its secure replacement is on disk.
    if (accessPersisted) await _removeLegacy(prefs, _accessTokenKey);
    if (refreshPersisted) await _removeLegacy(prefs, _refreshTokenKey);

    // Debug builds keep an emulator fallback so local testing survives a
    // broken keystore. Release builds fail secure: the session stays in memory
    // only and is dropped on restart.
    if (kDebugMode) {
      if (!accessPersisted) {
        await _writeLegacy(prefs, _accessTokenKey, accessToken);
      }
      if (!refreshPersisted) {
        await _writeLegacy(prefs, _refreshTokenKey, refreshToken);
      }
    }

    // The profile is personally identifiable, so it lives in secure storage
    // alongside the tokens rather than in plain-text SharedPreferences. A
    // failed write only skips the cache; it is never downgraded to plaintext.
    if (userId != null) {
      await _saveProfileField(prefs, _userIdKey, userId);
    }
    if (email != null) {
      await _saveProfileField(prefs, _userEmailKey, email);
    }
    if (name != null) {
      await _saveProfileField(prefs, _userNameKey, name);
    }
  }

  static Future<String?> getAccessToken() async {
    if (_accessTokenInMemory != null) return _accessTokenInMemory;

    final migrated = await _readOrMigrate(_accessTokenKey);
    if (migrated == null) return null;
    _accessTokenInMemory = migrated;
    return migrated;
  }

  static Future<String?> getRefreshToken() async {
    if (_refreshTokenInMemory != null) return _refreshTokenInMemory;

    final migrated = await _readOrMigrate(_refreshTokenKey);
    if (migrated == null) return null;
    _refreshTokenInMemory = migrated;
    return migrated;
  }

  static Future<Map<String, String?>> getUserData() async {
    String? userId;
    String? email;
    String? name;
    var secureReadFailed = false;
    try {
      userId = await _store.read(_userIdKey);
      email = await _store.read(_userEmailKey);
      name = await _store.read(_userNameKey);
    } catch (_) {
      // Secure storage unavailable: read what can be read and only fall back
      // to plaintext for the fields that have no secure value.
      secureReadFailed = true;
    }

    final prefs = await SharedPreferences.getInstance();
    userId = await _reconcileProfile(
      prefs,
      _userIdKey,
      userId,
      secureReadFailed: secureReadFailed,
    );
    email = await _reconcileProfile(
      prefs,
      _userEmailKey,
      email,
      secureReadFailed: secureReadFailed,
    );
    name = await _reconcileProfile(
      prefs,
      _userNameKey,
      name,
      secureReadFailed: secureReadFailed,
    );

    return {'userId': userId, 'email': email, 'name': name};
  }

  static Future<void> clearAll() async {
    _accessTokenInMemory = null;
    _refreshTokenInMemory = null;

    // Delete key by key rather than `deleteAll()`: the secure store may hold
    // entries owned by other parts of the app.
    for (final key in _ownedKeys) {
      try {
        await _store.delete(key);
      } catch (_) {
        // Best-effort. In-memory values are already cleared, and the legacy
        // copies below are still purged.
      }
    }

    // Always purge the legacy plain-text keys, even in release builds, so an
    // upgrade removes credentials written by older versions.
    try {
      final prefs = await SharedPreferences.getInstance();
      for (final key in _ownedKeys) {
        await _removeLegacy(prefs, key);
      }
    } catch (_) {
      // The legacy store is best-effort too; a failure here must not prevent
      // sign-out from completing.
    }
  }

  /// Reads a credential from secure storage, falling back to the legacy
  /// plain-text value in debug builds and migrating it when possible.
  static Future<String?> _readOrMigrate(String key) async {
    var secureReadFailed = false;
    try {
      final secureValue = await _store.read(key);
      if (secureValue != null && secureValue.isNotEmpty) {
        // The secure value is authoritative; any plaintext copy is redundant.
        await _removeLegacyPref(key);
        return secureValue;
      }
    } catch (_) {
      secureReadFailed = true;
    }

    final prefs = await SharedPreferences.getInstance();
    final legacyValue = prefs.getString(key);
    if (legacyValue == null || legacyValue.isEmpty) return null;

    if (!kDebugMode) {
      // Release builds never read plaintext credentials, so this is dead data
      // from an older build. Remove it instead of leaving it at rest.
      await _removeLegacy(prefs, key);
      return null;
    }

    if (!secureReadFailed) {
      // Move the token into the keystore, then delete the plaintext copy only
      // after the write succeeds. On failure the plaintext copy is kept for a
      // later migration attempt.
      if (await _writeSecure(key, legacyValue)) {
        await _removeLegacy(prefs, key);
      }
    }

    // Keep the session usable for this launch even if the keystore is
    // currently unavailable.
    return legacyValue;
  }

  static Future<String?> _reconcileProfile(
    SharedPreferences prefs,
    String key,
    String? secureValue, {
    required bool secureReadFailed,
  }) async {
    final legacyValue = prefs.getString(key);
    final hasSecureValue = secureValue != null && secureValue.isNotEmpty;

    if (hasSecureValue) {
      if (legacyValue != null) await _removeLegacy(prefs, key);
      return secureValue;
    }

    if (legacyValue == null || legacyValue.isEmpty) return null;

    if (!kDebugMode) {
      await _removeLegacy(prefs, key);
      return null;
    }

    if (secureReadFailed) {
      // Do not write while the current secure state is unknown: a stale
      // plaintext value could overwrite a newer secure one.
      return legacyValue;
    }

    if (await _writeSecure(key, legacyValue)) {
      await _removeLegacy(prefs, key);
    }
    return legacyValue;
  }

  static Future<void> _saveProfileField(
    SharedPreferences prefs,
    String key,
    String value,
  ) async {
    // The profile is a cache, not a credential. Always drop the plaintext copy
    // so a previous user's name/email can never be served from an old value,
    // even if the keystore write fails.
    await _writeSecure(key, value);
    await _removeLegacy(prefs, key);
  }

  static Future<bool> _writeSecure(String key, String value) async {
    try {
      await _store.write(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<void> _writeLegacy(
    SharedPreferences prefs,
    String key,
    String value,
  ) async {
    try {
      await prefs.setString(key, value);
    } catch (_) {
      // The in-memory session still works for this launch.
    }
  }

  static Future<void> _removeLegacy(
    SharedPreferences prefs,
    String key,
  ) async {
    try {
      await prefs.remove(key);
    } catch (_) {
      // A failed purge is retried on the next read or sign-out.
    }
  }

  static Future<void> _removeLegacyPref(String key) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await _removeLegacy(prefs, key);
    } catch (_) {
      // Best-effort; the secure value is already authoritative.
    }
  }
}
