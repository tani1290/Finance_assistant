import 'package:finpro_mobile/core/auth/secure_store.dart';
import 'package:finpro_mobile/core/auth/token_storage.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// In-memory [SecureStore] so keystore failures can be exercised without
/// platform channels.
class _FakeSecureStore implements SecureStore {
  _FakeSecureStore({Map<String, String>? initial})
    : values = {...?initial};

  final Map<String, String> values;
  bool failReads = false;
  bool failWrites = false;
  int writes = 0;

  @override
  Future<String?> read(String key) async {
    if (failReads) throw StateError('keystore unavailable');
    return values[key];
  }

  @override
  Future<void> write(String key, String value) async {
    if (failWrites) throw StateError('keystore unavailable');
    writes++;
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    TokenStorage.resetSecureStoreForTesting();
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    await TokenStorage.clearAll();
  });

  test('saveTokens keeps tokens in memory and stores profile fields', () async {
    await TokenStorage.saveTokens(
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      userId: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
    );

    expect(await TokenStorage.getAccessToken(), 'access-123');
    expect(await TokenStorage.getRefreshToken(), 'refresh-456');

    final user = await TokenStorage.getUserData();
    expect(user['userId'], 'user-1');
    expect(user['email'], 'user@example.com');
    expect(user['name'], 'Test User');
  });

  test(
    'clearAll purges legacy plain-text credentials and profile data',
    () async {
      SharedPreferences.setMockInitialValues({
        'finpro_access_token': 'legacy-access',
        'finpro_refresh_token': 'legacy-refresh',
        'finpro_user_id': 'legacy-user',
        'finpro_user_email': 'legacy@example.com',
        'finpro_user_name': 'Legacy User',
      });
      final prefs = await SharedPreferences.getInstance();

      await TokenStorage.clearAll();

      expect(prefs.getString('finpro_access_token'), isNull);
      expect(prefs.getString('finpro_refresh_token'), isNull);
      expect(prefs.getString('finpro_user_id'), isNull);
      expect(prefs.getString('finpro_user_email'), isNull);
      expect(prefs.getString('finpro_user_name'), isNull);
    },
  );

  test(
    'clearAll drops the in-memory session so tokens cannot be reused',
    () async {
      await TokenStorage.saveTokens(
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
      );
      expect(await TokenStorage.getAccessToken(), isNotNull);

      await TokenStorage.clearAll();

      expect(await TokenStorage.getAccessToken(), isNull);
      expect(await TokenStorage.getRefreshToken(), isNull);
    },
  );

  test('saveTokens no longer writes the profile to plain-text prefs', () async {
    await TokenStorage.saveTokens(
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      userId: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
    );

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('finpro_user_id'), isNull);
    expect(prefs.getString('finpro_user_email'), isNull);
    expect(prefs.getString('finpro_user_name'), isNull);

    // The profile is still readable, from secure storage.
    final user = await TokenStorage.getUserData();
    expect(user['userId'], 'user-1');
  });

  test(
    'getUserData migrates a legacy plain-text profile into secure storage',
    () async {
      SharedPreferences.setMockInitialValues({
        'finpro_user_id': 'legacy-user',
        'finpro_user_email': 'legacy@example.com',
        'finpro_user_name': 'Legacy User',
      });
      const secure = FlutterSecureStorage();

      final user = await TokenStorage.getUserData();

      expect(user['userId'], 'legacy-user');
      expect(user['email'], 'legacy@example.com');
      expect(user['name'], 'Legacy User');

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('finpro_user_id'), isNull);
      expect(prefs.getString('finpro_user_email'), isNull);
      expect(prefs.getString('finpro_user_name'), isNull);

      expect(await secure.read(key: 'finpro_user_id'), 'legacy-user');
      expect(await secure.read(key: 'finpro_user_email'), 'legacy@example.com');
      expect(await secure.read(key: 'finpro_user_name'), 'Legacy User');

      // A second read now comes straight from secure storage.
      final again = await TokenStorage.getUserData();
      expect(again['email'], 'legacy@example.com');
    },
  );

  test('a fresh install has no credentials and writes none to plain text', () async {
    final store = _FakeSecureStore();
    TokenStorage.useSecureStoreForTesting(store);
    SharedPreferences.setMockInitialValues({});

    expect(await TokenStorage.getAccessToken(), isNull);
    expect(await TokenStorage.getRefreshToken(), isNull);
    final user = await TokenStorage.getUserData();
    expect(user.values.every((value) => value == null), isTrue);
    expect(store.values, isEmpty);
  });

  test(
    'saveTokens removes the legacy plain-text token once the secure write succeeds',
    () async {
      final store = _FakeSecureStore();
      TokenStorage.useSecureStoreForTesting(store);
      SharedPreferences.setMockInitialValues({
        'finpro_access_token': 'legacy-access',
        'finpro_refresh_token': 'legacy-refresh',
      });

      await TokenStorage.saveTokens(
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      );

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('finpro_access_token'), isNull);
      expect(prefs.getString('finpro_refresh_token'), isNull);
      expect(store.values['finpro_access_token'], 'new-access');
      expect(store.values['finpro_refresh_token'], 'new-refresh');
    },
  );

  test(
    'a legacy token is migrated into secure storage, then the plain-text copy is removed',
    () async {
      final store = _FakeSecureStore();
      TokenStorage.useSecureStoreForTesting(store);
      SharedPreferences.setMockInitialValues({
        'finpro_refresh_token': 'legacy-refresh',
      });

      expect(await TokenStorage.getRefreshToken(), 'legacy-refresh');

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('finpro_refresh_token'), isNull);
      expect(store.values['finpro_refresh_token'], 'legacy-refresh');

      // A later launch reads straight from the keystore instead of re-writing.
      TokenStorage.resetSessionCacheForTesting();
      expect(await TokenStorage.getRefreshToken(), 'legacy-refresh');
      expect(store.writes, 1);
    },
  );

  test(
    'a failed secure write keeps the legacy token so the credential is not lost',
    () async {
      final store = _FakeSecureStore()..failWrites = true;
      TokenStorage.useSecureStoreForTesting(store);
      SharedPreferences.setMockInitialValues({
        'finpro_access_token': 'legacy-access',
      });

      expect(await TokenStorage.getAccessToken(), 'legacy-access');

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('finpro_access_token'), 'legacy-access');
      expect(store.values['finpro_access_token'], isNull);
    },
  );

  test(
    'a secure read failure never overwrites the stored profile with stale plain text',
    () async {
      final store =
          _FakeSecureStore(
              initial: {
                'finpro_user_id': 'secure-user',
                'finpro_user_email': 'secure@example.com',
                'finpro_user_name': 'Secure User',
              },
            )
            ..failReads = true;
      TokenStorage.useSecureStoreForTesting(store);
      SharedPreferences.setMockInitialValues({
        'finpro_user_id': 'stale-user',
        'finpro_user_email': 'stale@example.com',
        'finpro_user_name': 'Stale User',
      });

      await TokenStorage.getUserData();

      // Unknown secure state: nothing written, existing values intact.
      expect(store.writes, 0);
      expect(store.values['finpro_user_id'], 'secure-user');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('finpro_user_id'), 'stale-user');
    },
  );

  test('clearAll deletes only FinPro keys and preserves unrelated entries', () async {
    final store = _FakeSecureStore(
      initial: {
        'unrelated_key': 'keep-me',
        'finpro_access_token': 'access',
        'finpro_refresh_token': 'refresh',
      },
    );
    TokenStorage.useSecureStoreForTesting(store);

    await TokenStorage.clearAll();

    expect(store.values['unrelated_key'], 'keep-me');
    expect(store.values.containsKey('finpro_access_token'), isFalse);
    expect(store.values.containsKey('finpro_refresh_token'), isFalse);
  });
}
