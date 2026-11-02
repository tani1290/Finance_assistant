import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Owns the on-device SQLite file.
///
/// There is deliberately no cloud dependency here: the local database is the
/// primary write target. Sync only ever reads or reconciles with it.
class LocalDatabase {
  LocalDatabase._(this.db);

  final Database db;

  static const _fileName = 'finpro_local.db';
  static const _schemaVersion = 1;

  static Future<LocalDatabase> open() async {
    final dir = await getDatabasesPath();
    final path = p.join(dir, _fileName);
    final db = await openDatabase(
      path,
      version: _schemaVersion,
      onConfigure: (database) async {
        await database.execute('PRAGMA foreign_keys = ON');
      },
      onCreate: _create,
      onUpgrade: _upgrade,
    );
    return LocalDatabase._(db);
  }

  static Future<LocalDatabase> openFor(String userId) => open();

  static Future<void> _create(Database db, int version) async {
    final batch = db.batch();

    batch.execute('''
      CREATE TABLE local_records (
        user_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        server_updated_at TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        PRIMARY KEY (user_id, entity_type, id)
      )
    ''');
    batch.execute('''
      CREATE INDEX idx_local_records_user_entity
        ON local_records (user_id, entity_type, is_deleted)
    ''');

    batch.execute('''
      CREATE TABLE sync_operations (
        op_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        data TEXT,
        base_updated_at TEXT,
        base_version INTEGER,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        result TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    ''');
    batch.execute('''
      CREATE INDEX idx_sync_ops_queue
        ON sync_operations (user_id, status, next_attempt_at, created_at)
    ''');
    batch.execute('''
      CREATE INDEX idx_sync_ops_entity
        ON sync_operations (user_id, entity_type, entity_id, status)
    ''');

    batch.execute('''
      CREATE TABLE sync_meta (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, key)
      )
    ''');

    batch.execute('''
      CREATE TABLE sync_conflicts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        op_id TEXT,
        reason TEXT,
        local_payload TEXT,
        server_payload TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN',
        resolution TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    ''');
    batch.execute('''
      CREATE INDEX idx_sync_conflicts_user_status
        ON sync_conflicts (user_id, status)
    ''');

    await batch.commit(noResult: true);
  }

  static Future<void> _upgrade(Database db, int oldVersion, int newVersion) async {
    // Schema v1 is the first local-first schema. Future migrations are additive
    // and must never drop user financial data.
    if (oldVersion < 1) {
      await _create(db, newVersion);
      return;
    }
  }

  Future<void> close() => db.close();
}
