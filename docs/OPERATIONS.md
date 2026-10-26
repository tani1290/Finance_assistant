# FinPro — Operations Guide

**Scope:** How the deployed API behaves under dependency failure, what each health
endpoint means, how the optional cache and in-process notification queue work, and
what must be configured before scaling past one instance.

**Canonical backup and disaster-recovery procedures live in
[BACKUP_DR.md](BACKUP_DR.md).** Deployment steps live in
[DEPLOYMENT.md](DEPLOYMENT.md).

---

## 1. Runtime topology

| Component | Required? | Current deployment | Notes |
|---|---|---|---|
| Node.js / Express API | Yes | Render web service (free tier, **one instance**) | Serves `/api/v1/*` and the static web app. |
| PostgreSQL | Yes | Render PostgreSQL | The only dependency that can make the API unavailable. |
| Redis | **No** | Not provisioned | Optional shared cache and rate-limit store. The app runs without it. |
| Object storage (S3-compatible) | **No** | **Local disk** (`STORAGE_PROVIDER` unset) | Files do **not** survive a redeploy; see §7. |
| Firebase Cloud Messaging | **No** | Configured via `FIREBASE_SERVICE_ACCOUNT_JSON` | Push is best-effort. Absence or failure never blocks an API response. |
| Prometheus / Grafana | **No** | Not provisioned | `/metrics` exists; scraping is optional. |

The Render web filesystem is **ephemeral**. Anything written inside the container
(including `backups/`, local uploads and logs not shipped to the platform) is lost
on deploy or restart. Do not treat container-local files as durable storage.

---

## 2. Health and readiness

| Endpoint | Touches dependencies? | HTTP status | Intended use |
|---|---|---|---|
| `GET /api/v1/health/live` | No | Always `200` while the process can answer | **Platform liveness check.** `render.yaml` declares this path, but the live Render Docker service actually probes `/api/v1/health` (see §11). A database, Redis or storage outage must not restart the process. |
| `GET /api/v1/health/dependencies` | Database (required), storage and cache (reported only) | `200` when the database is healthy, `503` otherwise | **Dependency gate.** Optional dependencies never make the whole app unavailable. |
| `GET /api/v1/health/ready` | Database **and** storage | `200` only when both are healthy | Strict full-feature readiness. Kept for backward compatibility and existing failure tests. Do **not** use it as a platform liveness probe. |
| `GET /api/v1/health` | Database **and** storage | `200` only when both are healthy | Legacy status page with storage durability flag. |
| `GET /api/v1/health/database` | Database | `200` / `503` | Database probe. |
| `GET /api/v1/health/storage` | Object storage / local disk | `200` / `503` | Storage probe. |
| `GET /api/v1/health/cloud-detailed` | Fan-out to external providers | `200` / `500` | Public subsystem snapshot, cached for 30 s. |
| `GET /metrics` | No | `200` / `401` / `404` | Prometheus text format. In production it returns `404` unless `METRICS_TOKEN` is set; wrong or missing token returns `401`. |

No health endpoint returns credentials, connection strings, tokens or user data.

### 2.1 Rate limiting

Implementation: `node-backend/src/app.js`; store: `src/services/rateLimitStore.js`
(shared via Redis when configured, per-instance memory otherwise).

| Scope | Limit | Notes |
|---|---|---|
| General API (`/api/`) | **1000** requests / 15 min | Interactive traffic only. `/api/v1/health*` and `/api/v1/realtime*` are **skipped**. |
| Auth (`/api/v1/auth/`) | **100** requests / 15 min | Separate namespace, so auth attempts do not consume the general budget. |
| Account deletion | **5** / hour | Deliberate friction on a destructive action. |
| Health probes | **unlimited** | Infrastructure traffic. Must never be rejected by the user-facing budget. |
| Realtime (SSE / polling) | **unlimited** | Long-lived or high-frequency by design. |

**Why health is exempt.** Render probes the health path every few seconds —
roughly 180 probes per 15-minute window. When health shared the general limiter,
the budget was exhausted by the platform itself, probes received `429`, the
instance was marked unhealthy, and Render restarted it. The restart produced a
cold start, which immediately burned the same budget again: a self-reinforcing
`502` loop with no user traffic involved. This was reproduced locally
(210 probes → 199 × `200`, then 11 × `429`) and observed in production logs, then
fixed in `f6cdf9f`.

**Verification after the fix:** 1100/1100 local health probes returned `200`
while `/api/v1/accounts` still capped at 1000 and then returned `429`; production
returned 24/24 `200` over 4+ minutes with no `429` and no `REQ-ERROR`.

Do **not** re-add health to the general limiter, and do not lower the general
budget below what the platform's own probes plus normal interactive traffic
require.

### What to check during an incident

1. `GET /api/v1/health/live` — is the process alive? If this fails, the platform
   should restart it.
2. `GET /api/v1/health/dependencies` — is the database down? Check the `cache`
   block: `available: false` or `circuitOpen: true` means the app has fallen back
   to in-process memory, which is expected and non-fatal.
3. `GET /api/v1/health/ready` — is storage also down? A `503` here with a healthy
   database means uploads are degraded but core finance endpoints can still work.
4. `/metrics` — inspect `finpro_http_errors_total`, upstream errors/retries,
   cache errors and push queue depth (see §3–§5).

---

## 3. Optional cache (Redis + in-process memory)

Implementation: `node-backend/src/services/cacheService.js`.

- **L1:** bounded in-process map (`CACHE_MEMORY_MAX_ENTRIES`, default 500).
- **L2:** optional Redis (`REDIS_URL`). Leave it empty to stay memory-only.
- **Isolation:** every key is namespaced with `CACHE_KEY_PREFIX` and the
  environment (`finpro:<env>:...`). Keys longer than 400 characters are hashed.
- **Timeout:** connect and command timeouts are explicit; a hanging Redis cannot
  hang a request indefinitely.
- **Failure behaviour:** after `REDIS_FAILURE_THRESHOLD` failures the Redis circuit
  opens for `REDIS_COOLDOWN_MS`; operations fall back to memory. Redis is never
  required for a core path.
- **Stampede protection:** concurrent misses for the same key join one in-flight
  loader (`finpro_cache_singleflight_joins_total`). A short Redis lock reduces
  duplicate work across instances when Redis is healthy; if the lock is
  unavailable the loader still runs, so a lock failure is not an outage.
- **Freshness:** shared quote/news values are stored as `{ data, ts }`, and
  consumers check the timestamp, so a cold instance cannot present an old price
  as a fresh fetch.
- **What may be cached:** public market quotes and public news only. Authenticated
  financial records, balances, bank data, tokens and user profiles must **not** be
  put in the shared cache without a separate security design.
- **Metrics:** `finpro_cache_operations_total`, `finpro_cache_errors_total`,
  `finpro_cache_singleflight_joins_total`, `finpro_cache_command_duration_seconds`,
  `finpro_cache_redis_up`, `finpro_cache_memory_entries`.

### Cache environment variables

| Variable | Default | Meaning |
|---|---|---|
| `REDIS_URL` | empty | Empty disables Redis; the app uses memory only. |
| `CACHE_ENABLED` | `true` | Set `false` to disable caching entirely. |
| `CACHE_KEY_PREFIX` | `finpro:<NODE_ENV>` | Namespace prefix. Change per environment if databases share Redis. |
| `CACHE_DEFAULT_TTL_MS` | `60000` | Default TTL for callers that do not pass one. |
| `CACHE_MEMORY_MAX_ENTRIES` | `500` | Hard cap on L1 entries (oldest evicted). |
| `CACHE_MAX_VALUE_BYTES` | `262144` | Values larger than this are not cached. |
| `REDIS_CONNECT_TIMEOUT_MS` | `2000` | Connection timeout. |
| `REDIS_COMMAND_TIMEOUT_MS` | `1000` | Per-command timeout. |
| `REDIS_FAILURE_THRESHOLD` | `3` | Failures before the circuit opens. |
| `REDIS_COOLDOWN_MS` | `30000` | How long the circuit stays open before a retry. |

**Enabling Redis:** provision a Redis instance, set `REDIS_URL`, redeploy, then
confirm `GET /api/v1/health/dependencies` reports `cache.configured: true` and
`cache.available: true`. If it does not, the app still works per-instance; do not
roll back solely because Redis is unavailable.

---

## 4. Upstream API resilience

Implementation: `node-backend/src/services/httpClient.js`, used by the market and
news services.

- Explicit per-request timeout (caller-supplied or client default).
- Retries only for idempotent methods (`GET`/`HEAD`/`OPTIONS`) on network errors,
  `408`, `429` and `5xx`, with exponential backoff and jitter.
- `Retry-After` is honoured within a cap, so one provider cannot park a worker.
- A **per-host circuit breaker** opens after repeated failures and half-opens for
  a single probe. A `404` is a valid answer and does not open the circuit.
- A concurrency cap with a bounded queue prevents a slow provider from consuming
  all request slots.
- Errors are sanitised: no URL, query string, API key or response body is logged.
- Metrics: `finpro_upstream_requests_total`, `finpro_upstream_retries_total`,
  `finpro_upstream_request_duration_seconds`, `finpro_upstream_circuit_state`.

Non-idempotent financial writes are **not** retried by this client. They rely on
the controllers' own transaction/idempotency rules (see `API.md`).

---

## 5. Push notification queue (best-effort, non-durable)

Implementation: `node-backend/src/services/pushQueue.js`, fed by
`smsController` with `dedupeKey: sms:<transactionId>`.

- The HTTP request enqueues and returns; it never waits for FCM.
- Bounded queue (`PUSH_QUEUE_MAX`, default 200). When full, the job is refused and
  counted — it is not queued without limit.
- Bounded concurrency (`PUSH_CONCURRENCY`, default 2), per-attempt timeout, and
  exponential backoff with jitter up to `PUSH_MAX_ATTEMPTS` (default 3).
- Only failed tokens are retried. Invalid/expired tokens are dropped permanently.
- Duplicate submissions are suppressed for `PUSH_DEDUPE_TTL_MS` (default 5 min).
- On shutdown, new jobs stop being accepted; queued/in-flight work drains until a
  deadline. Attempts still in flight may outlive the deadline.
- Metrics: `finpro_push_jobs_enqueued_total`, `finpro_push_jobs_completed_total`,
  `finpro_push_attempts_total`, `finpro_push_retries_total`,
  `finpro_push_invalid_tokens_total`, `finpro_push_queue_depth`,
  `finpro_push_send_duration_seconds`.

**Durability limit:** queued jobs live in process memory. A crash, redeploy or
platform restart loses them. This is acceptable for non-critical notifications; it
is **not** acceptable for money movement or anything that must happen exactly once.
Durable delivery requires a Redis-backed queue plus a separate worker process, which
is not provisioned in the current deployment.

---

## 6. Graceful shutdown

`node-backend/src/server.js`:

1. Marks the process as shutting down (further signals are ignored).
2. Stops accepting new work and closes the HTTP server with a 10 s deadline.
3. Closes idle keep-alive connections.
4. Drains the push queue until its deadline.
5. Closes the cache/Redis connection.
6. Disconnects Prisma.

A forced platform kill can still interrupt an in-flight request. Financial writes
use database transactions, so a killed request either commits or rolls back; it
does not leave a half-written balance.

---

## 7. Storage

- Uploads are restricted to `image/jpeg`, `image/png`, `image/webp`,
  `application/pdf`, `text/csv` and `text/plain`.
- MIME is checked against file magic bytes, and the stored extension comes from the
  detected MIME, not the client filename.
- Downloads are served with `X-Content-Type-Options: nosniff` and a sandbox CSP;
  only images render inline, everything else is an attachment.
- A missing object returns **404**, not a storage-outage error. The provider's
  404/`NoSuchKey`/`NotFound` is passed through unchanged; it is never masked as
  `STORAGE_UNAVAILABLE`.
- Local-disk storage is a development fallback. It is **not durable** in a Render
  container. Production receipt/document retention needs an S3-compatible bucket
  and a lifecycle policy.
- **Fail-closed applies only when `STORAGE_PROVIDER=s3`.** In that mode a production
  upload returns 503 `PROVIDER_UNAVAILABLE` instead of silently falling back to local
  disk. `STORAGE_ALLOW_EPHEMERAL_FALLBACK=true` opts back into the non-durable
  fallback deliberately.
- **Current production status (2026-10-26):** `STORAGE_PROVIDER` is unset, so the
  service runs the **local** provider. `/api/v1/health` reports
  `storageProvider: "local"`, `storageDurable: false`; `/api/v1/health/storage`
  reports `available: true`, `cloudAvailable: true`, `durable: false`,
  `ephemeral: true`. Uploads **succeed** but are lost on the next deploy or restart.
  This is a durability risk, not a functional outage.
- The S3 code path is implemented and was proven against a local MinIO server
  (22/22 checks). Enabling it in production requires only credentials and the
  `STORAGE_PROVIDER=s3` / `S3_*` environment variables — no code change. See
  [BACKUP_DR.md](BACKUP_DR.md) §13.3.
- Account deletion removes files under `users/<userId>/` and `exports/<userId>/`
  before deleting the user row. If storage deletion fails, the API returns 503
  and the account row remains, but files already removed cannot be restored.
  See [GOOGLE_PLAY_COMPLIANCE.md](GOOGLE_PLAY_COMPLIANCE.md) for the full deletion
  contract and the manual Play Console steps.

### 7.1 Backups and recovery

Backup tooling is operator-only; the API never starts a backup. The full procedure,
safety model and restore drill live in [BACKUP_DR.md](BACKUP_DR.md). Operational
summary:

- `backup:db` writes a custom-format dump plus a SHA-256 manifest and verifies it
  with `pg_restore --list`. With `BACKUP_ENCRYPTION_KEY` set it encrypts with
  AES-256-GCM (`FPE1`) and removes the plaintext staging file.
- `backup:publish` uploads only an encrypted archive plus manifest, defaults to a
  dry run, refuses to overwrite an existing key, and verifies the download-back
  SHA-256 of both objects.
- `restore:db` is local-only, requires an empty target and an exact
  `--confirm <dbname>`, verifies checksums, and decrypts to a short-lived private
  file. It cannot restore into production.
- `.github/workflows/backup.yml` runs daily at `02:17 UTC` when
  `BACKUP_ENABLED=true`, or manually. It needs the backup database URL, encryption
  key and object-storage credentials as repository secrets.
- Proposed targets are **24-hour RPO** and **4-hour RTO**; both are unmeasured
  until a scheduled off-host backup and a timed restore have been executed.

**Current status (2026-10-26):** a verified, encrypted production backup was taken
and restored into an isolated PostgreSQL 18 container — schema, row counts, content
hashes, indexes and foreign keys all matched (evidence in
[BACKUP_DR.md](BACKUP_DR.md) §13.1). The archive is **not yet off-host** and there is
**no schedule**, so do not report backups as operational. The recovery drill passes
locally.

### 7.2 Render PostgreSQL expiry (BLOCKED on owner authorisation)

`finpro-db` is on the **free plan** and expires **2026-11-11T11:24:01Z**. After
expiry it is inaccessible; a 14-day grace period ends at **2026-11-25T11:24:01Z**,
after which Render **deletes the database and all data**. Free Postgres has no
backups. The only extension path is a paid compute-plan change (from **$6/month**,
`0.1c-256mb`), which requires owner billing authorisation and causes a few minutes of
database unavailability.

Runbook, exact commands, verification and rollback: [BACKUP_DR.md](BACKUP_DR.md)
§13.2. Do not wait until the expiry date.

---

## 8. Scaling rules

The current deployment is a **single web instance**. Before raising the instance
count:

1. **Rate limiting:** without Redis, each instance enforces its own limits, so the
   effective global limit multiplies by the instance count. Provision Redis (the
   hybrid store then uses shared counters) or adjust limits deliberately.
2. **Cache:** without Redis, each instance has an independent cache; provider calls
   multiply. Provision Redis for a shared public-data cache.
3. **Push queue:** each instance has its own queue and its own dedupe map. Across
   instances, the same event can produce more than one notification. Durable
   exactly-once delivery needs a shared queue/worker.
4. **Scheduled work:** any future scheduled job must use a single-runner mechanism
   (database advisory lock or an external scheduler hitting one instance). Do not
   add an in-process timer that runs on every instance.
5. **Realtime SSE registry:** connection state is process-local. Clients connected
   to instance A do not receive events published on instance B. Multi-instance SSE
   needs a shared pub/sub layer.

Do **not** add a distributed lock unless a concrete duplicate-work problem is
demonstrated. A lock that fails open is safer than one that blocks the API when
Redis is down.

---

## 9. Environment variables added by this hardening pass

All are optional. Defaults are safe for the current single-instance deployment.

| Variable | Default | Purpose |
|---|---|---|
| `METRICS_TOKEN` | empty | Bearer/`X-Metrics-Token` secret for `/metrics`. Required to expose metrics in production. |
| `PUSH_QUEUE_MAX` | `200` | Maximum queued push jobs per process. |
| `PUSH_CONCURRENCY` | `2` | Concurrent FCM sends per process. |
| `PUSH_MAX_ATTEMPTS` | `3` | Attempts per token before exhaustion. |
| `PUSH_RETRY_BASE_MS` | `500` | Base backoff. |
| `PUSH_RETRY_MAX_MS` | `10000` | Backoff ceiling. |
| `PUSH_ATTEMPT_TIMEOUT_MS` | `10000` | Per-attempt timeout. |
| `PUSH_DEDUPE_TTL_MS` | `300000` | Duplicate suppression window. |
| `BACKUP_DIR` | `./backups` | Local backup output directory (operator CLI only). |
| `BACKUP_RETENTION_DAYS` | `14` | Retention for verified local backups. |
| `BACKUP_ALLOW_NON_LOCAL` | `false` | Second opt-in required for a non-local backup source. |
| `BACKUP_ENCRYPTION_KEY` | empty | 32-byte AES-256-GCM key (base64 or hex). Required for encrypted backups and restores; store it in a secret manager, never in git. |
| `BACKUP_S3_BUCKET` | empty | Off-host bucket for `backup:publish`. Publishing is refused without it. |
| `BACKUP_S3_PREFIX` | `finpro/postgres` | Object-key prefix; the archive key is `<prefix>/<YYYY>/<MM>/<file>`. |
| `BACKUP_S3_ENDPOINT` | empty | S3-compatible endpoint; leave empty for AWS. |
| `BACKUP_AWS_REGION` | empty | Region passed to the AWS CLI. |
| `BACKUP_S3_SSE` | `AES256` | Server-side encryption mode; `none` only when the provider cannot do SSE. |
| `BACKUP_S3_STORAGE_CLASS` | empty | Optional storage class for the upload. |
| `BACKUP_TIMEOUT_MS`, `RESTORE_TIMEOUT_MS` | `600000`, `900000` | Client-tool timeouts. |
| `PG_DUMP_BIN`, `PG_RESTORE_BIN`, `PSQL_BIN` | PATH lookup | Optional explicit PostgreSQL client binaries. |

See `node-backend/.env.example` and the root `.env.example` for the full list.

---

## 10. Metrics endpoint security

- Set `METRICS_TOKEN` to a long random value in production. The endpoint accepts
  `Authorization: Bearer <token>` or `X-Metrics-Token: <token>`.
- Without a token, production returns `404` so the endpoint is not discoverable.
- Metrics contain route patterns and status codes, **not** user IDs, emails,
  account numbers or request bodies. Route labels are normalised; raw URLs are
  only used when no route matched.
- Do not put the token in a public dashboard URL or commit it to the repository.

---

## 11. Operational checklist

- [ ] Render's live health check path is `/api/v1/health` (the deployed Docker
      service). `render.yaml` still declares `runtime: node` and
      `/api/v1/health/live`; the blueprint is stale and does not describe the live
      service. Either is safe for liveness — neither should be `/api/v1/health/ready`.
- [ ] `METRICS_TOKEN` is set if metrics are scraped in production.
- [ ] `REDIS_URL` is either unset or points at a reachable instance; verify with
      `/api/v1/health/dependencies`.
- [ ] Object storage is configured for durable uploads, or retention limits are
      documented for the local fallback. Current production is local/ephemeral (§7).
- [ ] The Render Postgres plan does not expire before the next review
      (§7.2; deadline 2026-11-11).
- [ ] `BACKUP_ENCRYPTION_KEY` is set on the backup host and stored separately from
      the archives. Losing it makes encrypted backups unrecoverable.
- [ ] The daily backup workflow has run successfully at least once and the
      download-back SHA-256 check passed.
- [ ] Backups run from a trusted host and are copied off-host; see
      [BACKUP_DR.md](BACKUP_DR.md).
- [ ] A restore drill has been run in an isolated local database this release, and
      at least once from the off-host copy.
- [ ] Alerting exists for non-zero backup exit codes and `/health/dependencies`
      returning `503`.
- [ ] Instance count is still 1, or the scaling rules in §8 have been applied.
- [ ] The public privacy policy and account-deletion pages are deployed and
      reachable without authentication before any Play submission. See
      [GOOGLE_PLAY_COMPLIANCE.md](GOOGLE_PLAY_COMPLIANCE.md).
