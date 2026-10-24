import 'package:finpro_mobile/core/auth/secure_store.dart';
import 'package:finpro_mobile/core/firebase/device_identity.dart';
import 'package:flutter_test/flutter_test.dart';

/// In-memory [SecureStore] so keystore failure paths can be exercised without
/// platform channels.
class _MemoryStore implements SecureStore {
  _MemoryStore({Map<String, String>? initial}) : values = {...?initial};

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
  test('creates a random, prefixed id when none is stored', () async {
    final store = _MemoryStore();
    final identity = DeviceIdentity(store: store);

    final id = await identity.getOrCreate();

    expect(id, startsWith('finpro-'));
    expect(RegExp(r'^finpro-[0-9a-f]{32}$').hasMatch(id), isTrue);
    expect(store.values[DeviceIdentity.storageKey], id);
  });

  test('reuses the persisted id across instances', () async {
    final store = _MemoryStore();

    final first = await DeviceIdentity(store: store).getOrCreate();
    final second = await DeviceIdentity(store: store).getOrCreate();

    expect(second, first);
    expect(store.writes, 1);
  });

  test('concurrent callers share a single id and a single write', () async {
    final store = _MemoryStore();
    final identity = DeviceIdentity(store: store);

    final ids = await Future.wait([
      identity.getOrCreate(),
      identity.getOrCreate(),
      identity.getOrCreate(),
    ]);

    expect(ids.toSet(), hasLength(1));
    expect(store.writes, 1);
  });

  test(
    'a keystore read failure still yields a usable id without throwing',
    () async {
      final store = _MemoryStore()..failReads = true;
      final identity = DeviceIdentity(store: store);

      final id = await identity.getOrCreate();

      expect(id, startsWith('finpro-'));
    },
  );

  test('a keystore write failure keeps the id in memory for this launch', () async {
    final store = _MemoryStore()..failWrites = true;
    final identity = DeviceIdentity(store: store);

    final id = await identity.getOrCreate();

    expect(id, startsWith('finpro-'));
    expect(await identity.getOrCreate(), id);
  });
}
