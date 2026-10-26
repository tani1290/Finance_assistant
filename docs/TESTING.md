# Jinay Finance AI — Automated & Regression Testing Guide
**Owner:** Jinay Golecha (`jinay_golecha`)  
**Test Harness:** Supertest-based custom Node runners (the `npm test` gate) · Jest (unit, security and failure-scenario suites, run in CI) · Flutter widget tests

---

## 1. Test Suite Architecture

The repository ships **four custom backend suites**, a **Jest suite** and a **Flutter widget-test suite**:

```
┌────────────────────────────────┬─────────────────────────┬------------------------------┐
│ Suite                          │ Size                    │ Focus Area                   │
├────────────────────────────────┼─────────────────────────┼------------------------------┤
│ run-all-tests.js               │ 166 assertions          │ Core APIs & DB               │
│ test-sms-mobile-suite.js       │ 41 assertions           │ Mobile SMS Sync & Dedup      │
│ test-cloud-verification.js     │ 29 assertions           │ Cloud Persistence            │
│ test-cloud-failure.js          │ 17 assertions           │ Failure & Resiliency         │
├────────────────────────────────┼─────────────────────────┼------------------------------┤
│ src/__tests__/*.test.js        │ 572 Jest tests / 35 suites │ Unit, security, failure   │
│ mobile/test/**                 │ 239 widget tests        │ Flutter client contracts     │
└────────────────────────────────┴─────────────────────────┴──────────────────────────────┘
```

The four custom suites total **253 passing assertion checks** with 0 failures. Jest adds
**572 passing tests across 35 suites**, and Flutter adds **239 passing widget tests**.
CI runs `npm test`, Jest and the cloud persistence suite in the main job, plus a
separate `backup-recovery-drill` job against a PostgreSQL 17 service. The failure suite
is run manually as part of the pre-deploy gate. Flutter analysis/tests run separately
when mobile changes are in scope. The off-host backup workflow is separate from CI and
only runs when explicitly configured.

`npm test` remains the compatibility gate (`run-all-tests.js && test-sms-mobile-suite.js`).
`npm run test:unit` runs the Jest suite. CI runs both; neither weakens or skips the other.

---

## 2. Executing Automated Tests

### 2.1 Master Integration & Acceptance Suite
Runs the 166-point top-to-bottom pipeline:
```bash
cd node-backend
node run-all-tests.js
```
**Coverage:**
- Health & diagnostics
- Registration, login, duplicate detection, auth/me
- Financial onboarding & baseline plan creation
- Atomic account deposits & balance sync
- Real-time dashboard KPI computations
- Transactions CRUD & automated balance reversals
- Category budgets & AI budget optimizer
- Goals & completion forecasting
- Real-time stock quotes, gold, silver, charts & portfolio valuation
- Loans & reducing-balance EMI math
- Insurance policies & subscription tracking
- 10-Factor AI health scoring
- Predictive cash flow trajectory (30 & 90 days)
- Financial what-if simulations
- Retirement corpus projection
- OCR receipt parsing & bank statement CSV import
- Voice assistant intent parsing
- Authenticated CSV file exports
- Multi-user tenant isolation (User A vs User B)

### 2.2 Mobile SMS & Sync Acceptance Suite
Runs the 41-point Android SMS detection and mobile sync pipeline:
```bash
cd node-backend
node test-sms-mobile-suite.js
```
**Coverage:**
- Bank SMS ingestion & permission-gated sync endpoints
- Merchant/category inference and ML fallback categorization
- OTP and non-transaction message rejection
- Duplicate protection via the `(userId, rawMessageHash)` unique constraint
- Pending-transaction confirmation & atomic ledger mutation

### 2.3 Cloud Data Persistence Suite
Runs the 29-point cross-session persistence pipeline:
```bash
cd node-backend
node test-cloud-verification.js
```
**Coverage:**
- Health, database, storage, and readiness diagnostics
- Register/login/logout lifecycle and refresh-token revocation
- Persistence of accounts, transactions, budgets, goals, investments, loans, insurance, subscriptions, tasks, and stored files across sessions

### 2.4 Failure & Resiliency Suite
Runs the 17-point degraded-state pipeline:
```bash
cd node-backend
node test-cloud-failure.js
```
**Coverage:**
- Graceful degradation under database outage
- Storage backend failure handling
- Path-traversal and unauthorized-access rejection
- Health recovery after failure conditions

### 2.5 Flutter Widget & Contract Suite
Runs the mobile client's tests against a mocked HTTP adapter (no device or live backend required):
```bash
cd mobile
flutter analyze --no-pub
flutter test --no-pub
```
**Coverage (239 tests):**
- API client: error-envelope mapping, 4xx vs 5xx messaging, auth/refresh paths
- Dashboard, accounts, transactions (including pagination and end-of-list), budgets, category drill-down
- Goals, loans, investments, analytics, profile and deposit flows
- Notifications list/read state
- AI advisor: history restore, empty greeting, action/source chips, failure + retry, clear-history confirmation, **a pending confirmation is never presented as applied**, **a proposal without confirmation metadata is not shown as performed**
- Calendar: month grid/list, day filter, error + retry, delete-custom-only, add-sheet validation
- Insurance & subscriptions: server-summary precedence, both record sections, advisory-review isolation, delete confirmation, empty states
- Transfer retry-key lifecycle: a failed transfer reuses its key, non-transfers omit it, and a new sheet gets a new key

Widget tests run against a fake `HttpClientAdapter`, so they assert the **contract each screen consumes** (paths, query parameters, response fields). They do not prove a live backend still returns that shape — the backend suites do that.

### 2.6 Jest Unit, Security & Failure-Scenario Suite
```bash
cd node-backend
npm run test:unit      # jest --runInBand
```
**572 tests in 35 suites**, including the cloud-hardening, backup-integrity, Phase 3 finance/confirmation, storage-fail-closed and transfer-ledger suites:

| Area | Suites | What is proven |
|---|---|---|
| Cache | `cacheService.test.js` | Namespaced keys, TTL, singleflight, Redis-down fallback, circuit cooldown, `decr` never goes negative, shutdown, no secret leakage. |
| Upstream HTTP | `httpClient.test.js` | Timeouts, idempotent retry only, exponential backoff + jitter, `Retry-After` cap, 404 does not open the circuit, concurrency queue, sanitised errors. |
| Metrics | `metrics.test.js`, `observability.test.js` | Bounded series, label escaping, cumulative histogram buckets, reset, `/metrics` auth/404 behaviour, health endpoint semantics. |
| Upload/download | `storageHardening.test.js` | MIME allowlist, magic-byte verification, extension from detected MIME, active-content rejection, malformed base64, inline sandbox, cross-tenant denial. |
| Storage provider policy | `storageProductionFailClosed.test.js` | `STORAGE_PROVIDER=s3` fails closed (503) instead of writing to ephemeral disk; explicit fallback opt-in; dev auto-fallback; **a provider 404/`NoSuchKey`/`NotFound` is passed through unchanged and never masked as `STORAGE_UNAVAILABLE`**. |
| Rate limiting | `rateLimitStore.test.js` | Shared Redis counters when healthy, memory fallback during outage, separate `api`/`auth` namespaces, no response contamination. |
| Backup safety | `dbSafety.test.js` | Local-only restore, remote backup double opt-in, reserved-database rejection, `PG*` env construction, output sanitisation, retention selection for plaintext and encrypted archives. |
| Backup encryption | `backupCrypto.test.js` | Key parsing (base64/hex, wrong length, passphrase rejection), AES-256-GCM round trip, authenticated header, tamper and wrong-key failure, plaintext cleanup semantics. |
| Off-host publishing | `backupRemote.test.js` | Bucket/prefix/archive/manifest validation, safe UTC object keys, refusal of plaintext or malformed input, log masking of credentials. |
| Push queue | `pushQueue.test.js` | Dedupe, bounded queue, failed-token-only retry, permanent-token drop, not-configured path, exhaustion, timeout, graceful drain/deadline, no token logging. |
| Phase 3 finance correctness | `dateOnly.test.js`, `phase3Finance.test.js` | Leap-year and impossible-date rejection, IST month rollover, empty datasets, ledger-vs-salary income, active-only insurance/subscription totals, date filters, task overdue boundary. |
| AI confirmation gate | `aiConfirmation.test.js` | Token hashing, expiry, replay, cancellation, cross-user isolation, one mutation per turn, read-only inline execution, stalled-provider total deadline. |
| Phase 4 confirmation states | `aiConfirmation.test.js` (extended) | `PENDING → EXECUTING → COMPLETED \| FAILED` transitions, terminal failures that never reopen, exactly one winner under concurrent claims, a pre-execution database failure that stays retryable, a chat-history failure that never turns an applied action into an error. |
| Phase 4 finance & date | `phase4FinanceDate.test.js` | Dashboard ⇄ AI agreement on period, basis and values; transfer exclusion; refunds counted as income; duplicate rows not silently deduplicated; empty periods; month boundaries; timezone resolution; date-only round trips; leap days; inactive protection products. |
| Transfer ledger & pagination | `transactionTransfer.test.js` | Two-leg transfer effects and reversal; source/destination must be distinct and owned by the caller; `toAccountId` rejected on non-transfers; PATCH cannot convert to/from `TRANSFER`; aggregated balance writes; `page`/`limit`/`type` validation and bounded pagination; AI transfer misuse rejected. |
| Transfer idempotency | `transactionTransferIdempotency.test.js` | Keyed transfer, keyless compatibility, transactional category resolution, replay of a new and an omitted-date transfer, delete-after-commit conflict, conflicting payload, malformed and non-transfer keys, invalid date, concurrent identical/conflicting requests, and per-user key isolation. |
| Phase 4 backup hardening | `phase4Backup.test.js` | Deterministic archive naming, refusal to overwrite an existing archive or manifest, manifest byte-length and SHA-256 verification (tamper, truncation, missing checksum), retention selection. |
| RAG sourcing | `ragSources.test.js` | Model-generated sources stripped, canonical retrieved sources only, empty `Sources:` headings omitted. |
| Existing behaviour | `api.test.js`, `marketEngine.test.js`, `healthHardening.test.js`, analytics/advisor/RAG/import suites | API contracts, market engine, health hardening, analytics, AI budgets, import idempotency. |

Jest uses the repository's existing `testMatch` and does not require a live provider. CI injects a test `DATABASE_URL`, but the cloud-hardening suites do not call external services.

A one-off manual probe (not committed as a suite) also ran `cacheService` against an ephemeral local Redis on `127.0.0.1:6399`: connect, namespaced set/get, TTL, singleflight (one loader for three concurrent callers), `incr`/`decr`, and L2 hydration after clearing the local L1 all passed. It does not substitute for a managed-Redis or multi-instance test.

### 2.7 Backup / Restore Recovery Drill
```bash
cd node-backend
npm run backup:verify
```
Creates throwaway local databases, seeds the source, runs the **real** backup and restore scripts, and verifies:

1. plaintext backup restores and the seeded row/table count survives;
2. restoring over a non-empty database is refused;
3. an encrypted backup restores with the correct key;
4. a wrong key is rejected without writing to the target.

It refuses non-local hosts, only creates/drops `finpro_bk_verify_*` databases, and removes its temporary directory. The same drill runs in CI (`backup-recovery-drill`) against a PostgreSQL 17 service.

`publish-backup.js` defaults to a dry run and was exercised locally against a real encrypted archive: it validated the manifest and printed the deterministic object key without making a network call. No live S3 upload/download has been executed **for backup publishing**, so the download-back verification path is covered by unit tests and code review only. (The application's own object-storage path is a different code path; it was proven against a local MinIO server in Phase 8 — see §2.10.)

This is a destructive test **only** of throwaway local databases. It must not be pointed at a shared or production database.

### 2.8 AI Confirmation State-Machine Verification (real database)
```bash
cd node-backend
PHASE4_VERIFY_DATABASE_URL=postgresql://user@127.0.0.1:5432/finpro_phase4_verify \
  node scripts/verify-ai-confirmation.js
```
The Jest suite proves the state machine against a **mocked** Prisma client. This
script proves it against a **real** PostgreSQL engine, because the concurrency
guarantee depends on a real conditional `UPDATE`:

1. a proposal is created with a hashed token (the plaintext is never stored);
2. another user cannot claim it (`404`);
3. an expired proposal is rejected (`410`) and is marked `EXPIRED`;
4. a live proposal is claimed exactly once (`PENDING → EXECUTING`, `attempts = 1`);
5. five simultaneous claims produce **exactly one winner** and four `409`s;
6. `COMPLETED`, `FAILED` and `CANCELLED` are terminal and cannot be reclaimed;
7. a failed action is recorded with `lastError` and is **not** marked retryable.

It refuses to run against a non-local host and only creates rows for a
throwaway user that it deletes afterwards.

### 2.9 Transfer Idempotency Verification (real database)
```bash
cd node-backend
FINPRO_TRANSFER_VERIFY=1 \
FINPRO_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/finpro_transfer_verify \
  node scripts/verify-transfer-idempotency.js
```
The Jest suite proves the HTTP contract against a mocked Prisma client. This
script proves the same contract against a real PostgreSQL engine, where the
unique key claim, the per-user advisory lock and both ledger legs actually
interact.

It **refuses to run** unless all of these are true:

1. `FINPRO_TRANSFER_VERIFY=1` is set;
2. `FINPRO_TEST_DATABASE_URL` points at a local host;
3. the database name matches `^finpro_[a-z0-9_]+(?:_test|_verify)$`;
4. a runtime query confirms `current_database()` is that same database.

`finance_jinay` and any production-looking name are refused. The script then
creates throwaway users and accounts, injects a failure into the second balance
write through a proxy around `prisma.$transaction`, and checks **62 assertions**:

- a keyed transfer applies exactly one source debit and one destination credit;
- replay returns the original id with `replayed: true` and no new ledger effect;
- a conflicting payload returns `409` and writes nothing;
- concurrent identical requests create one transfer; concurrent conflicting
  requests produce one winner and `409`s;
- invalid, same-account and foreign destinations fail without a ledger effect;
- a pre-ledger failure and a mid-transaction failure both roll back the row,
  both balance legs and the idempotency claim;
- a retry after rollback succeeds once, and a retry after commit replays;
- deleting the original leaves the key claimed, so it is never recreated;
- a user's key cannot read another user's transaction;
- opening balances plus ledger deltas reconcile exactly;
- transfers are excluded from income/expense aggregates.

The test target must be disposable. Do not point this script at
`finance_jinay`, staging or production. Drop the database after the run.

### 2.10 Phase 8 verification (2026-10-26)

Most checks below were run against the **deployed** services, not a local stack; the
load run is explicitly local and is labelled as such. Every production account,
transaction and file used was synthetic and was deleted afterwards; the production
row counts returned to baseline and no test residue remains.

| Area | Method | Result |
|---|---|---|
| Frontend | `curl` against `https://fin-pro-wheat.vercel.app` for `/`, `/privacy.html`, `/terms.html`, `/delete-account.html`, `/simulator.html` | **PASS** — all 200; legal pages carry a viewport meta and effective date 2026-10-24 |
| Backend liveness/health | `/api/v1/health/live`, `/health`, `/health/dependencies`, `/health/ready`, `/health/database`, `/health/storage` | **PASS** — all 200; database connected, storage local/non-durable (see §5) |
| Account lifecycle | register → `/auth/me` → delete with wrong confirmation → delete with wrong password → delete with correct password → old token → login after delete | **PASS** — 201/200/400/401/200/401/401; `deleted:true`, `alreadyDeleted:false` |
| Simulator gating | authenticated `/simulator/status`, `POST /simulator/seed`, unauthenticated status | **PASS** — `enabled:false`, `production:true`, `synthetic:true`; seed → `403 SIMULATOR_DISABLED`; unauthenticated → 401 |
| Transfer idempotency (live) | create, retry the same key, compare transaction id and balances | **PASS** — same id, one debit/credit pair |
| Deposit idempotency (live) | replay the same key | **PASS** — `replayed:true`, same id, no double credit |
| CORS | `OPTIONS /api/v1/health/live` from both deployed origins | **PASS** — 204 with `access-control-allow-origin` |
| Bounded local load | 900 mixed requests (health, dashboard, transactions, accounts, budgets, analytics) at concurrency 12 against a loopback backend and local PostgreSQL | **PASS** — 900/900 HTTP 200, p50 8.4 ms, p95 15.8 ms, p99 22.5 ms, max 36.2 ms, ~1,366 req/s. Not a production capacity claim: local only, no Redis, rate limiter disabled under `NODE_ENV=test`, no soak. Synthetic user and 25 seeded transactions deleted afterwards (0 residue). |
| Storage S3 path | 22-check harness against a local MinIO server | **PASS** — upload/list/download byte equality, cross-tenant denial, unsafe-prefix rejection, prefix-delete isolation, restart persistence, wrong credentials 403, production outage fail-closed 503, explicit and dev fallback |
| Storage 404 regression | `storageProductionFailClosed.test.js` | **PASS** — a missing cloud object returns 404, not 503, and never touches the local fallback |
| Production backup | `pg_dump` → encrypt → decrypt → isolated PostgreSQL 18 restore | **PASS** — 44 tables, 11 migrations, matching row counts/content hashes, 115 indexes, 50 FKs; see `BACKUP_DR.md` §13.1 |
| Android runtime | `flutter devices`, `adb devices`, `flutter emulators` | **NOT TESTED** — no physical device and no emulator/AVD on the build host |

The MinIO harness proves the application's S3 code path, **not** a production bucket:
no durable object storage is configured on Render. See §5.

### 2.11 Phase 9 verification (2026-10-26)

Phase 9 re-ran the whole suite **after** the dependency remediation, then added a
production smoke pass, a storage/receipt/FCM pass, a simulator-semantics pass and a
rate-limiter regression. All real-database work ran against an isolated
`finpro_phase9_verify` database — never `finance_jinay` and never production.

| Suite | Level | Result |
|---|---|---|
| Jest (`npm run test:unit`) | L1 | **35/35 suites, 572/572 tests PASS** |
| `scripts/run-all-tests.js` | L3 | **166/166 PASS** |
| `scripts/test-sms-mobile-suite.js` | L3 | **41/41 PASS** |
| `scripts/test-cloud-verification.js` | L3 | **29/29 PASS** |
| `scripts/test-cloud-failure.js` | L3 | **17/17 PASS** |
| `scripts/verify-transfer-idempotency.js` | L2 | **62/62 PASS** |
| `scripts/verify-deposit-idempotency.js` | L2 | **32/32 PASS** |
| `scripts/verify-ai-confirmation.js` | L2 | **31/31 PASS** |
| Simulator semantics harness (isolated DB, simulator enabled) | L3 | **19/19 PASS** |
| Storage / receipt / FCM harness | L3 | **23/23 PASS** |
| Production API smoke | L4 | **31 PASS**, 1 PARTIAL, 1 harness-assertion artefact (corrected) |
| Production storage / receipt / FCM smoke | L4 | **23 PASS** |
| Flutter widget tests (`flutter test --no-pub`) | L1 | **239/239 PASS** |
| JavaScript syntax lint (`scripts/lint.js`) | L1 | **115/115 files clean** |
| Tracked-secret scan (`scripts/scan-secrets.js`) | L1 | **367 files, 0 secrets** |
| Production build verification (`npm run build`) | L1 | **PASS** |
| Flutter static analysis (`flutter analyze --no-pub`) | L1 | **No issues found** |

**Total executed assertions: 1,285.**

#### Rate-limiter regression (P0 fix, `f6cdf9f`)

The health-probe defect is the one production failure this phase found. Health
probes shared the 200/15 min general limiter; Render probes every ~5 s (≈180 per
window), so the budget was consumed by the platform, probes received `429`, the
instance was marked unhealthy and restarted — a self-reinforcing `502` loop with no
user traffic.

| Check | Method | Result |
|---|---|---|
| Defect reproduced | 210 sequential probes against the old policy | 199 × `200`, then 11 × `429` |
| Fix — health exempt | 1100 sequential `/api/v1/health` probes | **1100/1100 `200`** |
| Fix — general cap intact | 1001+ requests to `/api/v1/accounts` | 1000 × non-`429`, then `429` |
| Auth limiter separate | auth namespace budget | still 100/15 min, unaffected by health traffic |
| Production stability | 24 consecutive `/api/v1/health` probes over 4+ minutes on `f6cdf9f` | **24/24 `200`**, no `429`, no `REQ-ERROR` in logs |

Run the limiter regression locally with the backend on a loopback port and a
throwaway database; it needs no production access.

#### Phase 9 production smoke (L4)

Two synthetic accounts, all traffic over HTTPS against `f6cdf9f`, everything
deleted through the account-deletion API afterwards. Baseline was restored
(9 users, 30 transactions, 11 accounts, 5 budgets, 0 idempotency rows,
29 audit logs).

Covered: register/login/me/refresh/delete, cross-tenant `404` on accounts,
transactions, storage and receipts, account/transaction/budget CRUD, transfer
replay and `409 IDEMPOTENCY_CONFLICT`, deposit replay `200`, AI
`source=gemini-tools`, live market quote, simulator `403 SIMULATOR_DISABLED`,
PNG/PDF/CSV upload and byte-identical download, SVG `415`, MIME mismatch `415`,
4 MB `201`, 8 MB `413`, receipt text and image OCR plus confirm/replay, FCM
register/remove/test-push, and deletion with a stored file (token `401`
afterwards).

#### What this does **not** prove

Unchanged from Phase 8 and still true after Phase 9: no Android device run, no
FCM delivery to a device, no production load/soak, no durable production object
storage, no scheduled off-host backup, no live Redis, no AI answer-quality
evaluation, and no independent security assessment. The per-item statuses are in
[`FINPRO_EVALUATION_TEST_MATRIX.md`](FINPRO_EVALUATION_TEST_MATRIX.md).

---

## 3. Negative Testing Matrix

| Scenario | Input / Action | Expected Result | Verified Status |
|---|---|---|---|
| **Weak Password** | `Password1` (<8 chars) | `400 VALIDATION_ERROR` | ✅ Verified |
| **Duplicate Email** | `jinay@test.com` | `409 EMAIL_EXISTS` | ✅ Verified |
| **Malformed JWT** | `Bearer invalid.jwt.token` | `401 INVALID_TOKEN` | ✅ Verified |
| **Expired JWT** | Expired access token | `401 TOKEN_EXPIRED` (Triggers client refresh) | ✅ Verified |
| **Revoked Refresh Token** | Token after logout | `401 TOKEN_REVOKED` | ✅ Verified |
| **Cross-Tenant Access** | User B queries User A account ID | `404 NOT_FOUND` | ✅ Verified |
| **Transfer destination on a non-transfer** | `POST /transactions` with `type: "EXPENSE"` and `toAccountId` | `400 VALIDATION_ERROR`, no ledger row | ✅ Jest |
| **Transfer to the same account** | `type: "TRANSFER"` with `accountId === toAccountId` | `400 VALIDATION_ERROR`, no balance change | ✅ Jest |
| **Transfer to a foreign account** | `type: "TRANSFER"` with another user's `toAccountId` | `404 NOT_FOUND` (no ownership leak) | ✅ Jest |
| **PATCH into/out of a transfer** | Change `type` to or from `TRANSFER` | `400 VALIDATION_ERROR`; delete + recreate instead | ✅ Jest |
| **Invalid transaction pagination** | `page=0`, `limit=101` or unknown `type` | `400 VALIDATION_ERROR` instead of silent coercion | ✅ Jest |
| **Invalid Transaction ID** | `DELETE /transactions/non-existent-uuid` | `404 NOT_FOUND` | ✅ Verified |
| **Voice Intent Safety** | "Create expense ₹500" via voice | Returns intent with `requiresConfirmation: true` | ✅ Verified |
| **Negative Amount** | Transaction amount `-500` | Rejected by validation | ✅ Verified |
| **Redis unavailable** | Cache/limiter cannot reach Redis | Memory fallback; no 500; limits stay per-instance | ✅ Jest |
| **Upstream timeout / 429** | Provider hangs or rate-limits | Bounded retry, then safe error; circuit opens | ✅ Jest |
| **Duplicate SMS import** | Same bank message twice | One ledger row; duplicate push suppressed | ✅ Custom + Jest |
| **Spoofed upload** | HTML bytes with `image/png` name | Rejected before storage | ✅ Jest |
| **Malformed data URL** | Invalid base64 upload | `400`, nothing stored | ✅ Jest |
| **Backup restore over non-empty DB** | Restore into a populated database | Refused (exit 4), no writes | ✅ Drill |
| **Encrypted backup, wrong key** | Restore `.dump.enc` with a different key | Authentication failure (exit 3), target unchanged | ✅ Drill + Jest |
| **Tampered encrypted archive** | Flip ciphertext or header bytes | GCM authentication fails; no plaintext written | ✅ Jest |
| **Publish plaintext dump** | `backup:publish` with `*.dump` | Refused before any upload | ✅ Jest |
| **Push queue full** | Enqueue beyond `PUSH_QUEUE_MAX` | Refused and counted, HTTP path still returns | ✅ Jest |
| **Worker shutdown mid-queue** | Shutdown with queued jobs | New work refused; queue drains until deadline | ✅ Jest |

---

## 4. AI Test Strategy (and what it does not prove)

The `/ai/chat` route is assistant-first: it tries Gemini tool-calling, then the deterministic action engine, then RAG. Letting the live provider run inside `run-all-tests.js` made assertions depend on model wording and quota, so the suite **stubs the provider at the service boundary** and drives the real controller, assistant loop, tool executors and Prisma writes from scripted `functionCalls` / text.

Covered deterministically:
- A model-issued `create_transaction` tool call actually writes the ledger row and moves the account balance.
- A provider error mid-flight degrades to the deterministic engine with no 500 surfaced.
- Empty messages are rejected with `400 VALIDATION_ERROR`.
- `GET /ai/history` caps at 50, returns the **most recent** 50 (not the oldest), oldest-first, and is tenant-scoped. This guard was proven to fail against the pre-fix ascending query.
- RAG keeps a bounded provider/timeout budget instead of fanning out without limit.

A live smoke test is opt-in only: `AI_LIVE_SMOKE=1 node run-all-tests.js`.

Not covered: answer quality, prompt-injection resistance, token streaming (not implemented), multi-round tool-calling beyond the scripted cases, and the server-side total wall-clock deadline (see `AI.md` and `OPERATIONS.md`).

---

## 5. Known Verification Gaps

Be explicit about these before claiming a release is "fully tested":

| Gap | Consequence |
|---|---|
| Redis is not provisioned in the current deployment | Shared-cache and shared-rate-limit paths are tested with mocks/local semantics, not against a live managed Redis. Cross-instance behaviour is unverified in production. |
| No live staging backend was exercised in this pass | Contracts are verified statically and against the local test database. **Phase 4:** a real local backend + frontend + isolated database were exercised end-to-end (including a browser session), but a *staging* deployment was not — schema drift on the target platform is still unverified. |
| No automated Android device/emulator run | Layout, permissions, SMS ingestion and accessibility on real hardware are covered only by widget tests and a manual APK smoke pass, not by an automated UI suite. **Phase 7:** the new privacy/consent/deletion flows have widget coverage only; no device run has been recorded, so the runtime permission dialog, the `MethodChannel` calls and the external-link handoff are unverified on hardware. **Phase 8:** the build host has no physical device, no emulator and no AVD (`adb devices` empty, `flutter emulators` → none), so this is **NOT TESTED**, not "passed". See `GOOGLE_PLAY_COMPLIANCE.md`. |
| No browser automation for `frontend/public` | The web app has no build or test harness. **Phase 4:** the propose → confirm → cancel journey *was* executed in a real browser against the local stack and an isolated database (expiry, replay, network failure and five concurrent confirms), but it is a **manual** procedure, not an automated CI gate. **Phase 6:** the homepage ripple, pointer pass-through, cleanup and `prefers-reduced-motion` behaviour were likewise verified manually in real Chrome, including with `--force-prefers-reduced-motion`; no CI browser test exists. |
| Live Gemini responses not exercised by default | Model behaviour/wording is unverified; only the plumbing is. |
| No sustained load/performance suite | **Phase 8** ran a bounded local run: 900 requests at concurrency 12 against a loopback backend + local PostgreSQL, 900/900 succeeded, p50 8.4 ms / p95 15.8 ms / p99 22.5 ms, ~1,366 req/s, synthetic user deleted afterwards (0 residue). That measures the app+DB path on one laptop, **not** production capacity: no Redis, the API rate limiter is disabled under `NODE_ENV=test`, no multi-instance behaviour, no cold start, and no sustained soak. The push queue and cache bounds remain functionally tested only. |
| No scheduled production backup / off-host copy | A verified encrypted production backup **was** taken and restored in isolation on 2026-10-26 (`BACKUP_DR.md` §13.1), so a recoverable archive exists. But it is not off-host, the workflow has never run on a schedule, and no restore has been performed from an off-host copy. Treat backups as **not operational**. |
| Production uploads are non-durable | Production runs the local storage provider (`durable:false`, `ephemeral:true`). Uploads succeed but are lost on redeploy. The S3 code path is proven against local MinIO, but no production bucket is configured. |
| Render PostgreSQL expires 2026-11-11 | The free plan cannot be extended; after a 14-day grace period Render deletes the database and all data. Requires owner-authorised paid plan change. See `BACKUP_DR.md` §13.2. |
| No live S3-compatible publish/restore for **backups** | `backup:publish` upload, SSE and download-back verification are unit-tested and dry-run only; a live bucket round trip (including a restore from the downloaded object) is unverified. This is separate from the application storage path, which was proven against local MinIO. |
| RPO/RTO unmeasured | The 24-hour/4-hour targets have not been timed against a production-sized database. |
| `/ai/chat` has no total wall-clock deadline | Per-call timeout is bounded, but the worst-case chain is still long. |
| Generic creation and loan payments lack idempotency | Deposits and transfers are idempotent (optional `idempotencyKey`, enforced by the `idempotency_records` primary key; verified by `verify-deposit-idempotency.js` and `verify-transfer-idempotency.js`). Generic income/expense creation and loan payments still have no key, so a retry of those can apply twice. |
