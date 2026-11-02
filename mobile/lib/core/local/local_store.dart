import 'dart:convert';
import 'dart:math' as math;

import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'local_database.dart';
import 'local_entities.dart';

class LocalRecord {
  LocalRecord({
    required this.entityType,
    required this.id,
    required this.data,
    required this.version,
    required this.isDeleted,
    required this.dirty,
    this.serverUpdatedAt,
    this.createdAt,
    this.updatedAt,
  });

  final String entityType;
  final String id;
  final Map<String, dynamic> data;
  final int version;
  final bool isDeleted;
  final bool dirty;
  final String? serverUpdatedAt;
  final String? createdAt;
  final String? updatedAt;

  factory LocalRecord.fromRow(Map<String, Object?> row) {
    final raw = row['data'];
    Map<String, dynamic> data;
    try {
      final decoded = raw is String ? jsonDecode(raw) : raw;
      data = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
    } catch (_) {
      data = <String, dynamic>{};
    }
    return LocalRecord(
      entityType: row['entity_type'] as String,
      id: row['id'] as String,
      data: data,
      version: (row['version'] as num?)?.toInt() ?? 0,
      isDeleted: (row['is_deleted'] as num?)?.toInt() == 1,
      dirty: (row['dirty'] as num?)?.toInt() == 1,
      serverUpdatedAt: row['server_updated_at'] as String?,
      createdAt: row['created_at'] as String?,
      updatedAt: row['updated_at'] as String?,
    );
  }
}

class LocalOperation {
  LocalOperation({
    required this.opId,
    required this.entityType,
    required this.entityId,
    required this.operation,
    required this.data,
    this.baseUpdatedAt,
    this.baseVersion,
    required this.attempts,
    this.status,
    this.lastError,
  });

  final String opId;
  final String entityType;
  final String entityId;
  final String operation;
  final Map<String, dynamic> data;
  final String? baseUpdatedAt;
  final int? baseVersion;
  final int attempts;
  final String? status;
  final String? lastError;

  Map<String, dynamic> toRequestJson() {
    return {
      'opId': opId,
      'entityType': entityType,
      'entityId': entityId,
      'operation': operation,
      'data': data,
      if (baseUpdatedAt != null) 'baseUpdatedAt': baseUpdatedAt,
      if (baseVersion != null) 'baseVersion': baseVersion,
    };
  }
}

/// Durable local store + operation queue.
///
/// Every write happens inside one SQLite transaction that also appends the
/// corresponding sync operation. A crash therefore either loses both or keeps
/// both; it can never record a financial change without a queued upload.
class LocalStore {
  LocalStore(this._database, {required this.userId, required this.deviceId});

  final LocalDatabase _database;
  String userId;
  String deviceId;

  static const _uuid = Uuid();

  Database get _db => _database.db;

  void bindUser(String nextUserId) {
    userId = nextUserId;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  Future<List<LocalRecord>> listRecords(
    String entityType, {
    bool includeDeleted = false,
  }) async {
    final where = StringBuffer('user_id = ? AND entity_type = ?');
    if (!includeDeleted) where.write(' AND is_deleted = 0');
    final rows = await _db.query(
      'local_records',
      where: where.toString(),
      whereArgs: [userId, entityType],
      orderBy: 'created_at ASC',
    );
    return rows.map(LocalRecord.fromRow).toList(growable: false);
  }

  Future<List<Map<String, dynamic>>> listData(String entityType) async {
    final records = await listRecords(entityType);
    return records.map((record) => record.data).toList(growable: false);
  }

  Future<LocalRecord?> getRecord(String entityType, String id) async {
    final rows = await _db.query(
      'local_records',
      where: 'user_id = ? AND entity_type = ? AND id = ?',
      whereArgs: [userId, entityType, id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return LocalRecord.fromRow(rows.first);
  }

  Future<Map<String, dynamic>?> getData(String entityType, String id) async {
    final record = await getRecord(entityType, id);
    if (record == null || record.isDeleted) return null;
    return record.data;
  }

  Future<String?> getMeta(String key) async {
    final rows = await _db.query(
      'sync_meta',
      columns: ['value'],
      where: 'user_id = ? AND key = ?',
      whereArgs: [userId, key],
      limit: 1,
    );
    return rows.isEmpty ? null : rows.first['value'] as String?;
  }

  Future<void> setMeta(String key, String? value) async {
    await _db.insert(
      'sync_meta',
      {'user_id': userId, 'key': key, 'value': value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // -------------------------------------------------------------------------
  // Local writes
  // -------------------------------------------------------------------------

  Future<Map<String, dynamic>> createRecord({
    required String entityType,
    required Map<String, dynamic> data,
  }) async {
    final id = (data['id'] ?? _uuid.v4()).toString();
    final now = DateTime.now().toUtc().toIso8601String();
    final record = _cleanData({
      ...data,
      'id': id,
      'version': 0,
      'createdAt': data['createdAt'] ?? now,
      'updatedAt': now,
    });

    await _db.transaction((txn) async {
      await txn.insert(
        'local_records',
        {
          'user_id': userId,
          'entity_type': entityType,
          'id': id,
          'data': jsonEncode(record),
          'server_updated_at': null,
          'version': 0,
          'is_deleted': 0,
          'dirty': 1,
          'created_at': record['createdAt'],
          'updated_at': now,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      await _enqueue(
        txn,
        entityType: entityType,
        entityId: id,
        operation: SyncOperationType.create,
        data: record,
        baseUpdatedAt: null,
        baseVersion: null,
      );
      await _adjustAccountBalances(txn, oldData: null, newData: record);
    });

    return record;
  }

  Future<Map<String, dynamic>> updateRecord({
    required String entityType,
    required String id,
    required Map<String, dynamic> changes,
  }) async {
    final existing = await getRecord(entityType, id);
    if (existing == null || existing.isDeleted) {
      throw StateError('$entityType $id no longer exists locally.');
    }

    final now = DateTime.now().toUtc().toIso8601String();
    final merged = _cleanData({
      ...existing.data,
      ...changes,
      'id': id,
      'version': existing.version,
      'createdAt': existing.data['createdAt'] ?? existing.createdAt,
      'updatedAt': now,
    });

    await _db.transaction((txn) async {
      await txn.update(
        'local_records',
        {
          'data': jsonEncode(merged),
          'dirty': 1,
          'updated_at': now,
        },
        where: 'user_id = ? AND entity_type = ? AND id = ?',
        whereArgs: [userId, entityType, id],
      );
      await _enqueue(
        txn,
        entityType: entityType,
        entityId: id,
        operation: SyncOperationType.update,
        data: merged,
        baseUpdatedAt: existing.serverUpdatedAt,
        baseVersion: existing.version,
      );
      await _adjustAccountBalances(
        txn,
        oldData: existing.data,
        newData: merged,
      );
    });

    return merged;
  }

  Future<void> deleteRecord({
    required String entityType,
    required String id,
  }) async {
    final existing = await getRecord(entityType, id);
    if (existing == null || existing.isDeleted) return;

    final now = DateTime.now().toUtc().toIso8601String();

    await _db.transaction((txn) async {
      final consumed = await _enqueue(
        txn,
        entityType: entityType,
        entityId: id,
        operation: SyncOperationType.delete,
        data: {kDeletedMarker: true},
        baseUpdatedAt: existing.serverUpdatedAt,
        baseVersion: existing.version,
      );

      if (consumed) {
        // The row was created locally and never reached the server. Removing
        // both the record and its queued CREATE leaves no trace anywhere.
        await txn.delete(
          'local_records',
          where: 'user_id = ? AND entity_type = ? AND id = ?',
          whereArgs: [userId, entityType, id],
        );
      } else {
        await txn.update(
          'local_records',
          {'is_deleted': 1, 'dirty': 1, 'updated_at': now},
          where: 'user_id = ? AND entity_type = ? AND id = ?',
          whereArgs: [userId, entityType, id],
        );
      }

      await _adjustAccountBalances(
        txn,
        oldData: existing.data,
        newData: null,
      );
    });
  }

  /// Merges a server-authoritative record into the cache unless the local copy
  /// has unsynced edits. Returns true when the local row was replaced.
  Future<bool> applyServerRecord(
    String entityType,
    Map<String, dynamic> record,
  ) async {
    final id = record['id']?.toString();
    if (id == null || id.isEmpty) return false;

    return _db.transaction((txn) async {
      final existing = await _getRecordTxn(txn, entityType, id);
      if (existing != null && existing.dirty) return false;
      await _upsertFromServer(txn, entityType, record);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------

  Future<List<LocalOperation>> nextOperations({int limit = kMaxPushBatch}) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final rows = await _db.query(
      'sync_operations',
      where: 'user_id = ? AND status = ? AND next_attempt_at <= ?',
      whereArgs: [userId, SyncOperationStatus.pending, now],
      orderBy: 'created_at ASC',
      limit: limit,
    );
    return rows.map(_operationFromRow).toList(growable: false);
  }

  Future<int> pendingCount() async {
    final rows = await _db.rawQuery(
      'SELECT COUNT(*) AS c FROM sync_operations WHERE user_id = ? AND status IN (?, ?)',
      [userId, SyncOperationStatus.pending, SyncOperationStatus.syncing],
    );
    return (rows.first['c'] as num?)?.toInt() ?? 0;
  }

  Future<int> openConflictCount() async {
    final rows = await _db.rawQuery(
      'SELECT COUNT(*) AS c FROM sync_conflicts WHERE user_id = ? AND status = ?',
      [userId, 'OPEN'],
    );
    return (rows.first['c'] as num?)?.toInt() ?? 0;
  }

  Future<void> markSyncing(List<String> opIds) async {
    if (opIds.isEmpty) return;
    final placeholders = List.filled(opIds.length, '?').join(',');
    await _db.rawUpdate(
      'UPDATE sync_operations SET status = ?, updated_at = ? '
      'WHERE user_id = ? AND op_id IN ($placeholders)',
      [
        SyncOperationStatus.syncing,
        DateTime.now().millisecondsSinceEpoch,
        userId,
        ...opIds,
      ],
    );
  }

  /// A process may die mid-push. On restart every SYNING row is retried; the
  /// server deduplicates by `(userId, opId)`, so this can never double-apply.
  Future<int> recoverStaleSyncing() async {
    return _db.rawUpdate(
      'UPDATE sync_operations SET status = ?, updated_at = ? '
      'WHERE user_id = ? AND status = ?',
      [
        SyncOperationStatus.pending,
        DateTime.now().millisecondsSinceEpoch,
        userId,
        SyncOperationStatus.syncing,
      ],
    );
  }

  Future<void> applyPushResult({
    required LocalOperation operation,
    required String status,
    Map<String, dynamic>? result,
    String? errorMessage,
    bool retryable = false,
    String? conflictReason,
    Map<String, dynamic>? localPayload,
    Map<String, dynamic>? serverPayload,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch;

    if (status == 'SYNCED') {
      await _db.transaction((txn) async {
        await txn.update(
          'sync_operations',
          {
            'status': SyncOperationStatus.synced,
            'result': result == null ? null : jsonEncode(result),
            'last_error': null,
            'updated_at': now,
          },
          where: 'user_id = ? AND op_id = ?',
          whereArgs: [userId, operation.opId],
        );
        await _finishSyncedOperation(txn, operation, result);
      });
      return;
    }

    if (status == 'CONFLICT') {
      await _db.transaction((txn) async {
        await txn.update(
          'sync_operations',
          {
            'status': SyncOperationStatus.conflict,
            'last_error': conflictReason,
            'updated_at': now,
          },
          where: 'user_id = ? AND op_id = ?',
          whereArgs: [userId, operation.opId],
        );
        await _storeConflictTxn(
          txn,
          id: 'op:${operation.opId}',
          entityType: operation.entityType,
          entityId: operation.entityId,
          opId: operation.opId,
          reason: conflictReason,
          localPayload: localPayload ?? operation.data,
          serverPayload: serverPayload,
        );
      });
      return;
    }

    // FAILED. Retryable failures are put back in the queue with exponential
    // backoff; permanent ones stay FAILED until the user acts.
    final attempts = operation.attempts + 1;
    final canRetry = retryable && attempts < kMaxSyncAttempts;
    final delayMs = _backoffMs(attempts);
    await _db.update(
      'sync_operations',
      {
        'status': canRetry
            ? SyncOperationStatus.pending
            : SyncOperationStatus.failed,
        'attempts': attempts,
        'next_attempt_at': canRetry ? now + delayMs : 0,
        'last_error': errorMessage,
        'updated_at': now,
      },
      where: 'user_id = ? AND op_id = ?',
      whereArgs: [userId, operation.opId],
    );
  }

  Future<void> retryFailedOperations() async {
    await _db.rawUpdate(
      'UPDATE sync_operations SET status = ?, next_attempt_at = 0, attempts = 0, last_error = NULL '
      'WHERE user_id = ? AND status = ?',
      [
        SyncOperationStatus.pending,
        userId,
        SyncOperationStatus.failed,
      ],
    );
  }

  Future<List<Map<String, dynamic>>> listConflicts({
    String status = 'OPEN',
  }) async {
    final rows = await _db.query(
      'sync_conflicts',
      where: status == 'ALL'
          ? 'user_id = ?'
          : 'user_id = ? AND status = ?',
      whereArgs: status == 'ALL' ? [userId] : [userId, status],
      orderBy: 'created_at DESC',
    );
    return rows.map((row) {
      return {
        'id': row['id'],
        'entityType': row['entity_type'],
        'entityId': row['entity_id'],
        'opId': row['op_id'],
        'reason': row['reason'],
        'localPayload': _decode(row['local_payload']),
        'serverPayload': _decode(row['server_payload']),
        'status': row['status'],
        'resolution': row['resolution'],
        'createdAt': row['created_at'],
      };
    }).toList(growable: false);
  }

  Future<void> upsertConflict(Map<String, dynamic> conflict) async {
    final id = conflict['id']?.toString();
    if (id == null || id.isEmpty) return;
    final payload = conflict['payload'];
    final source = payload is Map ? Map<String, dynamic>.from(payload) : conflict;
    await _db.transaction((txn) async {
      await _storeConflictTxn(
        txn,
        id: id,
        entityType: source['entityType']?.toString(),
        entityId: source['entityId']?.toString(),
        opId: source['opId']?.toString(),
        reason: source['reason']?.toString(),
        localPayload: source['localPayload'] is Map
            ? Map<String, dynamic>.from(source['localPayload'] as Map)
            : null,
        serverPayload: source['serverPayload'] is Map
            ? Map<String, dynamic>.from(source['serverPayload'] as Map)
            : null,
      );
    });
  }

  Future<void> resolveConflict(String id, String resolution) async {
    await _db.update(
      'sync_conflicts',
      {
        'status': 'RESOLVED',
        'resolution': resolution,
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
      where: 'user_id = ? AND id = ?',
      whereArgs: [userId, id],
    );
  }

  Future<LocalOperation?> operationForOpId(String opId) async {
    final rows = await _db.query(
      'sync_operations',
      where: 'user_id = ? AND op_id = ?',
      whereArgs: [userId, opId],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return _operationFromRow(rows.first);
  }

  Future<void> enqueueLocalOperation({
    required String entityType,
    required String entityId,
    required String operation,
    required Map<String, dynamic> data,
    String? opId,
    String? baseUpdatedAt,
    int? baseVersion,
  }) async {
    await _db.transaction((txn) async {
      await _enqueue(
        txn,
        entityType: entityType,
        entityId: entityId,
        operation: operation,
        data: data,
        baseUpdatedAt: baseUpdatedAt,
        baseVersion: baseVersion,
        forcedOpId: opId,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Snapshot reconciliation
  // -------------------------------------------------------------------------

  Future<void> applySnapshot({
    required Map<String, dynamic> snapshot,
    required String serverRevision,
  }) async {
    final serverTime = DateTime.now().toUtc().toIso8601String();
    await _db.transaction((txn) async {
      for (final entityType in LocalEntity.snapshotEntities) {
        final key = _snapshotKey(entityType);
        final rawList = snapshot[key];
        final seen = <String>{};
        if (rawList is List) {
          for (final raw in rawList) {
            if (raw is! Map) continue;
            final record = Map<String, dynamic>.from(raw);
            final id = record['id']?.toString();
            if (id == null || id.isEmpty) continue;
            seen.add(id);
            final existing = await _getRecordTxn(txn, entityType, id);
            if (existing != null && existing.dirty) continue;
            await _upsertFromServer(txn, entityType, record);
          }
        }

        final cleanRows = await txn.query(
          'local_records',
          columns: ['id'],
          where: 'user_id = ? AND entity_type = ? AND dirty = 0 AND is_deleted = 0',
          whereArgs: [userId, entityType],
        );
        for (final row in cleanRows) {
          final id = row['id'] as String;
          if (seen.contains(id)) continue;
          await txn.update(
            'local_records',
            {'is_deleted': 1, 'updated_at': serverTime},
            where: 'user_id = ? AND entity_type = ? AND id = ?',
            whereArgs: [userId, entityType, id],
          );
        }
      }

      final tombstones = snapshot['tombstones'];
      if (tombstones is List) {
        for (final raw in tombstones) {
          if (raw is! Map) continue;
          final entityType = raw['entityType']?.toString();
          final entityId = raw['entityId']?.toString();
          if (entityType == null || entityId == null) continue;
          final existing = await _getRecordTxn(txn, entityType, entityId);
          if (existing == null || existing.dirty) continue;
          await txn.update(
            'local_records',
            {'is_deleted': 1, 'updated_at': serverTime},
            where: 'user_id = ? AND entity_type = ? AND id = ?',
            whereArgs: [userId, entityType, entityId],
          );
        }
      }

      await _setMetaTxn(txn, 'serverRevision', serverRevision);
      await _setMetaTxn(txn, 'lastSyncAt', serverTime);
    });
  }

  Future<void> recordSyncError(String? message) async {
    await setMeta('lastSyncError', message);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  Map<String, dynamic> _cleanData(Map<String, dynamic> input) {
    final output = <String, dynamic>{};
    input.forEach((key, value) {
      if (key.startsWith('__')) return;
      if (key == 'spent') return;
      output[key] = value;
    });
    return output;
  }

  Future<LocalRecord?> _getRecordTxn(
    Transaction txn,
    String entityType,
    String id,
  ) async {
    final rows = await txn.query(
      'local_records',
      where: 'user_id = ? AND entity_type = ? AND id = ?',
      whereArgs: [userId, entityType, id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return LocalRecord.fromRow(rows.first);
  }

  Future<void> _upsertFromServer(
    Transaction txn,
    String entityType,
    Map<String, dynamic> record,
  ) async {
    final id = record['id'].toString();
    final clean = _cleanData(record);
    final version = (record['version'] as num?)?.toInt() ?? 0;
    final serverUpdatedAt = record['updatedAt']?.toString();
    final isArchived = entityType == LocalEntity.account &&
        record['isActive'] == false;

    await txn.insert(
      'local_records',
      {
        'user_id': userId,
        'entity_type': entityType,
        'id': id,
        'data': jsonEncode(clean),
        'server_updated_at': serverUpdatedAt,
        'version': version,
        'is_deleted': isArchived ? 1 : 0,
        'dirty': 0,
        'created_at': record['createdAt']?.toString(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Applies the authoritative result of a successfully pushed operation.
  Future<void> _finishSyncedOperation(
    Transaction txn,
    LocalOperation operation,
    Map<String, dynamic>? result,
  ) async {
    if (result == null) return;

    final later = await txn.query(
      'sync_operations',
      columns: ['op_id'],
      where: 'user_id = ? AND entity_type = ? AND entity_id = ? AND status = ? AND op_id != ?',
      whereArgs: [
        userId,
        operation.entityType,
        operation.entityId,
        SyncOperationStatus.pending,
        operation.opId,
      ],
      limit: 1,
    );

    if (later.isNotEmpty) {
      // A newer local edit supersedes this server row. Only refresh the
      // optimistic-concurrency base so the next push does not look stale.
      await txn.update(
        'sync_operations',
        {
          'base_updated_at': result['updatedAt']?.toString(),
          'base_version': (result['version'] as num?)?.toInt(),
        },
        where: 'user_id = ? AND entity_type = ? AND entity_id = ? AND status = ?',
        whereArgs: [
          userId,
          operation.entityType,
          operation.entityId,
          SyncOperationStatus.pending,
        ],
      );
      return;
    }

    if (operation.operation == SyncOperationType.delete) {
      await txn.delete(
        'local_records',
        where: 'user_id = ? AND entity_type = ? AND id = ?',
        whereArgs: [userId, operation.entityType, operation.entityId],
      );
      return;
    }

    await _upsertFromServer(txn, operation.entityType, result);
  }

  /// Coalesces queued operations for one entity.
  ///
  /// Returns true when a DELETE cancelled an unsynced CREATE, meaning the
  /// caller should remove the local row entirely.
  Future<bool> _enqueue(
    Transaction txn, {
    required String entityType,
    required String entityId,
    required String operation,
    required Map<String, dynamic> data,
    required String? baseUpdatedAt,
    required int? baseVersion,
    String? forcedOpId,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final pending = await txn.query(
      'sync_operations',
      where: 'user_id = ? AND entity_type = ? AND entity_id = ? AND status = ?',
      whereArgs: [
        userId,
        entityType,
        entityId,
        SyncOperationStatus.pending,
      ],
      orderBy: 'created_at ASC',
    );

    final pendingCreate = pending
        .where((row) => row['operation'] == SyncOperationType.create)
        .toList(growable: false);
    final pendingUpdate = pending
        .where((row) => row['operation'] == SyncOperationType.update)
        .toList(growable: false);

    switch (operation) {
      case SyncOperationType.create:
        await txn.insert(
          'sync_operations',
          _operationRow(
            opId: forcedOpId ?? _uuid.v4(),
            entityType: entityType,
            entityId: entityId,
            operation: operation,
            data: data,
            baseUpdatedAt: baseUpdatedAt,
            baseVersion: baseVersion,
            now: now,
          ),
        );
        return false;

      case SyncOperationType.update:
        if (pendingCreate.isNotEmpty) {
          await txn.update(
            'sync_operations',
            {'data': jsonEncode(data), 'updated_at': now},
            where: 'user_id = ? AND op_id = ?',
            whereArgs: [userId, pendingCreate.first['op_id']],
          );
          return false;
        }
        if (pendingUpdate.isNotEmpty) {
          await txn.update(
            'sync_operations',
            {'data': jsonEncode(data), 'updated_at': now},
            where: 'user_id = ? AND op_id = ?',
            whereArgs: [userId, pendingUpdate.first['op_id']],
          );
          return false;
        }
        await txn.insert(
          'sync_operations',
          _operationRow(
            opId: forcedOpId ?? _uuid.v4(),
            entityType: entityType,
            entityId: entityId,
            operation: operation,
            data: data,
            baseUpdatedAt: baseUpdatedAt,
            baseVersion: baseVersion,
            now: now,
          ),
        );
        return false;

      case SyncOperationType.delete:
        if (pendingCreate.isNotEmpty) {
          await txn.delete(
            'sync_operations',
            where: 'user_id = ? AND op_id = ?',
            whereArgs: [userId, pendingCreate.first['op_id']],
          );
          return true;
        }
        if (pendingUpdate.isNotEmpty) {
          await txn.update(
            'sync_operations',
            {
              'operation': SyncOperationType.delete,
              'data': jsonEncode(data),
              'updated_at': now,
            },
            where: 'user_id = ? AND op_id = ?',
            whereArgs: [userId, pendingUpdate.first['op_id']],
          );
          return false;
        }
        await txn.insert(
          'sync_operations',
          _operationRow(
            opId: forcedOpId ?? _uuid.v4(),
            entityType: entityType,
            entityId: entityId,
            operation: operation,
            data: data,
            baseUpdatedAt: baseUpdatedAt,
            baseVersion: baseVersion,
            now: now,
          ),
        );
        return false;

      default:
        return false;
    }
  }

  Map<String, Object?> _operationRow({
    required String opId,
    required String entityType,
    required String entityId,
    required String operation,
    required Map<String, dynamic> data,
    required String? baseUpdatedAt,
    required int? baseVersion,
    required int now,
  }) {
    return {
      'op_id': opId,
      'user_id': userId,
      'device_id': deviceId,
      'entity_type': entityType,
      'entity_id': entityId,
      'operation': operation,
      'data': jsonEncode(data),
      'base_updated_at': baseUpdatedAt,
      'base_version': baseVersion,
      'status': SyncOperationStatus.pending,
      'attempts': 0,
      'next_attempt_at': 0,
      'last_error': null,
      'result': null,
      'created_at': now,
      'updated_at': now,
    };
  }

  Future<void> _storeConflictTxn(
    Transaction txn, {
    required String id,
    required String? entityType,
    required String? entityId,
    required String? opId,
    required String? reason,
    required Map<String, dynamic>? localPayload,
    required Map<String, dynamic>? serverPayload,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await txn.insert(
      'sync_conflicts',
      {
        'id': id,
        'user_id': userId,
        'entity_type': entityType,
        'entity_id': entityId,
        'op_id': opId,
        'reason': reason,
        'local_payload': localPayload == null ? null : jsonEncode(localPayload),
        'server_payload': serverPayload == null ? null : jsonEncode(serverPayload),
        'status': 'OPEN',
        'resolution': null,
        'created_at': now,
        'updated_at': now,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> _setMetaTxn(
    Transaction txn,
    String key,
    String? value,
  ) async {
    await txn.insert(
      'sync_meta',
      {'user_id': userId, 'key': key, 'value': value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Keeps the displayed account balance consistent with locally recorded
  /// transactions while offline. The backend remains the ledger authority and
  /// overwrites this value on the next pull.
  Future<void> _adjustAccountBalances(
    Transaction txn, {
    required Map<String, dynamic>? oldData,
    required Map<String, dynamic>? newData,
  }) async {
    final deltas = <String, double>{};

    void collect(Map<String, dynamic>? data, double sign) {
      if (data == null) return;
      final amount = _asDouble(data['amount']);
      if (amount == null || amount == 0) return;
      final type =
          (data['transactionType'] ?? data['type'])?.toString().toUpperCase();
      final accountId = data['accountId']?.toString();
      final toAccountId = data['toAccountId']?.toString();

      switch (type) {
        case 'EXPENSE':
        case 'INVESTMENT':
        case 'LOAN_PAYMENT':
          if (accountId != null) {
            deltas[accountId] = (deltas[accountId] ?? 0) - (amount * sign);
          }
          break;
        case 'INCOME':
        case 'REFUND':
          if (accountId != null) {
            deltas[accountId] = (deltas[accountId] ?? 0) + (amount * sign);
          }
          break;
        case 'TRANSFER':
          if (accountId != null) {
            deltas[accountId] = (deltas[accountId] ?? 0) - (amount * sign);
          }
          if (toAccountId != null) {
            deltas[toAccountId] =
                (deltas[toAccountId] ?? 0) + (amount * sign);
          }
          break;
      }
    }

    collect(oldData, -1);
    collect(newData, 1);

    for (final entry in deltas.entries) {
      if (entry.value == 0) continue;
      final account = await _getRecordTxn(
        txn,
        LocalEntity.account,
        entry.key,
      );
      if (account == null || account.isDeleted) continue;
      final balance = (_asDouble(account.data['balance']) ?? 0) + entry.value;
      final data = <String, dynamic>{
        ...account.data,
        'balance': double.parse(balance.toStringAsFixed(2)),
      };
      await txn.update(
        'local_records',
        {'data': jsonEncode(data)},
        where: 'user_id = ? AND entity_type = ? AND id = ?',
        whereArgs: [userId, LocalEntity.account, entry.key],
      );
    }
  }

  LocalOperation _operationFromRow(Map<String, Object?> row) {
    final decoded = _decode(row['data']);
    return LocalOperation(
      opId: row['op_id'] as String,
      entityType: row['entity_type'] as String,
      entityId: row['entity_id'] as String,
      operation: row['operation'] as String,
      data: decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{},
      baseUpdatedAt: row['base_updated_at'] as String?,
      baseVersion: (row['base_version'] as num?)?.toInt(),
      attempts: (row['attempts'] as num?)?.toInt() ?? 0,
      status: row['status'] as String?,
      lastError: row['last_error'] as String?,
    );
  }

  static Object? _decode(Object? raw) {
    if (raw is! String || raw.isEmpty) return null;
    try {
      return jsonDecode(raw);
    } catch (_) {
      return null;
    }
  }

  static double? _asDouble(Object? value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  static int _backoffMs(int attempts) {
    final seconds = math.min(5 * math.pow(2, attempts - 1).toInt(), 1800);
    return seconds * 1000;
  }

  static String _snapshotKey(String entityType) {
    switch (entityType) {
      case LocalEntity.account:
        return 'accounts';
      case LocalEntity.transaction:
        return 'transactions';
      case LocalEntity.budget:
        return 'budgets';
      case LocalEntity.goal:
        return 'goals';
      case LocalEntity.loan:
        return 'loans';
      case LocalEntity.investment:
        return 'investments';
      case LocalEntity.category:
        return 'categories';
      default:
        return '${entityType}s';
    }
  }
}
