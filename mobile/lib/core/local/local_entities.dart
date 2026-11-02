/// Entity identifiers shared by the local database and the sync API.
///
/// These strings are part of the wire contract with the backend
/// (`syncService.ENTITY_TYPES`). Do not rename them without changing the
/// server at the same time: an unknown `entityType` is rejected per-operation.
class LocalEntity {
  static const account = 'account';
  static const transaction = 'transaction';
  static const budget = 'budget';
  static const goal = 'goal';
  static const loan = 'loan';
  static const investment = 'investment';

  /// Read-only reference data cached from the server. Never queued for push.
  static const category = 'category';

  /// Entities the sync engine writes back to the server.
  static const pushable = [account, transaction, budget, goal, loan, investment];

  /// Everything the pull snapshot can replace locally.
  static const snapshotEntities = [...pushable, category];

  /// Tables that participate in the "absent from snapshot means deleted"
  /// reconciliation after a pull.
  static const reconciled = snapshotEntities;
}

class SyncOperationType {
  static const create = 'CREATE';
  static const update = 'UPDATE';
  static const delete = 'DELETE';
}

class SyncOperationStatus {
  static const pending = 'PENDING';
  static const syncing = 'SYNCING';
  static const synced = 'SYNCED';
  static const failed = 'FAILED';
  static const conflict = 'CONFLICT';
}

/// Marker stored in a DELETE operation payload.
///
/// `syncService.resolveConflict` re-reads this flag when the user explicitly
/// chooses "keep local", so the delete is reproducible without the row.
const String kDeletedMarker = '__deleted';

/// Maximum number of operations the backend accepts in one push.
const int kMaxPushBatch = 200;

/// Number of attempts before a retryable failure stops auto-retrying.
const int kMaxSyncAttempts = 8;
