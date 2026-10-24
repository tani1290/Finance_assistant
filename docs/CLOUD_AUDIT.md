# FinPro — Cloud Capability Audit (Initial Snapshot)

> Captured before any cloud-hardening change. This is an evidence log, not a
> marketing page. A dependency, an environment variable or a documentation
> sentence is **not** treated as proof that a capability works.
>
> Date: 2026-10-21
> Branch: `finpro/pre-deployment-checkpoint`
> HEAD: `f3dd6be`
> Deployment target: Render free web service + Render PostgreSQL (`render.yaml`)
>
> **Current status:** §3–§6 preserve the initial snapshot. §7 records what was
> implemented and verified afterwards. Nothing in this pass was committed,
> pushed or deployed.

## 1. Method

- Read the actual Next/Express/Prisma code, `render.yaml`, `Dockerfile`,
  `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example` and the docs.
- Ran the repository's own suites from `node-backend/`:
  - `node scripts/lint.js`
  - `node scripts/scan-secrets.js`
  - `node run-all-tests.js`
  - `node test-sms-mobile-suite.js`
  - `node test-cloud-verification.js`
  - `node test-cloud-failure.js`
- Checked the installed dependency tree for Redis / queue / metrics packages.
- Did **not** deploy, migrate a live database, rotate credentials or call paid
  services.

Classification:

| Label | Meaning |
|---|---|
| **IMPLEMENTED AND VERIFIED** | Code exists, is wired into the running app, and an executable test (or a real local probe) proves the behaviour. |
| **IMPLEMENTED BUT INCOMPLETE** | Real code exists, but a required part of the capability is missing or only works at small scale. |
| **IMPLEMENTED BUT UNVERIFIED** | Code exists but no executable test or live probe proves it in this environment. |
| **MISSING** | No implementation. |
| **BLOCKED BY EXTERNAL SETUP** | The code can exist, but the capability cannot be operational without provisioning (Redis, a worker dyno, S3, provider keys, paid backups…). |

## 2. Baseline verification (all run locally)

| Suite | Result | Notes |
|---|---|---|
| Lint (`scripts/lint.js`) | **PASS** — 77 JS files | Syntax + repo rules. |
| Secret scan (`scripts/scan-secrets.js`) | **PASS** — 240 tracked files, 0 hardcoded secrets | Does not replace history scanning or provider-side scanning. |
| Core API (`run-all-tests.js`) | **162 passed, 0 failed** | In-process supertest against the real Express app + local PostgreSQL. |
| SMS & mobile (`test-sms-mobile-suite.js`) | **41 passed, 0 failed** | Includes tenant-isolation and atomic confirmation checks. |
| Cloud verification (`test-cloud-verification.js`) | **29 passed, 0 failed** | Happy-path cloud features. The "Cloud Server Backup" string is a subscription test fixture, **not** a backup feature. |
| Cloud failure modes (`test-cloud-failure.js`) | **17 passed, 0 failed** | DB outage, storage outage, malformed request, traversal, recovery. |
| Live AI provider | **SKIPPED** | The suite skips the real Gemini call unless `AI_LIVE_SMOKE=1`; no live-provider success is claimed. |
| Flutter (`flutter analyze`, `flutter test`) | Not re-run in this audit | Recorded separately in `docs/TESTING.md`; no mobile change planned here. |

## 3. Capability matrix

| Capability | Classification | Short evidence |
|---|---|---|
| Distributed / shared caching | **IMPLEMENTED BUT INCOMPLETE** | `marketService.js` has a solid process-local TTL cache + singleflight; `newsService.js` has a 10-minute `Map`. No Redis package, no shared cache, no cache metrics, no cross-instance invalidation. |
| Background jobs / queue | **MISSING** | No BullMQ/Bee-Queue/Agenda/pg-boss. `ExportJob` is an audit-style row, not a queue. OCR/PDF/statement imports run synchronously inside the HTTP request. FCM sends are fire-and-forget. Market warmer is an in-process `node-cron`-style loop. |
| External API resilience | **IMPLEMENTED BUT INCOMPLETE** | Market/news/storage calls have explicit timeouts. No bounded retry with backoff+jitter, no shared circuit breaker, no `Retry-After` handling, no per-host concurrency limit, no latency/error metrics. AI has a per-call 12–20 s timeout but no whole-request deadline across the model chain. |
| Backup / disaster recovery | **MISSING** | No backup/restore scripts and no DR runbook. `render.yaml` provisions no backup service. The cloud-verification suite only uses the words "Cloud Server Backup" as a subscription name. Render free PostgreSQL has no point-in-time recovery guarantee. |
| Observability | **IMPLEMENTED BUT INCOMPLETE** | Structured request logs with request id, duration, status and sanitised errors; `/health`, `/health/database`, `/health/storage`, `/health/ready`, `/health/cloud-detailed`, per-subsystem probes. No `/metrics`, no liveness probe, no cache/job/upstream metrics, readiness conflates optional storage with core availability. |
| Scaling readiness | **IMPLEMENTED BUT INCOMPLETE** | JWT auth and Prisma/PostgreSQL are stateless; single instance is the current target. In-memory market/news caches, in-memory rate-limit buckets, in-memory realtime client registry and the market warmer all duplicate or diverge across instances. |
| Security | **IMPLEMENTED AND VERIFIED (with hardening gaps)** | Helmet, restricted CORS allowlist, body limits, global + auth rate limits, server-side tenant checks, path-traversal tests, secret scanner, parameterised Prisma queries (`$queryRaw` only for probes). Gaps: unauthenticated expensive `/health/cloud-detailed` and `/health/news` probes can be abused; uploaded files are served with a user-influenced `Content-Type` and no forced download/sandbox header; no MIME allowlist. |
| Testing | **IMPLEMENTED AND VERIFIED** | 249 assertions green in the four Node suites above + Flutter suite recorded separately. Missing failure tests for Redis down, cache invalidation, upstream 429/timeout retry, queue exhaustion, backup/restore, and metrics. |
| Deployment | **IMPLEMENTED AND VERIFIED for current infrastructure** | `render.yaml` (single free web service, health check, migration-on-start), `Dockerfile`, `docker-compose.yml`, GitHub Actions with PostgreSQL, `deploy-migrate.js` with additive fallback. No Redis, no worker, no backup job, no metrics scraper. |
| Documentation | **IMPLEMENTED BUT INCOMPLETE** | 10 substantive docs, indexed from `docs/README.md`, no credentials. Missing an operations/runbook doc for cache, jobs, resilience, metrics, backup/DR and multi-instance behaviour; deployment doc does not describe those controls. |

## 4. Detailed findings

### 4.1 Distributed caching

**What exists**

- `marketService.js`
  - `memCache: Map` with 3 min fresh / 15 min cached / 60 min stale thresholds.
  - `inFlightRequests` singleflight per symbol, always evicted in `finally`.
  - Cached entries carry `data_status` (`LIVE` / `CACHED` / `STALE` / `UNAVAILABLE`) and timestamps, so stale data is never presented as live.
  - DB persistence to `market_price_history` and `commodity_prices`.
  - Opt-in background warmer (`MARKET_WARMER_ENABLED`), in-process.
- `newsService.js`
  - `Map` cache with a 10-minute TTL.
  - Returns `data_status: CACHED` with `cache_age_seconds`.
  - Provider fallback (Marketaux → Finnhub → truthful empty state).

**What is missing**

- No Redis client or shared cache: two Render instances would each warm their own
  copy and call providers twice.
- No cache metrics (hit/miss/eviction/error) and no cache health probe.
- No invalidation API or event; TTL is the only expiry mechanism.
- Cache data is public market/news data only, which is the correct security
  boundary today, but that boundary is not written down or enforced in code.

**Risk if unchanged**

- Acceptable on one instance; wasteful and inconsistent the moment the service
  scales beyond one instance.
- Provider rate limits are consumed per instance.

**Manual setup if Redis is used**

- Provision a Redis-compatible instance (Render Redis or Upstash) and set
  `REDIS_URL` (use a `rediss://` URL for TLS). The app must keep working
  without it.

### 4.2 Background jobs

**What exists**

- `ExportJob` table and `storageService` for generated files.
- In-process market warmer started/stopped from `server.js`.
- Fire-and-forget FCM sends (`fcmController`, `smsController`) with a `.catch`
  that logs.
- Synchronous OCR/PDF/CSV/statement ingestion in `ocrImportController`.

**What is missing**

- No durable queue, no job id/status API, no retry/backoff, no dead-letter or
  exhaustion handling, no worker deployment, no concurrency limit, no graceful
  drain of queued work.
- Long OCR/PDF work keeps an HTTP request open; a client disconnect does not
  stop the work.

**Risk if unchanged**

- A provider/worker crash during a long import can leave the user staring at a
  timeout; FCM failures are invisible and never retried.
- On Render free tier there is one web process and no separate worker; adding a
  Redis-backed queue without provisioning would create dead code.

**Decision for this pass**

- Do not bolt on BullMQ/pg-boss without a concrete worker deployment and a
  durable job contract. Implement a bounded, in-process retry queue only for
  genuinely non-critical work (push delivery), with metrics and graceful drain,
  and document the durability limit and the threshold for moving to a durable
  queue. Keep the financial import path synchronous + idempotent rather than
  pretending an in-memory queue is durable.

### 4.3 External API resilience

**What exists**

- `marketService.js`: 6–8 s axios timeouts, provider fallback, validated quote
  metrics, no fake prices.
- `newsService.js`: 7–8 s timeouts, provider fallback, truthful empty state.
- `storageService.js`: every S3 call bounded by a configurable 15 s socket
  timeout; health probe is time-bounded.
- `aiService.js`: per-call 12 s timeout; `aiAssistantService.js`: per-call 20 s
  timeout and a model chain.
- `cloudHealthService.js`: probes run in parallel and are time-bounded by the
  underlying services.

**What is missing**

- No retry with exponential backoff + jitter for idempotent GETs.
- No `Retry-After` handling for 429/503.
- No shared circuit breaker, so a dead provider is called by every request until
  its own timeout expires.
- No concurrency cap per provider.
- No upstream latency/error/timeout metrics.
- AI worst case is `MODEL_CHAIN × MAX_ROUNDS × 20 s`; a single `/ai/chat` can
  occupy a worker for minutes. This is a known defect documented in `docs/AI.md`.

**Risk if unchanged**

- Provider incidents become user-visible latency spikes and worker exhaustion.
- 429s are treated as generic failures, increasing pressure on the provider.

### 4.4 Backup / disaster recovery

**What exists**

- Prisma schema and migrations.
- `deploy-migrate.js` runs `prisma migrate deploy` with an additive `db push`
  fallback, never `--accept-data-loss`.
- Documentation says to "review cloud database backup", but there is no script,
  schedule, retention policy, manifest, restore procedure or restore test.

**What is missing**

- `pg_dump`/`pg_restore` automation, checksums, retention pruning, failure
  reporting, access control, isolated restore verification.
- A documented RPO/RTO and a statement of what the Render free PostgreSQL plan
  actually guarantees.

**Risk if unchanged**

- One bad migration or accidental delete is unrecoverable beyond provider-level
  snapshots (which are not guaranteed on the free plan).

### 4.5 Observability

**What exists**

- `requestLogger` with request id, method, path, status, duration, sanitised
  errors; no credentials/tokens/body logging.
- `/health` (DB + storage), `/health/database`, `/health/storage`,
  `/health/ready`, `/health/cloud-detailed` (12 subsystems),
  `/health/cloud-detailed` avoids secret values, `/health/market`, `/health/ai`,
  `/health/auth`, `/health/news`.
- `cloudHealthService` distinguishes `CONNECTED` / `DEGRADED` / `UNAVAILABLE` /
  `NOT_CONFIGURED`.
- Graceful shutdown closes the HTTP server, Prisma and market worker.

**What is missing**

- No Prometheus/OpenMetrics endpoint and no counters/histograms for HTTP, cache,
  upstream calls or jobs.
- No liveness probe separate from dependency readiness.
- `/health/ready` returns 503 when optional object storage is down; that is
  correct for "upload path ready" but wrong as a general traffic gate.
- Health probes are not cached; `/health/cloud-detailed` can trigger 12 probes
  per request, unauthenticated.

**Risk if unchanged**

- No way to see cache hit rate, upstream error rate, retry count, circuit state
  or job backlog.
- A storage outage or an attacker hitting the detailed probe can cause
  unnecessary restarts/load.

### 4.6 Scaling readiness

**What exists**

- Stateless JWT auth; all financial state in PostgreSQL/Prisma.
- Single-instance assumptions are implicit rather than documented.

**What is missing**

- Shared cache (see 4.1).
- Shared rate-limit store: `express-rate-limit` uses its default in-memory store
  (200 req/15 min global, 100/15 min auth), so limits multiply by instance count.
- Realtime Socket.IO client registry and AI request state are process-local.
- Market warmer runs in every instance; no leader election or lock.
- No documented scale-out checklist.

**Risk if unchanged**

- On two instances: duplicated provider calls, duplicated warmers, weaker rate
  limits, and realtime events that only reach clients connected to the same
  instance.

### 4.7 Security

**Verified controls**

- CORS is an explicit allowlist, not `*`.
- Helmet security headers; CSP disabled only because the static frontend uses
  inline scripts (documented trade-off).
- Global and auth-specific rate limits.
- JWT auth on all `/api/v1` routes except health/auth entry points; query-string
  tokens are restricted to the SSE route.
- Tenant checks in controllers; `test-sms-mobile-suite.js` proves cross-user
  access is refused.
- Storage path traversal blocked and covered by
  `test-cloud-failure.js`.
- Prisma parameterised queries; raw SQL only for `SELECT 1` / version probes.
- Secret scanner reports 0 hardcoded secrets across 240 tracked files.
- Errors are sanitised; health endpoints do not return secret values.

**Hardening gaps found**

1. `/api/v1/health/cloud-detailed` and `/api/v1/health/news` are unauthenticated
   and can trigger expensive outbound probes on every request. They are global
   rate-limited (200/15 min per IP) but still amplify load.
2. `storageController.getFile` sets `Content-Type` from the upload and returns
   the bytes inline. Files are tenant-scoped and auth-protected, so this is not a
   cross-tenant IDOR, but an admin or the uploader opening a crafted HTML/SVG
   file gets same-origin execution. Add a MIME allowlist, `X-Content-Type-Options:
   nosniff`, a sandbox CSP and `Content-Disposition: attachment`.
3. Uploads accept any `contentType` and any extension; there is no magic-byte
   check. A MIME allowlist is the minimum safe control.
4. `/metrics` does not exist yet; when added it must not expose user ids,
   emails, tokens or financial values as labels.

### 4.8 Testing

**What exists**

- 249 assertions across the four Node suites, including failure-mode tests for
  database outage, storage outage, malformed requests, traversal and recovery.
- SMS/mobile tenant isolation and atomic balance updates.
- Flutter 181/181 recorded in `docs/TESTING.md` (not re-run here).

**Gaps**

- No Redis-down/cache-fallback test.
- No cache hit/miss/invalidation/TTL test.
- No upstream 429/timeout/retry/circuit-breaker test.
- No queue retry/exhaustion/duplicate-submission test.
- No backup/restore argument-safety or dry-run test.
- No metrics endpoint content/secret-leak test.
- Live AI provider path is skipped by default.

### 4.9 Deployment

**What exists**

- `render.yaml`: one free web service, `healthCheckPath: /api/v1/health`,
  `startCommand` runs `deploy-migrate.js` then `server.js`, auto-deploy on.
- `Dockerfile` + `docker-compose.yml` for local/container use.
- GitHub Actions: Node 22, PostgreSQL 17 service, install, Prisma generate,
  lint, migrate/push, and the test suites (see workflow).
- `deploy-migrate.js` reports real failures; no `--accept-data-loss`.
- `TRUST_PROXY_HOPS=1` matches Render's single proxy.

**What is missing**

- No Redis service, no worker service, no scheduled backup job, no metrics
  scraper, no documented scale-out procedure, no documented restore drill.
- `.env.example` documents the current variables but not the new optional
  caching/metrics/backup controls (this audit predates them).

### 4.10 Documentation

**What exists**

- `README.md` + `docs/README.md` index.
- `ARCHITECTURE.md`, `API.md`, `DATABASE.md`, `AI.md`, `PARITY.md`,
  `TESTING.md`, `DEPLOYMENT.md`, `DESIGN_SYSTEM.md`, `MOBILE.md`.
- Known defects are written down instead of hidden (AI deadline, date-only
  timezone, insurance/subscription summary counts, dashboard income label
  divergence).

**What is missing**

- Operations runbook: cache, upstream resilience, jobs, metrics, backup/DR,
  scaling, incident procedures.
- A single place that states which capabilities are production-ready versus
  provisioned-but-unverified.
- Deployment doc does not describe optional Redis, backup schedule, metrics
  scraping or multi-instance constraints.

## 5. Initial implementation scope (highest value first)

1. **Optional shared cache** with in-memory fallback, TTL, singleflight,
   namespaced keys, timeouts, circuit-style degradation, metrics and tests.
   Integrate only public market/news data; never cache authenticated financial
   payloads in Redis.
2. **Upstream HTTP resilience**: idempotent-only retries with exponential
   backoff + jitter, `Retry-After`, per-host circuit breaker, concurrency cap,
   sanitised errors, metrics, tests against a local HTTP server.
3. **Observability**: dependency-free Prometheus text metrics, HTTP middleware,
   cache/upstream/job metrics, `/metrics`, `/health/live` for the platform probe,
   and `/health/dependencies` as the DB-only dependency gate, while keeping the
   strict `/health` and `/health/ready` upload-path readiness signal.
4. **Backup/DR**: safe `pg_dump`/`pg_restore` scripts with dry-run, production
   guards, checksums, manifest, retention, verification, argument-validation
   tests and a runbook.
5. **Security hardening**: cache expensive health probes; MIME allowlist and
   forced-download/sandbox headers for stored files; metrics token/label rules.
6. **Scaling readiness**: optional Redis-backed rate-limit store, documented
   multi-instance constraints, no distributed lock without a proven need.
7. **Jobs**: bounded in-process retry queue for non-critical push delivery only;
   durable queue explicitly deferred until a worker + Redis contract exists.
   Long financial imports stay synchronous and idempotent.
8. **Docs consolidation**: add `OPERATIONS.md` and link it from the canonical
   index; update `DEPLOYMENT.md`, `TESTING.md`, `ARCHITECTURE.md`, `README.md`
   and `.env.example`.

## 6. Explicitly not done in this pass

- No deployment, migration against a live database, credential rotation or paid
  provisioning.
- No new cloud provider, Kubernetes, or replacement of Render/PostgreSQL.
- No change to authentication, authorization or financial validation to make a
  test pass.
- No real financial transactions or real customer data in tests.
- No claim that a Redis-dependent path is production-ready without a provisioned
  Redis and a live probe.
- No claim that the Render free PostgreSQL plan provides backups that it does
  not provide.

---

## 7. Post-implementation status

This section supersedes the capability classifications in §3 for the items below.
“Verified” means an executable local test proved the behaviour; it does not mean a
deployed environment was exercised.

| Capability | Current classification | Evidence / remaining limit |
|---|---|---|
| Optional shared cache | **IMPLEMENTED AND VERIFIED (fallback + singleflight)** | `cacheService.js` with memory L1, optional Redis L2, namespaced keys, TTL, singleflight, Redis lock with safe fallback, command/connect timeouts, failure circuit, `decr`, status/shutdown. `cacheService.test.js`. A one-off probe against an ephemeral local Redis on `127.0.0.1:6399` also exercised connect, TTL, singleflight, `incr`/`decr` and L2 hydration after clearing L1. No managed Redis is provisioned, so cross-instance sharing and TLS (`rediss://`) remain unverified in production. |
| Public quote/news cache integration | **IMPLEMENTED AND VERIFIED** | `marketService`/`newsService` use `cacheService` + `httpClient`; shared values are `{ data, ts }` so stale data cannot be relabelled fresh. Existing `marketEngine.test.js` + cloud suites remain green. |
| Upstream API resilience | **IMPLEMENTED AND VERIFIED (unit)** | `httpClient.js`: explicit timeouts, idempotent-only retries with exponential backoff + jitter, capped `Retry-After`, per-host circuit breaker, concurrency queue, sanitised errors, metrics. `httpClient.test.js`. No live provider was exercised. |
| Durable background jobs / worker | **MISSING / DEFERRED** | No Redis-backed queue or worker process is provisioned. Financial imports remain synchronous and idempotent; making them async requires a durable queue and an API contract change. |
| Push notification retry queue | **IMPLEMENTED BUT NON-DURABLE** | `pushQueue.js`: bounded queue, concurrency limit, per-token retry, permanent-token drop, dedupe, attempt timeout, graceful drain, metrics. `pushQueue.test.js`. Jobs live in process memory and are lost on crash/deploy; documented in `OPERATIONS.md` §5. |
| Backup / DR tooling | **IMPLEMENTED AND VERIFIED (local drill)** | `backup-db.js`, `restore-db.js`, `verify-backup-restore.js`, `dbSafety.js`, `lib/backupCrypto.js`, `lib/backupRemote.js`, `publish-backup.js`. The drill recovered a seeded row from both plaintext and encrypted archives, refused a non-empty restore, rejected a wrong key without writing, and cleaned up. `dbSafety.test.js`, `backupCrypto.test.js` and `backupRemote.test.js` cover safety and integrity. Production schedule and off-host copy are **not configured**; see `BACKUP_DR.md`. |
| Backup encryption | **IMPLEMENTED AND VERIFIED (local)** | AES-256-GCM `FPE1` container (authenticated header + IV + ciphertext + tag), 32-byte key parsing, staging-file cleanup, encrypted manifests with plaintext size/checksum. Tamper and wrong-key paths fail closed. No key has been provisioned for production. |
| Off-host backup publishing | **IMPLEMENTED BUT UNVERIFIED (live)** | `publish-backup.js` accepts only encrypted archives with a manifest, defaults to dry run, refuses overwrites, uploads with SSE, downloads both objects back and verifies SHA-256, and removes objects it uploaded on failure. A dry run against a real local archive passed. No live S3-compatible upload/download has been executed. |
| Backup scheduling | **CHANGED IN REPO, NOT RUN** | `.github/workflows/backup.yml`: manual dispatch always available, daily `17 2 * * *` only when `BACKUP_ENABLED=true`, secret validation and a non-secret failure artifact. Not executed in GitHub Actions. |
| Observability | **IMPLEMENTED AND VERIFIED** | Dependency-free metrics registry + HTTP middleware, `/metrics` (token-gated in production), `/health/live`, `/health/dependencies`; strict `/health/ready` kept for compatibility. `metrics.test.js`, `observability.test.js`. Prometheus/Grafana are not provisioned. |
| Scaling readiness | **IMPLEMENTED BUT UNVERIFIED (multi-instance)** | Hybrid Redis/memory rate-limit store tested; multi-instance cache, rate limiting, SSE and push dedupe remain unverified and are documented as constraints in `OPERATIONS.md` §8. Current deployment stays at one instance. |
| Upload/download security | **IMPLEMENTED AND VERIFIED** | MIME allowlist, magic-byte checks, extension from MIME, active-content rejection, forced attachment for non-images, `nosniff`, sandbox CSP. `storageHardening.test.js` (10 tests). |
| Expensive public health probe | **IMPLEMENTED AND VERIFIED** | `/api/v1/health/cloud-detailed` result cached for 30 s with singleflight; no longer amplifies 12 provider probes per request. |
| Testing | **IMPLEMENTED AND VERIFIED (local)** | Phase 2 suites: **162 / 41 / 29 / 17**. Phase 3 adds 4 Jest suites (57 tests) and 4 custom assertions: current totals are custom **166 / 41 / 29 / 17** and Jest **353 tests / 24 suites**, all 0 failures. Backup drill: passing for plaintext and encrypted archives, including wrong-key rejection. CI runs Jest, the custom suites and the encrypted recovery drill. No live staging, load test or live AI provider run. |
| Deployment | **CHANGED IN REPO, NOT DEPLOYED** | `render.yaml` health check moved to `/api/v1/health/live`; npm scripts added (`test:unit`, `backup:db`, `restore:db`, `backup:verify`, `backup:publish`); CI runs Jest and the backup drill; a separate backup workflow is defined. No commit, push or deploy was performed in this pass. |
| Documentation | **IMPLEMENTED** | Added `OPERATIONS.md` and `BACKUP_DR.md`; updated `README.md`, `docs/README.md`, `DEPLOYMENT.md`, `TESTING.md`, `ARCHITECTURE.md`, both `.env.example` files and this audit. `BACKUP_DR.md` now covers encryption, off-host publishing, scheduling, retention, object-storage recovery and unmeasured RPO/RTO. |

### Explicitly still unverified or blocked

- No managed Redis: a local ephemeral Redis was exercised, but TLS, persistence,
  failover and cross-instance sharing were not. Shared rate-limit counters are
  tested with mocks and fallbacks, not a managed instance.
- No durable queue/worker: push remains best-effort and imports remain synchronous.
- No scheduled production backup: the tooling, encrypted archive format and GitHub
  Actions workflow exist, but the workflow has not run and no off-host copy exists.
- No live S3-compatible publish/restore: publishing has only been exercised as a dry
  run against a local encrypted archive.
- RPO/RTO targets (24 hours / 4 hours) are proposals, not measurements.
- No staging deployment: the Render health-path change and new scripts have not
  been exercised on the platform.
- No live AI provider success: `AI_LIVE_SMOKE=1` was not run.
- Phase 3 fixed the finance/date/AI-confirmation defects locally, but the
  `AiActionProposal` table has not been deployed and the Flutter advisor does not
  yet render the Confirm/Cancel prompt.
- Deposit endpoint idempotency: **resolved in Phase 5** (optional `idempotencyKey`,
  enforced by the `idempotency_records` primary key). Other money-moving endpoints
  still lack it.
- The Render free web filesystem is ephemeral; local uploads and container-written
  backups are not durable.
