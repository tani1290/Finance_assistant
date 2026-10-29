#!/usr/bin/env node
/**
 * FinPro — backup/restore recovery drill.
 *
 * Creates throwaway LOCAL databases, seeds one, runs the real backup and restore
 * scripts, verifies the row survived, then drops every database it created.
 *
 *   node scripts/verify-backup-restore.js
 *
 * It refuses to run against anything but 127.0.0.1 and only creates/drops
 * databases whose names start with `finpro_bk_verify_`. No production URL is
 * read: the script builds its own local connection strings.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { run, sanitizeOutput } = require('./lib/dbSafety');

const HOST = '127.0.0.1';
const PORT = process.env.PGPORT || '5432';
const USER = process.env.PGUSER || os.userInfo().username;
const PREFIX = 'finpro_bk_verify_';
const suffix = `${process.pid}_${Date.now().toString(36)}`;
const sourceDb = `${PREFIX}src_${suffix}`;
const targetDb = `${PREFIX}dst_${suffix}`;
const encryptedTargetDb = `${PREFIX}enc_${suffix}`;
const wrongKeyDb = `${PREFIX}wrongkey_${suffix}`;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finpro-backup-verify-'));
const baseEnv = { ...process.env, PGHOST: HOST, PGPORT: PORT, PGUSER: USER };
delete baseEnv.DATABASE_URL;
delete baseEnv.DIRECT_URL;

const fail = (message) => {
  console.error(`[Drill] ❌ ${sanitizeOutput(message)}`);
  process.exitCode = 1;
};

// The drill builds its own local connection strings, so it must carry the
// password from the environment when the server requires password auth. CI's
// postgres service does; without this, connectionEnv() clears PGPASSWORD for the
// child process and pg_dump fails with "fe_sendauth: no password supplied".
const PASSWORD = process.env.PGPASSWORD || '';

const localUrl = (database) => {
  const credentials = PASSWORD
    ? `${encodeURIComponent(USER)}:${encodeURIComponent(PASSWORD)}`
    : encodeURIComponent(USER);
  return `postgresql://${credentials}@${HOST}:${PORT}/${encodeURIComponent(database)}`;
};

const createdb = (database) => {
  const result = run('createdb', ['-h', HOST, '-p', PORT, database], { env: baseEnv, timeoutMs: 30000 });
  if (!result.ok) throw new Error(`createdb ${database} failed: ${sanitizeOutput(result.stderr)}`);
};

const dropdb = (database) => {
  const result = run('dropdb', ['--if-exists', '--force', '-h', HOST, '-p', PORT, database], {
    env: baseEnv,
    timeoutMs: 30000,
  });
  if (!result.ok) console.warn(`[Drill] cleanup: ${sanitizeOutput(result.stderr)}`);
};

const psql = (database, sql, env = baseEnv) => {
  const result = run('psql', ['-h', HOST, '-p', PORT, '-d', database, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    env,
    timeoutMs: 30000,
  });
  if (!result.ok) throw new Error(sanitizeOutput(result.stderr));
  return result.stdout.trim();
};

const child = (script, args, env) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    env,
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
};

let cleanedUp = false;
const cleanup = () => {
  if (cleanedUp) return;
  cleanedUp = true;
  dropdb(wrongKeyDb);
  dropdb(encryptedTargetDb);
  dropdb(targetDb);
  dropdb(sourceDb);
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
};
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

try {
  const ready = run('pg_isready', ['-h', HOST, '-p', PORT], { env: baseEnv, timeoutMs: 10000 });
  if (!ready.ok) {
    console.error(
      `[Drill] ⚠️  Local PostgreSQL is not reachable at ${HOST}:${PORT}. ` +
        'Start it and re-run. The drill was NOT executed.'
    );
    process.exit(2);
  }

  console.log('[Drill] ============================================================');
  console.log(`[Drill] Source DB: ${sourceDb}`);
  console.log(`[Drill] Target DB: ${targetDb}`);
  console.log(`[Drill] Work dir:  ${workDir}`);

  createdb(sourceDb);
  createdb(targetDb);

  psql(
    sourceDb,
    'CREATE TABLE "User" (id text PRIMARY KEY, name text NOT NULL);' +
      "INSERT INTO \"User\" (id, name) VALUES ('u1', 'Ada Lovelace');" +
      'CREATE TABLE "_prisma_migrations" (id text PRIMARY KEY);' +
      "INSERT INTO \"_prisma_migrations\" (id) VALUES ('m1');"
  );
  console.log('[Drill] ✅ Seeded source database.');

  const backup = child(
    path.join(__dirname, 'backup-db.js'),
    ['--out-dir', workDir, '--retention-days', '0'],
    { ...baseEnv, BACKUP_DATABASE_URL: localUrl(sourceDb), BACKUP_ALLOW_NON_LOCAL: 'false' }
  );
  if (!backup.ok) throw new Error(`Backup failed:\n${sanitizeOutput(backup.stderr || backup.stdout)}`);
  const archive = fs.readdirSync(workDir).find((name) => /^finpro-.+\.dump$/.test(name));
  if (!archive) throw new Error('Backup script did not produce an archive.');
  console.log(`[Drill] ✅ Backup created: ${archive}`);

  const restore = child(
    path.join(__dirname, 'restore-db.js'),
    ['--file', path.join(workDir, archive), '--confirm', targetDb],
    { ...baseEnv, RESTORE_DATABASE_URL: localUrl(targetDb) }
  );
  if (!restore.ok) throw new Error(`Restore failed:\n${sanitizeOutput(restore.stderr || restore.stdout)}`);
  console.log('[Drill] ✅ Restore script reported success.');

  const rows = psql(targetDb, 'SELECT count(*) FROM "User";');
  const name = psql(targetDb, "SELECT name FROM \"User\" WHERE id = 'u1';");
  const tables = psql(
    targetDb,
    "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');"
  );
  if (rows !== '1' || name !== 'Ada Lovelace' || Number(tables) < 2) {
    throw new Error(`Verification mismatch: rows=${rows}, name=${name}, tables=${tables}`);
  }
  console.log(`[Drill] ✅ Recovered ${tables} tables and the seeded row ("${name}").`);

  // A restore into a non-empty database must be refused. This is a guard test,
  // not a destructive test: it runs against the already-populated target.
  const secondRestore = child(
    path.join(__dirname, 'restore-db.js'),
    ['--file', path.join(workDir, archive), '--confirm', targetDb],
    { ...baseEnv, RESTORE_DATABASE_URL: localUrl(targetDb) }
  );
  const refused = !secondRestore.ok && /non-empty|already contains/i.test(`${secondRestore.stdout}\n${secondRestore.stderr}`);
  if (!refused) throw new Error('Restore into a non-empty database was not refused.');
  console.log('[Drill] ✅ Restore over a non-empty database was refused.');

  // Encrypted round trip: backup with AES-256-GCM, restore with the same key,
  // and prove a wrong key cannot write anything into an empty target.
  const encryptionKey = crypto.randomBytes(32).toString('base64');
  const encryptedBackup = child(
    path.join(__dirname, 'backup-db.js'),
    ['--out-dir', workDir, '--retention-days', '0', '--encrypt'],
    {
      ...baseEnv,
      BACKUP_DATABASE_URL: localUrl(sourceDb),
      BACKUP_ALLOW_NON_LOCAL: 'false',
      BACKUP_ENCRYPTION_KEY: encryptionKey,
    }
  );
  if (!encryptedBackup.ok) {
    throw new Error(`Encrypted backup failed:\n${sanitizeOutput(encryptedBackup.stderr || encryptedBackup.stdout)}`);
  }
  const encryptedArchive = fs
    .readdirSync(workDir)
    .find((name) => /^finpro-.+\.dump\.enc$/.test(name));
  if (!encryptedArchive) throw new Error('Encryption was requested but no .dump.enc archive exists.');
  const encryptedManifestPath = path.join(workDir, `${encryptedArchive}.json`);
  if (!fs.existsSync(encryptedManifestPath)) throw new Error('Encrypted backup manifest is missing.');
  const encryptedManifest = JSON.parse(fs.readFileSync(encryptedManifestPath, 'utf8'));
  if (
    encryptedManifest.encrypted !== true ||
    encryptedManifest.encryption?.algorithm !== 'aes-256-gcm' ||
    !/^[a-f0-9]{64}$/i.test(encryptedManifest.plaintextChecksumSha256 || '')
  ) {
    throw new Error('Encrypted backup manifest is missing required metadata.');
  }
  console.log(`[Drill] ✅ Encrypted backup created: ${encryptedArchive}`);

  createdb(encryptedTargetDb);
  const encryptedRestore = child(
    path.join(__dirname, 'restore-db.js'),
    ['--file', path.join(workDir, encryptedArchive), '--confirm', encryptedTargetDb],
    {
      ...baseEnv,
      RESTORE_DATABASE_URL: localUrl(encryptedTargetDb),
      BACKUP_ENCRYPTION_KEY: encryptionKey,
    }
  );
  if (!encryptedRestore.ok) {
    throw new Error(
      `Encrypted restore failed:\n${sanitizeOutput(encryptedRestore.stderr || encryptedRestore.stdout)}`
    );
  }
  const encryptedRows = psql(encryptedTargetDb, 'SELECT count(*) FROM "User";');
  const encryptedName = psql(encryptedTargetDb, "SELECT name FROM \"User\" WHERE id = 'u1';");
  if (encryptedRows !== '1' || encryptedName !== 'Ada Lovelace') {
    throw new Error(`Encrypted verification mismatch: rows=${encryptedRows}, name=${encryptedName}`);
  }
  console.log(`[Drill] ✅ Encrypted archive decrypted and recovered the seeded row ("${encryptedName}").`);

  createdb(wrongKeyDb);
  const wrongKey = crypto.randomBytes(32).toString('base64');
  const wrongKeyRestore = child(
    path.join(__dirname, 'restore-db.js'),
    ['--file', path.join(workDir, encryptedArchive), '--confirm', wrongKeyDb],
    {
      ...baseEnv,
      RESTORE_DATABASE_URL: localUrl(wrongKeyDb),
      BACKUP_ENCRYPTION_KEY: wrongKey,
    }
  );
  const wrongKeyRefused =
    !wrongKeyRestore.ok &&
    /decryption failed|wrong encryption key|modified/i.test(
      `${wrongKeyRestore.stdout}\n${wrongKeyRestore.stderr}`
    );
  if (!wrongKeyRefused) throw new Error('A wrong encryption key was not rejected.');
  const wrongKeyTables = psql(
    wrongKeyDb,
    "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');"
  );
  if (wrongKeyTables !== '0') {
    throw new Error(`Wrong-key restore wrote ${wrongKeyTables} table(s) before failing.`);
  }
  console.log('[Drill] ✅ Wrong encryption key was rejected without writing to the target.');

  console.log('[Drill] Recovery drill PASSED.');
} catch (err) {
  fail(err.message);
} finally {
  cleanup();
}

if (process.exitCode) process.exit(process.exitCode);
