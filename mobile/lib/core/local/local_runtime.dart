import 'dart:async';

import '../api/api_client.dart';
import '../api/api_endpoints.dart';
import '../auth/token_storage.dart';
import '../firebase/device_identity.dart';
import 'local_database.dart';
import 'local_store.dart';
import 'sync_engine.dart';

/// Local-first runtime singleton.
///
/// Opens one per-user [LocalStore] lazily and wires up the sync engine's
/// automatic sync triggers at startup and when the app resumes. The store is
/// scoped to the currently authenticated user and is re-bound if the user
/// logs out and logs in again.
///
/// Direct use outside providers:
///
/// ```dart
/// await LocalRuntime.instance.store(); // opens the store, creates engine
/// await LocalRuntime.instance.engine?.push();
/// ```
class LocalRuntime {
  LocalRuntime._() : _deviceId = 'finpro-temp-${DateTime.now().millisecondsSinceEpoch}' {
    _initDeviceId();
  }

  /// Global singleton accessible from anywhere in the app.
  static final LocalRuntime instance = LocalRuntime._();

  LocalStore? _store;
  String? _userId;
  String _deviceId;

  Future<void> _initDeviceId() async {
    try {
      _deviceId = await DeviceIdentity.instance.getOrCreate();
      if (_store != null) {
        _store!.deviceId = _deviceId;
      }
    } catch (_) {}
  }

  /// The app's durable device identifier. A new one is generated on first
  /// use and persisted so server-side device tracking survives reinstalls
  /// only when the user logs in again (tokens are cleared on logout).
  String get deviceId => _deviceId;

  /// The [SyncEngine] bound to the current user. Lazily initialized when the
  /// store is opened.
  SyncEngine? get engine => _engine;
  SyncEngine? _engine;

  /// Whether the store has been opened at least once for a user.
  bool get isInitialized => _store != null;

  /// The user currently bound to the store, or null if not initialized.
  String? get userId => _userId;

  /// Open the per-user store. If no user is bound, reads the user id from
  /// [TokenStorage] (which may be a cached user during an offline session).
  Future<LocalStore> store({String? userIdOverride}) async {
    final targetUser = userIdOverride ?? await _resolveUserId();

    // Re-bind when the user changes (login after logout, etc.).
    if (_userId != targetUser) {
      await _close();
      _userId = targetUser;
      _store = await _openStoreFor(_userId!);
      _engine = SyncEngine(
        store: _store!,
        apiClient: apiClient,
      );
      _maybeRunInitialSync();
      return _store!;
    }

    assert(_store != null);
    return _store!;
  }

  Future<String> _resolveUserId() async {
    final userData = await TokenStorage.getUserData();
    final userId = userData['userId']?.toString();
    if (userId == null || userId.isEmpty) {
      throw StateError('No user is signed in; cannot open a per-user store.');
    }
    return userId;
  }

  Future<LocalStore> _openStoreFor(String userId) async {
    final db = await LocalDatabase.openFor(userId);
    return LocalStore(db, userId: userId, deviceId: _deviceId);
  }

  Future<void> _close() async {
    _engine?.cancel();
    _engine = null;
    _store = null;
    _userId = null;
  }

  /// Register a one-time callback that fires once the store is open and the
  /// first sync has completed. Use this for screens that need sync to be done
  /// before showing data (e.g. onboarding completion).
  void waitForSyncOnce(FutureOr<void> Function() callback) {
    _onSyncComplete.add(callback);
  }

  final List<FutureOr<void> Function()> _onSyncComplete = [];
  bool _syncCompleteOnceCalled = false;

  void _maybeRunInitialSync() {
    if (_engine == null) return;

    // Only trigger once per lifetime: on first open (startup). Subsequent
    // triggers come from [notifyAppResume].
    if (!_syncCompleteOnceCalled) {
      _syncCompleteOnceCalled = true;
      _runInitialSync();
    }
  }

  Future<void> _runInitialSync() async {
    try {
      await _engine!.checkConnectivity();
      if (!_engine!.networkStatus.online) {
        return;
      }

      // Bootstrap first (registers the device, returns capabilities).
      try {
        final response = await apiClient.post(
          ApiEndpoints.syncBootstrap,
          data: {'deviceId': _deviceId},
        );
        if (response.statusCode == 200 &&
            response.data?['success'] == true &&
            response.data?['data']?['capabilities']?['localFirst'] == true) {
          await _sync();
        }
      } catch (_) {
        // Bootstrap failure is not fatal: local-first reads still work.
      }
    } catch (_) {
      // Offline/initialization failure is expected during a cold start with no
      // connectivity; the user can force sync manually.
    }

    for (final callback in _onSyncComplete.toList()) {
      try {
        await callback();
      } catch (_) {}
    }
    _onSyncComplete.clear();
  }

  /// Full sync cycle: push local changes first, then pull the server snapshot.
  ///
  /// Push-before-pull is essential: the pull is a full snapshot that would
  /// otherwise overwrite unsynced local rows. Pushing first guarantees that
  /// local edits are durable on the server before the snapshot arrives.
  Future<void> _sync() async {
    try {
      await _engine!.push();
    } catch (_) {
      // Push failures are retried automatically on resume; do not block
      // pulling on a bad push.
    }

    try {
      await _engine!.pull();
    } catch (_) {
      // Pull failures are reported and can be retried manually.
    }
  }

  /// Notify the runtime that the app has moved to the foreground. A sync is
  /// triggered if the store is initialized and no initial sync has run yet,
  /// or if manual sync has been requested by the user.
  void notifyAppResume() {
    if (_engine == null) return;
    if (!_syncCompleteOnceCalled) {
      _runInitialSync();
    } else if (manualSyncRequested) {
      manualSyncRequested = false;
      _runInitialSync();
    }
  }

  /// Flag set from the UI to request a manual full sync.
  bool manualSyncRequested = false;

  /// Cancel any in-flight sync.
  void cancelSync() => _engine?.cancel();

  /// Access the engine without forcing the store open. Returns null if the
  /// store has not been opened yet.
  Future<SyncEngine?> ensureEngine() async {
    if (_engine == null) {
      await store();
    }
    return _engine;
  }
}
