import 'dart:async';

import 'package:dio/dio.dart';

import '../api/api_client.dart';
import '../api/api_endpoints.dart';
import 'local_entities.dart';
import 'local_store.dart';

class ApiError implements Exception {
  ApiError(this.description, {this.code, this.message, this.statusCode});
  final String description;
  final String? code;
  final String? message;
  final int? statusCode;

  @override
  String toString() => message ?? description;
}

/// Local-first sync engine.
///
/// Orchestrates pushes and pulls on top of [LocalStore], with one HTTP request
/// per operation, exponential backoff, stale-[Syncing] recovery, pull
/// reconciliation that protects dirty rows, and an online monitor that reads
/// `/health/live`.
///
/// The engine is a plain class (not a Riverpod provider) so it can be used both
/// from the singleton [LocalRuntime] at startup/resume and from the manual sync
/// actions exposed in the settings screen. It holds a live reference to the
/// store and to the [ApiClient] for authenticated HTTP requests.
class SyncEngine {
  SyncEngine({
    required this.store,
    required this.apiClient,
    this.maxAttempts = kMaxSyncAttempts,
  });

  final LocalStore store;
  final ApiClient apiClient;
  final int maxAttempts;

  /// The server's authoritative revision as of the last successful pull.
  int? serverRevision;

  /// Highest-level state. [onSyncStateChanged] fires when it changes from
  /// [SyncState.idle] to anything else and back to idle.
  final StreamController<SyncState> _syncStateController =
      StreamController<SyncState>.broadcast();

  /// Public view of the current sync state.
  Stream<SyncState> get onSyncStateChanged => _syncStateController.stream;

  /// Returns the current [SyncState] synchronously.
  SyncState get currentState => _currentState;
  SyncState _currentState = const SyncState.idle();

  /// Called by callers that need to observe sync progress.
  Stream<SyncState> observe() => _syncStateController.stream;

  /// The current online/offline determination.
  SyncNetworkStatus networkStatus = SyncNetworkStatus.online();

  /// Cancel any in-flight push/pull. The current operation is stopped
  /// immediately; queued operations remain PENDING and will resume later.
  void cancel() {
    _cancelRequested = true;
  }

  bool _cancelRequested = false;

  /// --- Push ---------------------------------------------------------------

  /// Push all queued, non-conflicting operations.
  ///
  /// One HTTP request is issued per operation so each one can be recorded,
  /// retried, or marked as a conflict independently. Idempotent on the server:
  /// a retry or restart replays the first result rather than duplicating any
  /// financial row.
  ///
  /// Returns the list of [SyncPushResult] in the same order as the queued
  /// operations.
  Future<List<SyncPushResult>> push() async {
    _cancelRequested = false;
    _setState(const SyncState.syncingPush());

    final pending = await store.nextOperations(limit: kMaxPushBatch);
    if (pending.isEmpty) {
      _setState(const SyncState.idle());
      return const [];
    }

    final opIds = <String>[];
    for (final op in pending) {
      if (_cancelRequested) {
        _cancelRequested = false;
        _setState(const SyncState.idle());
        return pending
            .map((o) => SyncPushResult.fromOperation(o))
            .toList(growable: false);
      }
      opIds.add(op.opId);
    }

    try {
      await store.markSyncing(opIds);
    } catch (_) {
      // If the local claim fails, leave ops PENDING and let the caller retry.
      _setState(const SyncState.idle());
      return pending.map((o) => SyncPushResult.fromOperation(o)).toList(
        growable: false,
      );
    }

    final results = <SyncPushResult>[];
    for (int i = 0; i < pending.length; i++) {
      if (_cancelRequested) {
        _cancelRequested = false;
        _setState(const SyncState.idle());
        return results;
      }

      final operation = pending[i];
      results.add(await _pushOne(operation));

      // Let UI subscribers see progress per operation.
      if (i % 3 == 0 || i == pending.length - 1) {
        _updatePushProgress(results);
      }
    }

    final remaining = await store.pendingCount();
    _setState(
      remaining == 0 ? const SyncState.synced() : const SyncState.syncingPush(),
    );
    return results;
  }

  /// Push a single operation.
  Future<SyncPushResult> _pushOne(LocalOperation operation) async {
    try {
      final request = operation.toRequestJson();
      final response = await apiClient.post(
        ApiEndpoints.syncPush,
        data: {'operations': [request]},
      );

      if (response.statusCode != 200 ||
          response.data?['success'] != true ||
          response.data?['data']?['results'] is! List) {
        final error = response.data?['error']?.toString() ?? 'VALIDATION_ERROR';
        final message =
            response.data?['message']?.toString() ?? 'Push request failed.';
        await store.applyPushResult(
          operation: operation,
          status: 'FAILED',
          errorMessage: message,
          retryable: _isRetryable(error),
        );
        return SyncPushResult.failure(operation, error, message);
      }

      final results = response.data!['data']['results'] as List;
      final conflictRows = (response.data!['data']['conflicts'] is List)
          ? response.data!['data']['conflicts'] as List
          : const [];

      final resultsMap = <String, Map<String, dynamic>>{};
      for (final row in results) {
        if (row is Map) {
          resultsMap[row['opId']?.toString() ?? ''] =
              Map<String, dynamic>.from(row);
        }
      }

      final conflictMap = <String, Map<String, dynamic>>{};
      for (final row in conflictRows) {
        if (row is Map) {
          conflictMap[row['opId']?.toString() ?? ''] =
              Map<String, dynamic>.from(row);
        }
      }

      final resultJson = resultsMap[operation.opId];
      if (resultJson != null) {
        final status = resultJson['status']?.toString();
        if (status == 'CONFLICT') {
          final reason =
              resultJson['conflict']?['reason']?.toString() ?? 'UNKNOWN_CONFLICT';
          final serverPayload = resultJson['conflict']?['serverPayload'] is Map
              ? Map<String, dynamic>.from(resultJson['conflict']['serverPayload'])
              : null;
          await store.applyPushResult(
            operation: operation,
            status: 'CONFLICT',
            conflictReason: reason,
            localPayload: operation.data,
            serverPayload: serverPayload,
          );
          return SyncPushResult.conflict(
            operation,
            reason,
            serverPayload: serverPayload,
          );
        }
        if (status == 'FAILED') {
          final err = resultJson['error'] is Map ? resultJson['error'] as Map : {};
          final code = err['code']?.toString() ?? 'SYNC_OPERATION_FAILED';
          final message = err['message']?.toString() ?? 'Sync operation failed.';
          await store.applyPushResult(
            operation: operation,
            status: 'FAILED',
            errorMessage: message,
            retryable: _isRetryable(code),
          );
          return SyncPushResult.failure(operation, code, message);
        }

        // SYNCED
        await store.applyPushResult(
          operation: operation,
          status: 'SYNCED',
          result: resultJson,
        );
        return SyncPushResult.synced(operation, resultJson);
      }

      // Server reported applied/failed/conflicts but no per-op result for
      // this opId. Treat as failed with a safe, non-lossy message.
      await store.applyPushResult(
        operation: operation,
        status: 'FAILED',
        errorMessage:
            'No result returned for the operation by the server.',
        retryable: true,
      );
      return SyncPushResult.failure(
        operation,
        'SYNC_OPERATION_FAILED',
        'No result returned for the operation by the server.',
      );
    } on DioException catch (dioError) {
      // Network-level failure: back off and retry. Never mark financial data
      // as failed when it was simply not delivered.
      await store.applyPushResult(
        operation: operation,
        status: 'FAILED',
        errorMessage: dioError.message ?? 'Network request failed.',
        retryable: true,
      );
      return SyncPushResult.failure(
        operation,
        'NETWORK_ERROR',
        dioError.message ?? 'Network request failed.',
      );
    } catch (error) {
      await store.applyPushResult(
        operation: operation,
        status: 'FAILED',
        errorMessage: error.toString(),
        retryable: true,
      );
      return SyncPushResult.failure(
        operation,
        'UNKNOWN_ERROR',
        error.toString(),
      );
    }
  }

  /// Classify a server/local error code as retryable (network, rate limit,
  /// transient) or permanent (validation, auth, conflict).
  static bool _isRetryable(String code) {
    return switch (code) {
      'NETWORK_ERROR' || 'CONNECTION_ERROR' || 'TIMEOUT' ||
      'RATE_LIMITED' || 'SERVICE_UNAVAILABLE' || 'UNKNOWN_ERROR' =>
        true,
      'STALE_WRITE' || 'UNAUTHORIZED' || 'VALIDATION_ERROR' ||
      'SYNC_OPERATION_FAILED' =>
        false,
      _ => false,
    };
  }

  /// --- Pull ---------------------------------------------------------------

  /// Pull the authoritative server snapshot and reconcile it against the local
  /// cache.
  ///
  /// Dirty (unsynced) rows are protected: they are never overwritten by the
  /// snapshot. Rows present locally but absent from the server snapshot are
  /// soft-deleted locally (tombstoned) unless they are dirty. Tombstones are
  /// the source of truth for what the server believes was deleted, because web
  /// controllers hard-delete without touching a change log.
  ///
  /// Returns the server revision after reconciliation.
  Future<int> pull() async {
    _cancelRequested = false;
    _setState(const SyncState.syncingPull());

    try {
      final response = await apiClient.get(ApiEndpoints.syncPull);

      if (response.statusCode != 200 ||
          response.data?['success'] != true ||
          response.data?['data'] == null) {
        final code = response.data?['error']?.toString() ?? 'PULL_FAILED';
        final message = response.data?['message']?.toString() ?? 'Failed to sync data.';
        await store.recordSyncError('$code: $message');
        throw ApiError(
          'Pull request failed',
          code: code,
          message: message,
        );
      }

      final data = response.data!['data'];
      final serverRevision =
          (data['serverRevision'] as num?)?.toInt() ?? 0;
      final serverTime = data['serverTime']?.toString();
      final snapshot = data['snapshot'] as Map<String, dynamic>? ?? {};

      await store.applySnapshot(
        snapshot: snapshot,
        serverRevision: serverRevision.toString(),
      );

      // The engine-level revision must also be updated.
      this.serverRevision = serverRevision;
      await store.setMeta('serverRevision', serverRevision.toString());
      await store.setMeta('lastSyncAt', serverTime ?? DateTime.now().toUtc().toIso8601String());
      await store.recordSyncError(null);

      // Clear stale SYNCING ops (e.g. killed during pull): they survive the
      // snapshot as PENDING and will be retried on the next push.
      await store.recoverStaleSyncing();

      _setState(const SyncState.synced());
      return serverRevision;
    } on DioException catch (dioError) {
      final status = dioError.response?.statusCode;
      if (status == 401 || status == 403) {
        await store.recordSyncError('UNAUTHORIZED: authentication expired');
        throw ApiError(
          'Authentication expired during sync',
          code: 'UNAUTHORIZED',
          message: 'Please sign in again.',
        );
      }
      await store.recordSyncError(dioError.message ?? 'Network pull failed');
      throw ApiError(
        'Failed to pull sync snapshot',
        code: 'NETWORK_ERROR',
        message: dioError.message ?? 'Network request failed.',
      );
    } catch (error) {
      if (error is ApiError) rethrow;
      await store.recordSyncError(error.toString());
      throw ApiError(
        'Failed to pull sync snapshot',
        code: 'PULL_FAILED',
        message: error.toString(),
      );
    }
  }

  /// --- Health / online detection ------------------------------------------

  /// Reads the server's `/health/live` endpoint. Returns true only when the
  /// server answers with 200. Network exceptions and non-200 responses are
  /// treated as offline; the returned [SyncNetworkStatus] records the error.
  Future<void> checkConnectivity() async {
    try {
      final response = await apiClient.get(ApiEndpoints.healthLive);
      final ok = response.statusCode == 200 &&
          response.data?['success'] == true &&
          response.data?['data'] == true;
      if (ok) {
        networkStatus = SyncNetworkStatus.online(lastChecked: DateTime.now());
      } else {
        networkStatus = SyncNetworkStatus.offline(
          error: 'Server responded with ${response.statusCode}',
          lastChecked: DateTime.now(),
        );
      }
    } catch (e) {
      networkStatus = SyncNetworkStatus.offline(
        error: e.toString(),
        lastChecked: DateTime.now(),
      );
    }
  }

  /// Recovers operations stuck in SYNCING (process killed mid-sync).
  ///
  /// They are re-queued as PENDING so push can retry them. Their associated
  /// local row is kept dirty so it is re-sent with the correct payload.
  Future<void> recoverStaleSyncing() async => store.recoverStaleSyncing();

  /// Retries all failed operations as if they were fresh.
  Future<void> retryFailedOperations() async => store.retryFailedOperations();

  /// --- Backoff --------------------------------------------------------------

  /// Compute the next attempt time using exponential backoff.
  static Duration nextAttemptAt({required int attempts}) {
    final seconds = (5 * (2 ^ (attempts - 1))).clamp(1.0, 1800.0);
    return Duration(seconds: seconds.toInt());
  }

  /// --- State management ------------------------------------------------------

  void _setState(SyncState newState) {
    if (_currentState == newState) return;
    _currentState = newState;
    if (_syncStateController.isClosed) return;
    _syncStateController.add(newState);
  }

  void _updatePushProgress(List<SyncPushResult> results) {
    if (_syncStateController.isClosed) return;
    _syncStateController.add(SyncState.pushing(
      results.whereType<SyncPushResultSynced>().length,
      results.whereType<SyncPushResultFailed>().length,
      results.whereType<SyncPushResultConflict>().length,
    ));
  }
}

/// Result of pushing a single operation.
sealed class SyncPushResult {
  const SyncPushResult({
    required this.opId,
    required this.entityType,
    required this.entityId,
    required this.operation,
  });

  final String opId;
  final String entityType;
  final String entityId;
  final String operation;

  static SyncPushResult fromOperation(LocalOperation operation) {
    final status = operation.status;
    if (status == SyncOperationStatus.failed) {
      return SyncPushResultFailed(
        opId: operation.opId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        operation: operation.operation,
        code: operation.lastError?.split('|').first.trim() ?? 'UNKNOWN',
        message: operation.lastError ?? 'Operation failed.',
      );
    }
    if (status == SyncOperationStatus.conflict) {
      return SyncPushResultConflict(
        opId: operation.opId,
        entityType: operation.entityType,
        entityId: operation.entityId,
        operation: operation.operation,
        reason: operation.lastError ?? 'Unknown conflict',
      );
    }
    return SyncPushResultSynced(
      opId: operation.opId,
      entityType: operation.entityType,
      entityId: operation.entityId,
      operation: operation.operation,
    );
  }

  static SyncPushResult failure(
    LocalOperation op,
    String code,
    String message,
  ) {
    return SyncPushResultFailed(
      opId: op.opId,
      entityType: op.entityType,
      entityId: op.entityId,
      operation: op.operation,
      code: code,
      message: message,
    );
  }

  static SyncPushResult synced(
    LocalOperation op,
    Map<String, dynamic> resultJson,
  ) {
    return SyncPushResultSynced(
      opId: op.opId,
      entityType: op.entityType,
      entityId: op.entityId,
      operation: op.operation,
      serverUpdatedAt: resultJson['serverUpdatedAt']?.toString(),
      serverVersion: (resultJson['serverVersion'] as num?)?.toInt(),
    );
  }

  static SyncPushResult conflict(
    LocalOperation op,
    String reason, {
    Map<String, dynamic>? serverPayload,
  }) {
    return SyncPushResultConflict(
      opId: op.opId,
      entityType: op.entityType,
      entityId: op.entityId,
      operation: op.operation,
      reason: reason,
      serverPayload: serverPayload,
    );
  }
}

class SyncPushResultSynced extends SyncPushResult {
  const SyncPushResultSynced({
    required super.opId,
    required super.entityType,
    required super.entityId,
    required super.operation,
    this.serverUpdatedAt,
    this.serverVersion,
  });

  final String? serverUpdatedAt;
  final int? serverVersion;
}

class SyncPushResultFailed extends SyncPushResult {
  const SyncPushResultFailed({
    required super.opId,
    required super.entityType,
    required super.entityId,
    required super.operation,
    required this.code,
    required this.message,
  });

  final String code;
  final String message;
}

class SyncPushResultConflict extends SyncPushResult {
  const SyncPushResultConflict({
    required super.opId,
    required super.entityType,
    required super.entityId,
    required super.operation,
    required this.reason,
    this.serverPayload,
  });

  final String reason;
  final Map<String, dynamic>? serverPayload;
}

enum SyncPushResultStatus { synced, failed, conflict }

/// Overall sync progress for the UI.
class SyncState {
  const SyncState._(
    this._kind, {
    this.perSynced,
    this.perFailed,
    this.perConflict,
  });

  const SyncState.idle() : this._('idle');
  const SyncState.synced() : this._('synced');
  const SyncState.syncingPush() : this._('pushing');
  const SyncState.syncingPull() : this._('pulling');
  const SyncState.pushing(int perSynced, int perFailed, int perConflict)
      : this._(
          'pushing',
          perSynced: perSynced,
          perFailed: perFailed,
          perConflict: perConflict,
        );

  final String _kind;
  final int? perSynced;
  final int? perFailed;
  final int? perConflict;

  bool get isIdle => _kind == 'idle';
  bool get hasSynced => _kind == 'synced';
  bool get isSyncing =>
      _kind == 'pushing' || _kind == 'pulling' || _kind == 'syncingPush';

  bool get isPushing => _kind == 'pushing';
  bool get isPulling => _kind == 'pulling';

  int get syncedCount => perSynced ?? 0;
  int get failedCount => perFailed ?? 0;
  int get conflictCount => perConflict ?? 0;

  @override
  String toString() {
    if (isIdle) return 'SyncState.idle';
    if (hasSynced) return 'SyncState.synced';
    if (isPushing) {
      return 'SyncState.pushing(synced=$syncedCount failed=$failedCount conflicts=$conflictCount)';
    }
    return 'SyncState.$_kind';
  }
}

/// Online/offline state as observed by reading the server health endpoint.
class SyncNetworkStatus {
  SyncNetworkStatus({
    required this.online,
    this.lastChecked,
    this.error,
  });

  factory SyncNetworkStatus.online({DateTime? lastChecked}) =>
      SyncNetworkStatus(online: true, lastChecked: lastChecked);
  factory SyncNetworkStatus.offline({
    String? error,
    DateTime? lastChecked,
  }) =>
      SyncNetworkStatus(online: false, error: error, lastChecked: lastChecked);

  final bool online;
  final DateTime? lastChecked;
  final String? error;

  @override
  String toString() =>
      online ? 'SyncNetworkStatus.online' : 'SyncNetworkStatus.offline';
}
