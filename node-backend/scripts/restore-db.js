#!/usr/bin/env node
/**
 * FinPro — PostgreSQL restore into an isolated local database.
 *
 *   node scripts/restore-db.js --file ./backups/finpro-....dump --confirm finpro_restore_123
 *   node scripts/restore-db.js --file ./backups/finpro-....dump.enc --confirm finpro_restore_123
 *   node scripts/restore-db.js --file ... --confirm ... --dry-run
 *
 * Safety:
 *  - Local-only, always. There is no flag to restore to a remote host.
 *  - Reserved databases (postgres/template0/template1) are rejected.
 *  - The target must be EMPTY. A non-empty database is never overwritten.
 *  - `--confirm <dbname>` must match the target name exactly, so a typo in a
 *    throwaway name fails instead of restoring into the wrong local database.
 *  - The archive checksum is verified against its manifest before restore.
 *  - Encrypted archives additionally require their manifest, a valid
 *    BACKUP_ENCRYPTION_KEY, and the plaintext SHA-256. The plaintext is written
 *    only to a 0700 temp directory (0600 file) and removed on exit, failure,
 *    SIGINT and SIGTERM.
 *  - Restore runs in a single transaction and fails on the first error.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertRestoreTarget,
  connectionEnv,
  sanitizeOutput,
  run,
  sha256File,
  parseArgs,
  fileExists,
  resolveArchivePath,
  restrictFile,
  assertArchiveMatchesManifest,
} = require('./lib/dbSafety');
const { decryptFile, resolveKey } = require('./lib/backupCrypto');

let tempRestoreDir = null;

const cleanupPlaintext = () => {
  if (!tempRestoreDir) return;
  try {
    fs.rmSync(tempRestoreDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
  tempRestoreDir = null;
};
process.on('exit', cleanupPlaintext);
process.on('SIGINT', () => {
  cleanupPlaintext();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupPlaintext();
  process.exit(143);
});

const fail = (message, code = 1) => {
  console.error(`[Restore] ❌ ${sanitizeOutput(message)}`);
  process.exit(code);
};

const isHex64 = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''));

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const rawArchive = args.file || args._[0];
  if (!rawArchive) {
    fail(
      'Usage: node scripts/restore-db.js --file <archive.dump|archive.dump.enc> --confirm <database>',
      2
    );
  }
  const archivePath = resolveArchivePath(rawArchive);
  if (!fileExists(archivePath)) fail(`Archive not found: ${archivePath}`, 2);

  const encrypted = archivePath.endsWith('.dump.enc');
  if (!encrypted && !archivePath.endsWith('.dump')) {
    fail('Refusing to restore a file without the .dump or .dump.enc extension.', 2);
  }

  const url = args.url || process.env.RESTORE_DATABASE_URL || process.env.DATABASE_URL;
  let target;
  try {
    target = assertRestoreTarget(url);
  } catch (err) {
    fail(err.message, 2);
  }

  const confirm = args.confirm;
  if (confirm !== target.database) {
    fail(
      `Refusing to restore: --confirm must equal the target database name exactly ` +
        `(${target.database}).`,
      2
    );
  }

  const targetLabel = `${target.host}:${target.port}/${target.database}`;
  const psql = process.env.PSQL_BIN || 'psql';
  const pgRestore = process.env.PG_RESTORE_BIN || 'pg_restore';
  const timeoutMs = Number.parseInt(process.env.RESTORE_TIMEOUT_MS || '900000', 10);
  const env = connectionEnv(target);
  const dryRun = args['dry-run'] === true;
  const allowUnverified = args['allow-unverified'] === true;

  const manifestPath = `${archivePath}.json`;
  let manifest = null;
  if (fileExists(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      fail('Archive manifest is not valid JSON; refusing to trust the archive.', 3);
    }
  }

  if (encrypted && !manifest) {
    fail(
      'Encrypted archives require their .json manifest. It carries the plaintext ' +
        'checksum needed to prove decryption succeeded. --allow-unverified cannot bypass this.',
      3
    );
  }
  if (encrypted) {
    if (
      manifest.encrypted !== true ||
      manifest.encryption?.algorithm !== 'aes-256-gcm' ||
      !Number.isFinite(manifest.plaintextBytes) ||
      manifest.plaintextBytes <= 0 ||
      !isHex64(manifest.plaintextChecksumSha256)
    ) {
      fail('Encrypted archive manifest is missing required encryption metadata.', 3);
    }
  } else if (manifest?.encrypted === true) {
    fail('Manifest describes an encrypted archive but the file is not *.dump.enc.', 3);
  }
  if (manifest?.file && manifest.file !== path.basename(archivePath)) {
    fail('Manifest file name does not match the archive being restored.', 3);
  }

  let encryptionKey = null;
  if (encrypted) {
    try {
      encryptionKey = resolveKey(process.env.BACKUP_ENCRYPTION_KEY);
    } catch (err) {
      fail(`${err.message} Encrypted restores require BACKUP_ENCRYPTION_KEY.`, 2);
    }
  }

  console.log('[Restore] ============================================================');
  console.log(`[Restore] Archive: ${archivePath}`);
  console.log(`[Restore] Target:  ${targetLabel}`);
  console.log(`[Restore] Format:  ${encrypted ? 'AES-256-GCM encrypted' : 'plaintext'}`);
  console.log(`[Restore] Mode:    ${dryRun ? 'DRY RUN' : 'restore into an empty database'}`);

  const tools = [
    [pgRestore, ['--version']],
    [psql, ['--version']],
  ];
  for (const [bin, argv] of tools) {
    const probe = run(bin, argv, { timeoutMs: 15000 });
    if (!probe.ok) fail(`${bin} is not available. Install PostgreSQL client tools.`, 3);
  }

  if (manifest) {
    try {
      await assertArchiveMatchesManifest(manifest, archivePath);
    } catch (err) {
      fail(err.message, 3);
    }
    console.log(`[Restore] ✅ Archive checksum verified (${manifest.checksumSha256.slice(0, 12)}…).`);
  } else if (!allowUnverified) {
    fail(
      'No manifest found next to the archive. Pass --allow-unverified only for a ' +
        'manually inspected plaintext archive.',
      3
    );
  } else {
    console.warn('[Restore] ⚠️  No manifest: archive checksum was NOT verified.');
  }

  let restoreArchivePath = archivePath;
  if (encrypted) {
    tempRestoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finpro-restore-'));
    fs.chmodSync(tempRestoreDir, 0o700);
    restoreArchivePath = path.join(tempRestoreDir, 'restore.dump');

    console.log('[Restore] Decrypting into a private temporary file…');
    let decrypted;
    try {
      decrypted = await decryptFile(archivePath, restoreArchivePath, encryptionKey);
    } catch (err) {
      fail(err.message, 3);
    }
    restrictFile(restoreArchivePath);

    const plaintextStat = fs.statSync(restoreArchivePath);
    if (plaintextStat.size !== manifest.plaintextBytes) {
      fail(
        `Decrypted size mismatch (manifest ${manifest.plaintextBytes}, actual ${plaintextStat.size}).`,
        3
      );
    }
    const plaintextChecksum = await sha256File(restoreArchivePath);
    if (plaintextChecksum !== manifest.plaintextChecksumSha256) {
      fail('Decrypted SHA-256 does not match the manifest plaintext checksum.', 3);
    }
    if (decrypted.plaintextBytes !== manifest.plaintextBytes) {
      fail('Decryption returned an unexpected byte count.', 3);
    }
    console.log(
      `[Restore] ✅ Decrypted and verified (${manifest.plaintextChecksumSha256.slice(0, 12)}…); ` +
        'temporary plaintext will be deleted on exit.'
    );
  }

  const isEmptyQuery =
    'SELECT count(*) FROM information_schema.tables ' +
    "WHERE table_schema NOT IN ('pg_catalog','information_schema');";
  const emptyCheck = run(psql, ['-v', 'ON_ERROR_STOP=1', '-tAc', isEmptyQuery], {
    env,
    timeoutMs: 30000,
  });
  if (!emptyCheck.ok) {
    fail(`Cannot inspect the target database:\n${sanitizeOutput(emptyCheck.stderr)}`, 4);
  }
  const tableCount = Number.parseInt(emptyCheck.stdout.trim(), 10);
  if (!Number.isFinite(tableCount)) fail('Could not read the target table count.', 4);
  if (tableCount !== 0) {
    fail(
      `Target database "${target.database}" already contains ${tableCount} table(s). ` +
        'Refusing to restore over a non-empty database. Create an empty database for recovery drills.',
      4
    );
  }
  console.log('[Restore] ✅ Target is empty.');

  if (dryRun) {
    console.log('[Restore] DRY RUN — archive verified, no changes made.');
    cleanupPlaintext();
    return;
  }

  const restore = run(
    pgRestore,
    [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--single-transaction',
      '--dbname',
      target.database,
      restoreArchivePath,
    ],
    { env, timeoutMs }
  );

  if (!restore.ok) {
    const reason = restore.timedOut ? `timed out after ${timeoutMs}ms` : `exit ${restore.status}`;
    fail(`pg_restore failed (${reason}).\n${sanitizeOutput(restore.stderr)}`, 5);
  }

  // Recovery verification: a restore that exits 0 but leaves no application
  // tables is not a usable recovery. Query only schema metadata, never row data.
  const verifyQuery =
    'SELECT count(*) FROM information_schema.tables ' +
    "WHERE table_schema NOT IN ('pg_catalog','information_schema');";
  const verifyTables = run(psql, ['-v', 'ON_ERROR_STOP=1', '-tAc', verifyQuery], {
    env,
    timeoutMs: 30000,
  });
  const verifyUser = run(
    psql,
    ['-v', 'ON_ERROR_STOP=1', '-tAc', "SELECT to_regclass('public.\"User\"') IS NOT NULL;"],
    { env, timeoutMs: 30000 }
  );

  if (!verifyTables.ok || !verifyUser.ok) {
    fail(
      `Restore finished but verification queries failed:\n${sanitizeOutput(
        verifyTables.stderr || verifyUser.stderr
      )}`,
      6
    );
  }
  const restoredTables = Number.parseInt(verifyTables.stdout.trim(), 10);
  const hasUser = verifyUser.stdout.trim() === 't';
  if (!Number.isFinite(restoredTables) || restoredTables === 0) {
    fail('Restore finished but the target has no application tables.', 6);
  }
  if (!hasUser) {
    fail('Restore finished but the expected "User" table is missing; wrong archive?', 6);
  }

  cleanupPlaintext();
  console.log(`[Restore] ✅ Restored ${restoredTables} table(s); "User" table present.`);
  console.log('[Restore] Recovery verification passed.');
  console.log('[Restore] Done.');
};

main().catch((err) => fail(err.message));
