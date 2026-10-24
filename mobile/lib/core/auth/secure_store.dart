import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Thin seam over the platform keystore.
///
/// Production code uses [FlutterSecureStore]. Tests inject an in-memory
/// implementation so keystore failures (locked device, missing plugin, denied
/// keychain access) can be exercised without platform channels.
abstract class SecureStore {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

/// The real secure-storage implementation backed by the platform keystore.
class FlutterSecureStore implements SecureStore {
  const FlutterSecureStore();

  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}
