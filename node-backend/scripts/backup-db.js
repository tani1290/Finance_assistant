#!/usr/bin/env node
/**
 * FinPro — consistent PostgreSQL logical backup.
 *
 *   node scripts/backup-db.js --dry-run
 *   node scripts/backup-db.js
 *   node scripts/backup-db.js --out-dir ./backups --retention-days 14
 *   BACKUP_ENCRYPTION_KEY=... node scripts/backup-db.js --encrypt
 *
 * Safety:
 *  - Local-only by default. A remote target needs BOTH --allow-non-local and
 *    BACKUP_ALLOW_NON_LOCAL=true, so a pasted production URL cannot dump by
 *    accident.
 *  - Uses pg_dump's own consistent snapshot. Never tar a live data directory.
 *  - The plaintext staging file is private (0600) and removed after encryption or
 *    on every failure path.
 *  - Writes a SHA-256 manifest, verifies the archive with pg_restore --list and
 *    prunes only files this tool created, after a successful run.
 *  - Credentials are passed through PG* environment variables, never argv, and
 *    never printed.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const {
  assertBackupTarget,
  connectionEnv,
  sanitizeOutput,
  run,
  sha256File,
  timestampForFile,
  selectExpiredBackups,
  parseArgs,
  ensurePrivateDir,
  restrictFile,
  fileExists,
  backupFileName,
  assertNoExistingOutputs,
} = require('./lib/dbSafety');
const { resolveKey, encryptFile } = require('./lib/backupCrypto');

const ROOT = path.resolve(__dirname, '..');
const stagingFiles = new Set();

const cleanupStaging = () => {
  for (const staging of stagingFiles) {
    try {
      if (fs.existsSync(staging)) fs.unlinkSync(staging);
    } catch {
      // best effort
    }
  }
  stagingFiles.clear();
};
process.on('exit', cleanupStaging);

const fail = (message, code = 1) => {
  console.error(`[Backup] ❌ ${sanitizeOutput(message)}`);
  process.exit(code);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url || process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;

  let target;
  try {
    target = assertBackupTarget(url, {
      allowNonLocal: args['allow-non-local'] === true,
      env: process.env,
    });
  } catch (err) {
    fail(err.message, 2);
  }

  const outDir = path.resolve(
    ROOT,
    args['out-dir'] || process.env.BACKUP_DIR || path.join(ROOT, 'backups')
  );
  const retentionDays = Number.parseInt(
    args['retention-days'] ?? process.env.BACKUP_RETENTION_DAYS ?? '14',
    10
  );
  const pgDump = process.env.PG_DUMP_BIN || 'pg_dump';
  const pgRestore = process.env.PG_RESTORE_BIN || 'pg_restore';
  const timeoutMs = Number.parseInt(process.env.BACKUP_TIMEOUT_MS || '600000', 10);
  const dryRun = args['dry-run'] === true;
  const skipVerify = args['skip-verify'] === true;

  const encryptionRequested = args.encrypt === true;
  const encryptionDisabled = args['no-encrypt'] === true;
  if (encryptionRequested && encryptionDisabled) {
    fail('--encrypt and --no-encrypt cannot be used together.', 2);
  }
  const keyPresent = Boolean(process.env.BACKUP_ENCRYPTION_KEY);
  if (encryptionRequested && !keyPresent) {
    fail(
      '--encrypt requires BACKUP_ENCRYPTION_KEY (base64-encoded 32 bytes or 64 hex characters).',
      2
    );
  }
  const shouldEncrypt = encryptionRequested || (keyPresent && !encryptionDisabled);
  let encryptionKey = null;
  if (shouldEncrypt) {
    try {
      encryptionKey = resolveKey(process.env.BACKUP_ENCRYPTION_KEY);
    } catch (err) {
      fail(err.message, 2);
    }
  } else if (keyPresent && encryptionDisabled) {
    console.warn(
      '[Backup] ⚠️  BACKUP_ENCRYPTION_KEY is set but --no-encrypt was supplied; ' +
        'the archive will be plaintext.'
    );
  }

  const stamp = timestampForFile();
  const fileName = backupFileName({
    database: target.database,
    stamp,
    encrypted: shouldEncrypt,
  });
  const filePath = path.join(outDir, fileName);
  const manifestPath = `${filePath}.json`;
  const stagingName = `.${fileName}.partial-${process.pid}-${Date.now()}`;
  const stagingPath = path.join(outDir, stagingName);
  stagingFiles.add(stagingPath);
  const displayTarget = `${target.host}:${target.port}/${target.database}`;
  const env = connectionEnv(target);

  const pgDumpVersion = run(pgDump, ['--version'], { timeoutMs: 15000 });
  if (!pgDumpVersion.ok) {
    fail(
      `pg_dump is not available (${pgDump}). Install PostgreSQL client tools on the backup host.`,
      3
    );
  }
  const pgRestoreVersion = run(pgRestore, ['--version'], { timeoutMs: 15000 });
  if (!skipVerify && !pgRestoreVersion.ok) {
    fail(`pg_restore is not available (${pgRestore}); cannot verify the archive.`, 3);
  }

  console.log('[Backup] ============================================================');
  console.log(`[Backup] Target:   ${displayTarget}`);
  console.log(`[Backup] Output:   ${filePath}`);
  console.log(`[Backup] Encryption: ${shouldEncrypt ? 'AES-256-GCM (not yet written)' : 'none'}`);
  console.log(
    `[Backup] Retention: ${
      Number.isFinite(retentionDays) && retentionDays > 0 ? `${retentionDays} days` : 'keep forever'
    }`
  );
  console.log(`[Backup] pg_dump:  ${pgDumpVersion.stdout.trim()}`);

  if (dryRun) {
    console.log('[Backup] DRY RUN — no dump written, no files pruned.');
    return;
  }

  try {
    assertNoExistingOutputs(filePath, manifestPath);
  } catch (err) {
    fail(err.message, 2);
  }
  ensurePrivateDir(outDir);

  const dump = run(
    pgDump,
    [
      '--format=custom',
      '--compress=9',
      '--no-owner',
      '--no-privileges',
      '--lock-wait-timeout=15000',
      '--file',
      stagingPath,
    ],
    { env, timeoutMs }
  );

  if (!dump.ok) {
    const reason = dump.timedOut ? `timed out after ${timeoutMs}ms` : `exit ${dump.status}`;
    fail(`pg_dump failed (${reason}).\n${sanitizeOutput(dump.stderr || dump.error?.message)}`);
  }

  if (!fileExists(stagingPath)) fail('pg_dump reported success but no archive exists.');
  restrictFile(stagingPath);
  const plaintextBytes = fs.statSync(stagingPath).size;
  if (plaintextBytes < 1024) {
    fail(`Archive is suspiciously small (${plaintextBytes} bytes); refusing to record it as a backup.`);
  }

  let tableCount = null;
  if (!skipVerify) {
    const verify = run(pgRestore, ['--list', stagingPath], { timeoutMs: 60000 });
    if (!verify.ok) {
      fail(`Archive verification failed; deleted the corrupt file.\n${sanitizeOutput(verify.stderr)}`);
    }
    // pg_restore --list prints one "TABLE DATA" line per table, plus ACL/comment
    // entries. Count table entries only for a useful (non-sensitive) metric.
    tableCount = verify.stdout
      .split('\n')
      .filter((line) => !line.startsWith(';') && line.includes(' TABLE DATA '))
      .length;
    if (tableCount === 0) {
      fail('Archive contains no table data; refusing to record it as a valid backup.');
    }
  }

  const plaintextChecksum = await sha256File(stagingPath);
  let finalBytes;
  let finalChecksum;
  let encryption = null;

  if (shouldEncrypt) {
    let encrypted;
    try {
      encrypted = await encryptFile(stagingPath, filePath, encryptionKey);
    } catch (err) {
      fail(err.message, 3);
    }
    if (
      encrypted.plaintextBytes !== plaintextBytes ||
      encrypted.plaintextChecksumSha256 !== plaintextChecksum
    ) {
      fail('Encryption read a different byte stream than the one that was verified.', 3);
    }
    try {
      fs.unlinkSync(stagingPath);
      stagingFiles.delete(stagingPath);
    } catch {
      // exit cleanup will retry
    }
    finalBytes = fs.statSync(filePath).size;
    finalChecksum = await sha256File(filePath);
    encryption = {
      algorithm: encrypted.algorithm,
      version: encrypted.version,
      keyEnv: 'BACKUP_ENCRYPTION_KEY',
    };
  } else {
    try {
      fs.renameSync(stagingPath, filePath);
      stagingFiles.delete(stagingPath);
    } catch (err) {
      fail(`Could not finalise the backup archive: ${sanitizeOutput(err.message)}`);
    }
    finalBytes = plaintextBytes;
    finalChecksum = plaintextChecksum;
  }

  if (!fileExists(filePath)) fail('Backup archive is missing after finalisation.');
  if (finalBytes < 1024) fail(`Final archive is suspiciously small (${finalBytes} bytes).`);
  restrictFile(filePath);

  const manifest = {
    format: shouldEncrypt ? 'finpro-postgres-custom+enc' : 'finpro-postgres-custom',
    encrypted: shouldEncrypt,
    createdAt: new Date().toISOString(),
    source: { host: target.host, port: target.port, database: target.database },
    file: fileName,
    bytes: finalBytes,
    checksumSha256: finalChecksum,
    plaintextBytes,
    plaintextChecksumSha256: plaintextChecksum,
    tableCount,
    pgDumpVersion: pgDumpVersion.stdout.trim(),
    retentionDays: Number.isFinite(retentionDays) ? retentionDays : null,
  };
  if (encryption) manifest.encryption = encryption;

  try {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    restrictFile(manifestPath);
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // best effort
    }
    fail(`Could not write the backup manifest: ${sanitizeOutput(err.message)}`);
  }

  console.log(
    `[Backup] ✅ Archive: ${(finalBytes / (1024 * 1024)).toFixed(2)} MiB, ${tableCount ?? '?'} tables`
  );
  console.log(`[Backup] ✅ SHA-256: ${finalChecksum}`);
  console.log(
    `[Backup] ✅ Encryption: ${
      shouldEncrypt ? 'AES-256-GCM; plaintext staging file removed' : 'none'
    }`
  );
  console.log(`[Backup] ✅ Manifest: ${manifestPath}`);

  // Retention: only delete files this tool owns, and only after a verified backup.
  if (Number.isFinite(retentionDays) && retentionDays > 0) {
    const files = fs
      .readdirSync(outDir)
      .filter((name) => /^finpro-.+\.dump(\.enc)?$/.test(name))
      .map((name) => {
        const full = path.join(outDir, name);
        return { name, mtimeMs: fs.statSync(full).mtimeMs };
      });
    const expired = selectExpiredBackups(files, retentionDays);
    for (const name of expired) {
      const full = path.join(outDir, name);
      try {
        fs.unlinkSync(full);
        if (fs.existsSync(`${full}.json`)) fs.unlinkSync(`${full}.json`);
        console.log(`[Backup] Pruned expired archive: ${name}`);
      } catch (err) {
        console.warn(`[Backup] Could not prune ${name}: ${sanitizeOutput(err.message)}`);
      }
    }
    if (expired.length === 0) console.log('[Backup] Retention: nothing to prune.');
  }

  console.log('[Backup] Done.');
};

main().catch((err) => fail(err.message));
