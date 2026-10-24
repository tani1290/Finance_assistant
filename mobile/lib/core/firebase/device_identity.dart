import 'dart:math';

import '../auth/secure_store.dart';

/// A stable, privacy-conscious identifier for this app installation.
///
/// The backend keys push tokens by `(userId, deviceId)`, so every install
/// needs a value that survives restarts but is not derived from hardware
/// identifiers. This id is random (128 bits) and scoped to FinPro; it is
/// stored in the platform keystore and never logged.
class DeviceIdentity {
  DeviceIdentity({SecureStore? store})
    : _store = store ?? const FlutterSecureStore();

  static final DeviceIdentity instance = DeviceIdentity();

  static const storageKey = 'finpro_device_id';
  static const _prefix = 'finpro-';
  static const _entropyBytes = 16;

  final SecureStore _store;
  String? _cached;
  Future<String>? _inFlight;

  /// Returns the persisted installation id, creating one on first use.
  ///
  /// Concurrent callers share a single resolution, so two registrations started
  /// together cannot mint different ids.
  Future<String> getOrCreate() {
    final cached = _cached;
    if (cached != null) return Future.value(cached);
    return _inFlight ??= _resolveWhenComplete();
  }

  Future<String> _resolveWhenComplete() {
    final future = _resolve();
    return future.whenComplete(() => _inFlight = null);
  }

  Future<String> _resolve() async {
    try {
      final existing = await _store.read(storageKey);
      final trimmed = existing?.trim();
      if (trimmed != null && trimmed.isNotEmpty) {
        return _cached = trimmed;
      }
    } catch (_) {
      // Keystore unavailable: mint a process-scoped id below so registration
      // can still be attempted. A later launch may persist a new one.
    }

    final id = '$_prefix${_randomHex(_entropyBytes)}';
    _cached = id;
    try {
      await _store.write(storageKey, id);
    } catch (_) {
      // Keep the in-memory id for this launch; push registration is
      // best-effort and retried on the next token refresh.
    }
    return id;
  }

  static String _randomHex(int bytes) {
    final random = Random.secure();
    final buffer = StringBuffer();
    for (var i = 0; i < bytes; i++) {
      buffer.write(random.nextInt(256).toRadixString(16).padLeft(2, '0'));
    }
    return buffer.toString();
  }
}
