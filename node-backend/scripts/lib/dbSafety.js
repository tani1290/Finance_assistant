/**
 * FinPro — database backup/restore safety helpers.
 *
 * These functions are intentionally pure/testable. They are the guardrail that
 * stops a mistyped command from dumping or restoring a managed production
 * database by accident.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RESERVED_DATABASES = new Set(['postgres', 'template0', 'template1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const isLocalHost = (host) => LOCAL_HOSTS.has(String(host || '').toLowerCase());

const parseDatabaseUrl = (raw) => {
  if (!raw) {
    const err = new Error('No database URL provided. Set BACKUP_DATABASE_URL/RESTORE_DATABASE_URL or pass --url.');
    err.code = 'NO_DATABASE_URL';
    throw err;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const err = new Error('Database URL is not a valid URL.');
    err.code = 'INVALID_DATABASE_URL';
    throw err;
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    const err = new Error('Only postgres:// or postgresql:// URLs are supported.');
    err.code = 'INVALID_DATABASE_URL';
    throw err;
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    const err = new Error('Database URL does not name a database.');
    err.code = 'INVALID_DATABASE_URL';
    throw err;
  }
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database,
    sslmode: parsed.searchParams.get('sslmode') || '',
    raw,
  };
};

/**
 * Backups may target a remote managed database, but only when the operator
 * opts in twice: `--allow-non-local` AND BACKUP_ALLOW_NON_LOCAL=true. The
 * default is local-only so a copy/pasted production URL cannot dump silently.
 */
const assertBackupTarget = (url, { allowNonLocal = false, env = process.env } = {}) => {
  const target = parseDatabaseUrl(url);
  if (!isLocalHost(target.host)) {
    if (!allowNonLocal) {
      const err = new Error(
        `Refusing to back up non-local host "${target.host}". ` +
          'Pass --allow-non-local and set BACKUP_ALLOW_NON_LOCAL=true for a deliberate remote backup.'
      );
      err.code = 'REMOTE_BACKUP_REFUSED';
      throw err;
    }
    if (env.BACKUP_ALLOW_NON_LOCAL !== 'true') {
      const err = new Error('Remote backup requires BACKUP_ALLOW_NON_LOCAL=true in addition to --allow-non-local.');
      err.code = 'REMOTE_BACKUP_REFUSED';
      throw err;
    }
  }
  return target;
};

/**
 * Restores are ALWAYS local-only. There is no override: recovery must be tested
 * in an isolated throwaway database, never over production or a shared dev DB.
 */
const assertRestoreTarget = (url) => {
  const target = parseDatabaseUrl(url);
  if (!isLocalHost(target.host)) {
    const err = new Error(
      `Refusing to restore into non-local host "${target.host}". Restores are local-only by design.`
    );
    err.code = 'REMOTE_RESTORE_REFUSED';
    throw err;
  }
  if (RESERVED_DATABASES.has(target.database.toLowerCase())) {
    const err = new Error(`Refusing to restore into reserved database "${target.database}".`);
    err.code = 'RESERVED_DATABASE_REFUSED';
    throw err;
  }
  return target;
};

/** Child-process environment using discrete PG* variables (no URL in argv). */
const connectionEnv = (target, baseEnv = process.env) => {
  const env = { ...baseEnv };
  delete env.DATABASE_URL;
  delete env.DIRECT_URL;
  delete env.PGSERVICE;
  env.PGHOST = target.host;
  env.PGPORT = target.port;
  env.PGUSER = target.user;
  env.PGDATABASE = target.database;
  if (target.password) env.PGPASSWORD = target.password;
  else delete env.PGPASSWORD;
  if (target.sslmode) env.PGSSLMODE = target.sslmode;
  else delete env.PGSSLMODE;
  return env;
};

const sanitizeOutput = (value) =>
  String(value || '')
    // postgresql://user:password@host -> postgresql://[redacted]@host
    .replace(/postgres(ql)?:\/\/[^@\s]+@/gi, 'postgresql://[redacted]@')
    .replace(/(password\s*=\s*)\S+/gi, '$1[redacted]')
    .slice(0, 4000);

const run = (command, args, { env, timeoutMs = 10 * 60 * 1000, input } = {}) => {
  const result = spawnSync(command, args, {
    env,
    input,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
    timedOut: result.signal === 'SIGTERM' || result.error?.code === 'ETIMEDOUT',
  };
};

const sha256File = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });

const timestampForFile = (date = new Date()) =>
  date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');

/**
 * The archive file name for a backup. Kept here (instead of inline in the
 * script) so the "never overwrite an existing backup" rule can be tested
 * without a live database.
 */
const backupFileName = ({ database, stamp, encrypted = false } = {}) => {
  const name = `finpro-${database}-${stamp}.dump`;
  return encrypted ? `${name}.enc` : name;
};

/**
 * Refuse to overwrite an existing archive or manifest. A backup that silently
 * replaces a good copy with a partial one is worse than no backup at all.
 */
const assertNoExistingOutputs = (filePath, manifestPath) => {
  if (filePath && fileExists(filePath)) {
    const err = new Error(`Refusing to overwrite an existing backup: ${filePath}`);
    err.code = 'BACKUP_EXISTS';
    throw err;
  }
  if (manifestPath && fileExists(manifestPath)) {
    const err = new Error(`Refusing to overwrite an existing manifest: ${manifestPath}`);
    err.code = 'BACKUP_EXISTS';
    throw err;
  }
  return true;
};

/**
 * Verify an archive against the manifest that describes it: byte length first
 * (cheap), then the SHA-256 of the whole file. Returns the verified checksum.
 */
const assertArchiveMatchesManifest = async (manifest, archivePath) => {
  if (!manifest || typeof manifest !== 'object') {
    const err = new Error('Archive manifest is missing or not an object.');
    err.code = 'MANIFEST_INVALID';
    throw err;
  }
  const stat = fs.statSync(archivePath);
  if (!Number.isFinite(manifest.bytes)) {
    const err = new Error('Archive manifest is missing the byte count; refusing to trust it.');
    err.code = 'MANIFEST_INVALID';
    throw err;
  }
  if (manifest.bytes !== stat.size) {
    const err = new Error(
      `Archive size mismatch (manifest ${manifest.bytes}, actual ${stat.size}). ` +
        'The file was truncated or altered.'
    );
    err.code = 'ARCHIVE_SIZE_MISMATCH';
    throw err;
  }
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.checksumSha256 || ''))) {
    const err = new Error('Archive manifest is missing a valid SHA-256; refusing to trust it.');
    err.code = 'MANIFEST_INVALID';
    throw err;
  }
  const actual = await sha256File(archivePath);
  if (manifest.checksumSha256 !== actual) {
    const err = new Error('Archive SHA-256 does not match its manifest. Refusing to restore.');
    err.code = 'ARCHIVE_CHECKSUM_MISMATCH';
    throw err;
  }
  return actual;
};

const selectExpiredBackups = (files, retentionDays, now = Date.now()) => {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return [];
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return files
    .filter((file) => /^finpro-.+\.dump(\.enc)?$/.test(file.name))
    .filter((file) => file.mtimeMs < cutoff)
    .map((file) => file.name);
};

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split('=');
    if (inline !== undefined) {
      args[key] = inline;
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
};

const ensurePrivateDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // non-POSIX filesystem
  }
};

const restrictFile = (filePath) => {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // non-POSIX filesystem
  }
};

const fileExists = (filePath) => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const resolveArchivePath = (raw, cwd = process.cwd()) => path.resolve(cwd, raw);

module.exports = {
  RESERVED_DATABASES,
  isLocalHost,
  parseDatabaseUrl,
  assertBackupTarget,
  assertRestoreTarget,
  connectionEnv,
  sanitizeOutput,
  run,
  sha256File,
  timestampForFile,
  backupFileName,
  assertNoExistingOutputs,
  assertArchiveMatchesManifest,
  selectExpiredBackups,
  parseArgs,
  ensurePrivateDir,
  restrictFile,
  fileExists,
  resolveArchivePath,
};
