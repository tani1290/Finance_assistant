/**
 * FinPro — Deploy-Time Database Reconciliation
 * Owner: Jinay Golecha (jinay_golecha)
 *
 * WHY THIS EXISTS
 * ---------------
 * The production database was created with `prisma db push`, so it has tables
 * but no `_prisma_migrations` history. `prisma migrate deploy` therefore fails
 * with P3005 ("The database schema is not empty"), and the previous start
 * command buried that failure behind `|| true`:
 *
 *     (npx prisma migrate deploy || npx prisma db push --accept-data-loss || true)
 *
 * The result was a server that booted happily against a database missing its
 * newest tables. Every feature touching them returned a bare HTTP 500 —
 * P2021 "The table does not exist" for FCM tokens, and SYNC_ERROR for
 * /mobile/sync and /sms/batch-ingest. Nothing in the logs said why.
 *
 * WHAT IT DOES
 * ------------
 *   1. Tries `prisma migrate deploy`      — correct path for a migration-managed DB.
 *   2. If the schema is simply non-empty and unrecorded, falls back to an
 *      ADDITIVE `prisma db push` (no `--accept-data-loss`, ever) which creates
 *      missing tables and indexes and can never drop data.
 *   3. Reports the real outcome loudly. Failures are never swallowed silently.
 *
 * CONNECTION STRING FOR MIGRATIONS
 * --------------------------------
 * Prisma cannot run DDL (CREATE/ALTER TABLE) through Supabase's *transaction*
 * pooler (port 6543, `pgbouncer=true`). If DATABASE_URL looks like one, this
 * script also retries through the matching *session* pooler (same host, port
 * 5432), which supports DDL and works over IPv4. Set DIRECT_URL to skip the
 * guesswork and point migrations at a direct/session connection explicitly.
 *
 * Usage:
 *   node scripts/deploy-migrate.js            # never blocks boot (deploy default)
 *   node scripts/deploy-migrate.js --strict   # exit 1 if the schema is not in sync (CI)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

const MIGRATE_TIMEOUT_MS = 90_000;
const PUSH_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Prisma CLI resolution (mirrors scripts/build.js so it works with or without npx)
// ---------------------------------------------------------------------------
const prismaBin = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const PRISMA =
  fs.existsSync(prismaBin)
    ? [process.execPath, prismaBin]
    : process.platform === 'win32'
      ? ['npx.cmd', 'prisma']
      : ['npx', 'prisma'];

function banner(line) {
  console.log(`\n[DB] ============================================================`);
  console.log(`[DB] ${line}`);
  console.log(`[DB] ============================================================`);
}

function runPrisma(args, databaseUrl, timeoutMs) {
  const started = Date.now();
  const res = spawnSync(PRISMA[0], [...PRISMA.slice(1), ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    timedOut: res.signal === 'SIGTERM' || res.error?.code === 'ETIMEDOUT',
    output: `${res.stdout || ''}${res.stderr || ''}`.trim(),
    ms: Date.now() - started,
  };
}

/** Mask credentials so a log line can never leak the database password. */
function maskUrl(raw) {
  if (!raw) return '(unset)';
  try {
    const u = new URL(raw);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(unparseable url)';
  }
}

/**
 * Supabase transaction pooler -> session pooler.
 * Host and user stay identical; only the port changes (6543 -> 5432) and the
 * pgbouncer-only query parameters (unsupported in session mode) are dropped.
 */
function sessionPoolerUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const looksPooled = /pooler\.supabase\.com$/i.test(u.hostname) || u.port === '6543';
    if (!looksPooled) return null;

    u.port = '5432';
    u.searchParams.delete('pgbouncer');
    u.searchParams.delete('connection_limit');
    u.searchParams.delete('pool_timeout');
    if (!u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');

    const out = u.toString();
    return out === raw ? null : out;
  } catch {
    return null;
  }
}

const NON_EMPTY_SCHEMA = /P3005|schema is not empty|not in a valid state|baseline/i;
const CONNECTION_TROUBLE =
  /P1001|P1017|P2028|P1002|prepared statement|pgbouncer|timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|08P01|ENOTFOUND|cannot use|would require DDL/i;

// ---------------------------------------------------------------------------
// Build the ordered list of connections to try
// ---------------------------------------------------------------------------
const candidates = [];
const seen = new Set();
const addCandidate = (label, url) => {
  if (!url || seen.has(url)) return;
  seen.add(url);
  candidates.push({ label, url });
};

addCandidate('DIRECT_URL', process.env.DIRECT_URL);
addCandidate('DATABASE_URL', process.env.DATABASE_URL);
addCandidate('DATABASE_URL (session pooler, port 5432)', sessionPoolerUrl(process.env.DATABASE_URL));

if (candidates.length === 0) {
  banner('No DATABASE_URL configured — skipping schema reconciliation.');
  process.exit(STRICT ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------
let reconciled = false;
let lastFailure = null;

for (const { label, url } of candidates) {
  console.log(`\n[DB] Attempting schema reconciliation via ${label}: ${maskUrl(url)}`);

  console.log(`[DB]   -> prisma migrate deploy`);
  const migrate = runPrisma(['migrate', 'deploy'], url, MIGRATE_TIMEOUT_MS);

  if (migrate.ok) {
    console.log(`[DB]   -> migrate deploy OK (${migrate.ms}ms) — database is migration-managed and up to date ✓`);
    reconciled = true;
    break;
  }

  console.log(migrate.output);
  lastFailure = { label, step: 'migrate deploy', output: migrate.output };

  if (NON_EMPTY_SCHEMA.test(migrate.output)) {
    // Tables exist but no migration history: adopt the schema additively.
    console.log(
      `[DB]   -> schema is non-empty and unrecorded (no _prisma_migrations history).\n` +
        `[DB]      Falling back to an additive \`prisma db push\` (never --accept-data-loss).`
    );

    const push = runPrisma(['db', 'push'], url, PUSH_TIMEOUT_MS);
    console.log(push.output);

    if (push.ok) {
      console.log(`[DB]   -> db push OK (${push.ms}ms) — missing tables/indexes created ✓`);
      reconciled = true;
      break;
    }

    lastFailure = { label, step: 'db push', output: push.output };
  } else if (!CONNECTION_TROUBLE.test(migrate.output)) {
    console.log(`[DB]   -> unexpected migrate deploy failure on this connection; trying next candidate.`);
  } else {
    console.log(`[DB]   -> this connection cannot run migrations (pooler/DDL restriction); trying next candidate.`);
  }
}

if (reconciled) {
  banner('DATABASE SCHEMA RECONCILED SUCCESSFULLY ✓');
  process.exit(0);
}

banner('DATABASE SCHEMA COULD NOT BE RECONCILED — FEATURES MAY RETURN HTTP 500');
console.log(`[DB] Last ${lastFailure ? `${lastFailure.step} via ${lastFailure.label}` : 'attempt'} failed.`);
console.log('[DB] The server will still boot so the rest of the app stays available.');
console.log('[DB] To fix: set DIRECT_URL in the Render dashboard to your Supabase');
console.log('[DB]   *direct* connection (db.<ref>.supabase.co:5432) or *session pooler*');
console.log('[DB]   (aws-0-<region>.pooler.supabase.com:5432), then redeploy.');
console.log('[DB] Prisma cannot run DDL through the transaction pooler (port 6543).');

process.exit(STRICT ? 1 : 0);
