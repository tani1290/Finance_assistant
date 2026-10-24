# FinPro Phase 5 — Staging Readiness & Operational Validation

Status: **locally verified for the backend + web client; NOT staging-ready and
NOT production-ready.** Every check that can run on this machine passed when
re-run on 2026-10-22, but the staging deployment itself was **not executed**
(no staging environment exists from here, §5), so the staging-readiness claim
is deliberately withheld. The production blockers in §9 remain open.

Nothing was deployed. No production database, environment variable or remote
resource was touched. No commit, push, merge, reset or clean was performed.

---

## 1. Initial and final Git state

| | Phase 5 start | Re-verified 2026-10-22 |
|---|---|---|
| Branch | `finpro/pre-deployment-checkpoint` | unchanged |
| HEAD | `f3dd6be6159d04c533bb2f9627106a2b6ebd5ae2` | **unchanged** (no commit was made) |
| Modified paths | 85 | 87 |
| Untracked paths | 88 | 93 |
| Staged paths | 0 | 0 |
| Deleted paths | 0 | 0 |
| Total | 173 | 180 |

The count grew because the release itself was edited during Phases 4–5 (new
tests, scripts, migrations and docs). Every pre-existing modification and
untracked file is preserved. Nothing was reset, cleaned, overwritten or
discarded.

### 1.1 The most important Phase A finding: HEAD does **not** contain the release

`git cat-file -e HEAD:<path>` was run for every release-critical artifact:

| Artifact | In HEAD? |
|---|---|
| `node-backend/src/services/aiConfirmationService.js` | **no** |
| `prisma/migrations/20261021120000_ai_action_proposals` | **no** |
| `prisma/migrations/20261021130000_ai_action_execution_state` | **no** |
| `prisma/migrations/20261022120000_transaction_idempotency_key` | **no** |
| `src/utils/dateOnly.js` (the date-only contract) | **no** |
| `src/__tests__/aiConfirmation.test.js` | **no** |
| `scripts/backup-db.js`, `restore-db.js`, `publish-backup.js` | **no** |
| `docs/PHASE3_*`, `docs/PHASE4_*` | **no** |

HEAD contains 4 migrations; the working tree contains 7. **Deploying HEAD would
ship an application without the AI confirmation gate at all** — in that build
the assistant can execute a mutation without any user approval. The release
artifact is therefore the **working tree**, and a release must be cut from a
commit that contains these files. Nothing was committed in this phase (the
task forbids it); the operator checklist in §6 makes "commit the working tree"
an explicit, first step.

### 1.2 What is in the working tree but unrelated to this release

| Path | Nature | Disposition |
|---|---|---|
| `.artifacts/` (7.1 MB, 27 device screenshots) | Local QA screenshots | **Preserved, excluded.** Not referenced by the app. Should be git-ignored before the release commit. |
| `mobile/android/app/src/debug/…`, `mobile/ios/…` | Platform config from earlier phases | Preserved, part of the release |
| `mobile/lib/core/config/`, `mobile/lib/features/{analytics,calendar,insurance,profile}/` | Earlier-phase client work | Preserved, part of the release |
| `docs/AI.md`, `BACKUP_DR.md`, `CLOUD_AUDIT.md`, `OPERATIONS.md`, `PARITY.md`, `README.md` | Earlier-phase documentation | Preserved, part of the release |

Nothing in the working tree is junk; the only artefact that should not ship in
the repository is `.artifacts/`.

### 1.3 Uncertainty about what a deployment would include

| Question | Answer |
|---|---|
| Does a Render build pick up the working tree? | **No.** Render builds the **committed branch**. The uncommitted working tree is invisible to it. |
| Does `render.yaml` reference anything untracked? | It references `node-backend/scripts/deploy-migrate.js` — **untracked today**, so a build from HEAD would fail to start. |
| Does the Dockerfile copy the migration folder? | Yes (`COPY node-backend/prisma ./node-backend/prisma`), but the **migrations directory is untracked**. |
| Does the Docker build copy the test files? | No (only `src`, `scripts`, `prisma`, `frontend/public`) — correct. |
| Is `node-backend/jest.setup.js` needed at runtime? | No. It is a test-only file and is not copied into the image. |
| Could a stale `node_modules/.prisma/client` be deployed? | Not on Render (fresh `npm install` → `prisma generate`), but the local checkout had one. `scripts/build.js` now always regenerates and **fails the build** if the client lacks a required field. |

---

## 2. Files changed in Phase 5, with reasons

| File | Change | Why |
|---|---|---|
| `node-backend/prisma/schema.prisma` | `Transaction.idempotencyKey` (nullable) + new `IdempotencyRecord` model (including nullable `requestFingerprint`) + `User.idempotencyRecords` | Deposit idempotency (Phase E) |
| `node-backend/prisma/migrations/20261022120000_transaction_idempotency_key/migration.sql` | **new** — additive column + table with a primary key | The schema change above, applied additively |
| `node-backend/prisma/migrations/20261022130000_idempotency_request_fingerprint/migration.sql` | **new** — additive nullable `requestFingerprint` column | Reject a key reused with different deposit details, without a unique constraint on an existing table |
| `node-backend/src/controllers/accountController.js` | Replay-safe deposit: optional `idempotencyKey`, canonical payload fingerprint, key claimed inside the same transaction, 409 on conflicting details, replay message built from the original amount, concurrent loser converges or conflicts correctly, per-user advisory lock, default account resolved inside the transaction | Phase E defect fix |
| `node-backend/src/routes/index.js` | Default account resolution moved into the deposit transaction; new `POST /ai/actions/status` | Phase E + Phase D |
| `node-backend/src/controllers/aiController.js` | New `getActionStatus` handler | Phase D (resolve a dropped response honestly) |
| `node-backend/src/services/aiConfirmationService.js` | New `getProposalStatus` (read-only) | Phase D |
| `node-backend/src/__tests__/depositIdempotency.test.js` | **new** — 16 tests, including conflicting sequential and concurrent replays | Phase E regression coverage |
| `node-backend/src/__tests__/aiConfirmation.test.js` | +6 tests for the status probe | Phase D regression coverage |
| `node-backend/scripts/verify-deposit-idempotency.js` | **new** — 32 checks against a real database | Phase E evidence |
| `frontend/public/assets/js/api.js` | `actionStatus()` client + `executionState`/`retryable` on errors | Phase D |
| `frontend/public/ai-advisor.html` | On a dropped confirm response, probe the server instead of guessing | Phase D |
| `frontend/public/dashboard.html` | Deposit sends a stable `idempotencyKey`; the missing `try/catch` added | Phase E |
| `mobile/lib/features/accounts/accounts_screen.dart` | Deposit sends a stable per-sheet `idempotencyKey` | Phase E |
| `mobile/test/analytics_profile_deposit_test.dart` | Body assertion updated; **new** test: a retry reuses the same key | Phase E |
| `package.json` (root) | **new** `db:reconcile` and `db:reconcile:strict` scripts | The documented pre-deploy command did not exist at the repo root (§3.4) |
| `.github/workflows/ci.yml` | **new** `mobile-tests` job (pinned Flutter 3.38.7) | Phase G |
| `docs/API.md`, `DEPLOYMENT.md`, `PARITY.md` | Deposit idempotency contract, status endpoint, Phase 5 migration note | Documentation of the new behaviour |

---

## 3. Tests actually executed (commands, exit codes, results)

All commands were run from the repository root or `node-backend` as noted.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npx prisma validate` | **0** | schema valid |
| 2 | `npm run build` (production build verification) | **0** | schema valid → client regenerated → required model fields present → entrypoints present |
| 3 | stale-client check (`schema.prisma` vs `node_modules/.prisma/client/index.js` mtime) | **0** | not stale; the build now also fails hard on a stale client |
| 4 | `npx jest --runInBand` (before Phase 5 changes) | **0** | 385 tests / 26 suites passed |
| 5 | `npm test` (custom suites) | **0** | 166/0 and 41/0 |
| 6 | `npm run test:cloud` | **0** | 29/0 |
| 7 | `npm run test:failure` | **0** | 17/0 |
| 8 | `cd mobile && flutter test` | **0** | 183 passed |
| 9 | `npm run lint` (syntax + secret scan) | **0** | 101 files clean; 240 tracked files, **0 secrets** |
| 10 | `npm run backup:verify` (recovery drill) | **0** | plaintext + encrypted round trip, wrong key rejected, non-empty target refused |
| 11 | `git diff --check` | **0** | clean |
| 12 | `npx jest --runInBand` (after Phase 5 changes) | **0** | **407 tests / 27 suites passed** |
| 13 | `npm test` (after Phase 5 changes) | **0** | 166/0 and 41/0 |
| 14 | `npm run test:cloud` / `npm run test:failure` (after) | **0** | 29/0 · 17/0 |
| 15 | `cd mobile && flutter test` (after) | **0** | **184 passed** |
| 16 | `npm run lint` (after) | **0** | 102 files clean; 0 secrets |
| 17 | `npm run db:reconcile` (local dev DB only) | **0** | P3005 → additive `db push` → reconciled |
| 18 | `npx prisma migrate deploy` on an isolated empty DB | **0** | 8/8 migrations applied |
| 19 | `npx prisma db push` on a **clone of the populated dev DB** | **0** | applied additively, **no data-loss warning**, all rows preserved |
| 20 | `node scripts/verify-deposit-idempotency.js` (real PostgreSQL) | **0** | **32/32 checks** |
| 21 | `node scripts/verify-ai-confirmation.js` (real PostgreSQL, Phase 4 script, re-run) | **0** | 31/31 (unchanged by Phase 5) |
| 22 | `cd mobile && flutter analyze --no-pub` | **0** | no issues found |

### 3.4 Independent re-verification (2026-10-22)

The counts above were re-produced from scratch, not carried forward. A new,
empty local PostgreSQL database was created
(`finpro_p5_fingerprint_verify_20261022`) so the result could not be
contaminated by an older verification database. Only local resources were
used.

| # | Command | Exit | Result |
|---|---|---|---|
| R1 | `git status --short` · `git diff --cached --name-only` | 0 | 181 changed (87 modified, 94 untracked), **0 staged** |
| R2 | `npx prisma validate` (`node-backend`) | 0 | schema valid |
| R3 | `npx prisma migrate deploy` on the fresh DB | 0 | **8/8 migrations applied from empty** |
| R4 | `npx jest --runInBand src/__tests__/depositIdempotency.test.js src/__tests__/aiConfirmation.test.js` | 0 | **2 suites, 48 tests** (16 deposit + 32 AI) |
| R5 | `npx jest --runInBand` | 0 | **27 suites, 407 tests** |
| R6 | `node scripts/verify-deposit-idempotency.js` on the fresh DB | 0 | **32/32 checks** |
| R7 | `npx prisma migrate status` on the fresh DB | 0 | **8 migrations found, schema up to date** |
| R8 | `npx prisma migrate diff --from-url <fresh DB> --to-schema-datamodel prisma/schema.prisma --exit-code` | 0 | **"No difference detected"** |
| R9 | `npm run build` (`node-backend` and repo root) | 0 | schema valid, client regenerated, required fields and entrypoints present |
| R10 | `cd mobile && flutter test --no-pub` | 0 | **184 passed** |
| R11 | `git diff --check` | 0 | clean (no whitespace errors) |

### 3.5 Additional real-database checks

The reproducible checks live in the 32-check script, which creates throwaway
users against a freshly migrated database. The earlier ad-hoc 15-check pass
also exercised the keyless default-account race; that scenario is not part of
the 32-check script and was not re-executed after the fingerprint change.

| Scenario | Input | Result |
|---|---|---|
| Concurrent **keyless** default-account deposits (no `accountId`) | 5 simultaneous deposits (100…500) | Earlier pass: 5×200, **exactly one** default account, all five rows on it, balance 1500 = ledger sum |
| Concurrent **identical** keyed deposits | 5 simultaneous deposits, same key and amount | 5×200, same `transactionId`, **one** credit, **one** ledger row (32-check script) |
| Concurrent **conflicting** keyed deposits | 5 simultaneous deposits, same key, amounts 11…55 | **one 200 and four 409**; one ledger row; only the winning amount credited (32-check script) |
| Invalid date + idempotency key (rollback atomicity) | `date: "2026-02-31"` | **400**; balance unchanged; 0 ledger rows; **0 idempotency claims**; the same key retried with a valid date succeeds and credits once (32-check script) |
| Same key, different amount | key used for 250, retried as 9999 | **409 `IDEMPOTENCY_CONFLICT`**; balance still **250**; one ledger row; key claim unchanged (32-check script) |


### 3.1 Tests **not** executed, and why

| Test | Status | Reason |
|---|---|---|
| Off-site encrypted backup upload + remote download + isolated restore | **NOT EXECUTED** | No provider credentials and no authorisation to create or write to a remote bucket. Exact steps in §7. |
| Live AI provider smoke test (`AI_LIVE_SMOKE=1`) | **NOT EXECUTED** | It calls the real provider and costs quota; every local run used the deterministic fallback. Exact steps in §7. |
| Staging deployment / staging smoke tests | **NOT EXECUTED** | No staging environment exists (no staging config, no credentials, no isolated staging database). See §5. |
| GitHub Actions run of the new `mobile-tests` job | **NOT EXECUTED** | The workflow can only run on the remote repository; the job was validated locally by running the same two commands (`flutter analyze --no-pub`, `flutter test --no-pub`) against the pinned Flutter version. |
| Load / performance testing | **NOT EXECUTED** | Out of scope and unchanged from Phase 4. |
| Android device / emulator run | **NOT EXECUTED** | No device or emulator available; unchanged from Phase 4. |

### 3.2 A defect the Phase 5 validation exposed

The first design of the deposit fix used a `@@unique([userId, idempotencyKey])`
constraint on `transactions`. Running the real deploy path against a clone of
the populated database showed that **`prisma db push` refuses to add a unique
constraint to an existing table** without `--accept-data-loss`, which this
project never passes:

```
⚠️  There might be data loss when applying the changes:
  • A unique constraint covering the columns `[userId,idempotencyKey]` on the
    table `transactions` will be added. …
Error: Use the --accept-data-loss flag …
```

On the production database (which is `db push`-managed) that would have made
`db:reconcile` fail, leaving the new column missing at start-up. The design
was changed to a dedicated `idempotency_records` table whose **primary key**
is the guarantee. `db push` then applies the change with no warning (check 19
above). This is the single most valuable outcome of the Phase 5 rehearsal.

### 3.3 A second defect: the documented migration command did not exist

`docs/DEPLOYMENT.md` §2.3, the Phase 4 report and the Phase 4 checklist all
instruct the operator to run **`npm run db:reconcile`** — but that script
existed only in `node-backend/package.json`. From the repository root the
command failed with `npm error Missing script: "db:reconcile"`. The root
`package.json` now has `db:reconcile` and `db:reconcile:strict`.

---

## 4. AI action safety (Phase D)

| Property | Implementation | Evidence |
|---|---|---|
| Single-use tokens | Claim is one conditional `UPDATE … WHERE status='PENDING' AND expiresAt > now` | 6 Jest tests + 31 real-DB checks |
| Concurrent confirmation | Exactly one request can leave `PENDING` | 5 parallel HTTP confirms → 1×200, 4×409, **1** ledger row; 5 parallel claims → 1 winner |
| Replay rejection | `409 ACTION_ALREADY_COMPLETED` / `ACTION_IN_PROGRESS` | Jest + real DB |
| Expiration rejection | `410 ACTION_EXPIRED`, row marked `EXPIRED` | Jest + real DB |
| Cross-user isolation | Every lookup is `where: { tokenHash, userId }` | Jest + real DB (404, owner row untouched) |
| DB failure **after** the token is claimed | Proposal → `FAILED` (terminal), `500 ACTION_OUTCOME_UNKNOWN`, `retryable: false`, no "nothing changed" claim | Jest |
| DB failure **before** the mutation | `503 ACTION_START_UNAVAILABLE`, `retryable: true`, tool never called, the same token still works | Jest |
| Successful mutation + failed chat-history write | Still `200 executed: true`; the action is never reported as failed | Jest |
| Retry semantics | Only a provably-not-started failure is retryable; every other terminal state is not | Jest + real DB |
| Duplicate mutation prevention | At-most-once by construction | 5× concurrency proof above |

**New in Phase 5 — the one behaviour that was safe but incomplete.** After a
*network* failure the web client could not know whether the mutation had been
applied. It correctly refused to guess and refused to re-arm the button, but
the user had no way to find out. The new read-only `POST /ai/actions/status`
resolves that:

- `applied: true` → "This action was already applied" (no retry offered).
- `retryable: true` → "The action was not applied. It is safe to press Confirm again."
- `EXECUTING` / `FAILED` / `CANCELLED` / `EXPIRED` → the matching honest message, button stays disabled.

The token travels in the request **body**, never in a URL, so it cannot leak
into an access log. The endpoint never mutates anything (covered by 6 new
Jest tests, including "the probe does not change the row").

**Design decisions recorded (not bugs)**

| Decision | Rationale |
|---|---|
| The proposal row and the business mutation are **not** in one transaction | The tools own their own transactional boundaries (transaction + balance + notification) and some steps are not transactional. A distributed transaction is a larger architectural change with its own failure modes. The state machine instead guarantees at-most-once execution and makes the outcome explicit. |
| A proposal stuck in `EXECUTING` (server killed mid-action) is **not** auto-reclaimed | Reclaiming it could duplicate a committed mutation. The honest answer is "already being applied"; the user prepares a new request. |
| The legacy `legacy:<INTENT>` proposal binds the **message**, not the parsed parameters | The user is shown the raw message in the confirmation, so the action stays reviewable. The parsed amount is therefore visible to the user in the text. |

---

## 5. Deposit idempotency (Phase E) — findings and fix

### 5.1 Was it a defect or an unverified risk?

A **confirmed defect**. Before Phase 5 there was no idempotency mechanism at
all: the transaction identity was a fresh `uuid()` from Prisma, there was no
idempotency key, and no database constraint could distinguish two deposits of
the same amount. The only protection was a client-side in-flight guard, which
does not survive a timeout (the request may have been applied) — the mobile
sheet even documented this in a comment. The web client was worse: it had no
`try/catch`, so a network failure left the button disabled **and** raised an
unhandled rejection, and the user could then press it again and credit twice.

### 5.2 The fix

| Aspect | Implementation |
|---|---|
| Transaction identity | `Transaction.idempotencyKey` — the client's key, stored for traceability |
| The guarantee | `idempotency_records` with primary key `(userId, scope, key)` — the database rejects a second claim |
| Request identity | `IdempotencyRecord.requestFingerprint` — SHA-256 of a canonical JSON payload containing `accountId`, amount (2 decimals), `source`, `description` and the **requested** date (`null` when omitted). A key reused with different details is a different deposit. |
| Replay | Returns the **original** `transactionId` with `replayed: true`, `originalAmount` and a message built from `transaction.amount` ("already applied; no new funds were added"); the balance is not touched |
| Conflicting replay | **`409 IDEMPOTENCY_CONFLICT`**; no ledger row, no balance change, no new claim. Covers sequential and concurrent requests. |
| Concurrent requests | The loser converges on the original transaction when the payload matches; a conflicting loser gets `409` without seeing the winner's transaction |
| Per-user serialisation | A PostgreSQL advisory lock inside the transaction removes the default-account race window; the primary key remains the real guarantee. The mocked "lock failure does not block" path was not reproduced against real PostgreSQL (§5.4). |
| Validation ordering | The requested date is parsed before the transaction starts, so an invalid date returns `400` with no partial write and no key claim. |
| Default account | Resolved **inside** the transaction (previously outside), so two concurrent first-time deposits cannot create two "Primary Account" rows |
| Compatibility | The key is **optional**; a client that does not send one behaves exactly as before. `requestFingerprint` is nullable and every existing row keeps `NULL`; a legacy row falls back to comparing the stored amount. |
| Clients | Web: one key per logical deposit, kept until a confirmed success. Mobile: one key per sheet (a new deposit is a new sheet). |

### 5.3 Evidence

- 16 Jest tests (duplicate, conflicting sequential replay, conflicting concurrent loser, cross-account, cross-user, keyless, validation, default account, lock failure).
- **32/32 checks against a real PostgreSQL database**
  (`node-backend/scripts/verify-deposit-idempotency.js`): identical concurrent
  deposits produce **one** credit and **one** row; conflicting concurrent
  deposits produce one winner and four `409`s; a conflicting sequential replay
  returns `409` without changing the balance; an invalid date rolls back before
  claiming the key and the same key can then be retried; the replay message
  never claims new funds were added; the balance always equals the ledger sum.
- **15/15 additional real-database checks** in the earlier pass (§3.5): the
  concurrent keyless default-account race created exactly one account. The
  rollback and same-key-conflict scenarios from that pass are now part of the
  32-check script.

### 5.4 Residual defect

**The advisory-lock fallback is only proven with a mock.** The real-DB run did
not force `pg_advisory_xact_lock` to fail. The mocked test "a lock failure
never blocks the deposit" may not reflect PostgreSQL: a failed statement aborts
the surrounding transaction, so the `catch` could not necessarily continue.
The primary key remains the real guarantee either way.

The two response defects found during the earlier validation pass are fixed
and covered by regressions:

1. A replay message is now built from the original `transaction.amount`, not
   the retried amount, and reports `originalAmount`. A key used for ₹250 and
   retried as ₹9,999 returns `409` (not a misleading success).
2. A replay now validates the request against the stored fingerprint (or the
   stored amount for legacy rows) and returns `409 IDEMPOTENCY_CONFLICT` on a
   mismatch instead of replaying an unrelated payload.


---

## 6. Staging prerequisites

### 6.1 Is a staging environment available?

**No.** Checked without exposing any value:

| Probe | Result |
|---|---|
| Staging config in the repository | none (no `render.staging.yaml`, no staging compose file) |
| Staging environment variables in the shell | none (`STAGING*`, `RENDER*`, `AWS_*`, `BACKUP_S3_*`, `REDIS_URL`, `DIRECT_URL` all absent) |
| `render` / `aws` CLIs | installed, but **no credentials or configuration are present**, and no authorisation was given to create or authenticate against a remote account |
| Local `.env` | points at the **local development** database (`127.0.0.1:5432/finance_jinay`) — not a staging target |

No staging write was attempted, and none is possible from here. The exact
operator steps are in `docs/PHASE5_STAGING_CHECKLIST.md`.

### 6.2 Configuration verified by inspection (no values read or printed)

| Area | Requirement | Verified how |
|---|---|---|
| Database target isolation | `DATABASE_URL` must point at the **staging** database, never production | `render.yaml` has `DATABASE_URL: sync: false` (an operator-set value). Isolation must be confirmed by the operator before the first write. |
| Migration connection | Optional `DIRECT_URL` for a DDL-capable connection when `DATABASE_URL` is a transaction pooler | `scripts/deploy-migrate.js` tries `DIRECT_URL` → `DATABASE_URL` → a derived session pooler, and refuses `--accept-data-loss` |
| Authentication | `JWT_SECRET`, `JWT_REFRESH_SECRET` (**no fallback** — `jwt.sign` throws without them), `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | `src/services/authService.js`, `src/middleware/auth.js` |
| CORS | `FRONTEND_URL` must be the **staging** web origin, or the staging client is blocked | `src/app.js` allowlist |
| AI provider | `GEMINI_API_KEY` (optional — the app falls back to the deterministic engine), `AI_MODEL`, `AI_ACTION_TOKEN_TTL_MS`, `AI_ASSISTANT_TOTAL_TIMEOUT_MS` | `src/services/aiService.js`, `.env.example` |
| Storage | `STORAGE_PROVIDER` (`local` \| `s3`), `S3_*`, `STORAGE_LOCAL_DIR` | `src/services/storageService.js` |
| Backup | `BACKUP_*` — **operator CLI only, never read by the server** | `scripts/backup-db.js`, `scripts/publish-backup.js` |
| Metrics | `METRICS_TOKEN` — unset in production ⇒ `GET /metrics` returns 404 | `src/app.js` |
| Cache / rate limit | `REDIS_URL` optional; without it the app falls back to per-process memory | `src/services/cacheService.js`, `rateLimitStore.js` |
| Health checks | `/api/v1/health/live` (Render probe), `/api/v1/health/dependencies`, `/api/v1/health/ready` | `src/app.js`, `render.yaml` |
| Startup / shutdown | `deploy-migrate.js && node src/server.js`; SIGTERM → stop the market worker → drain HTTP (10 s) → drain the push queue (5 s) → close cache → disconnect Prisma → exit 0 | `src/server.js` |
| Build artifact | `npm --prefix node-backend install && npm --prefix node-backend run build`; the Docker image also needs `frontend/public` and `node-backend/prisma` | `render.yaml`, `Dockerfile` |
| Logging | `morgan('combined')` in production, `requestLogger` middleware, `sanitizeErrorForLog` | `src/app.js` |
| Proxy trust | `TRUST_PROXY_HOPS=1` for Render (one edge proxy). Unset ⇒ a client-supplied `X-Forwarded-For` is never trusted | `src/app.js`, `render.yaml` |

### 6.3 Migration procedure and rollback considerations

Procedure: backup → `npm run db:reconcile` → verify `\d ai_action_proposals`
and `\d idempotency_records` → confirm the build log shows the regenerated
client → smoke-test the AI confirmation and a deposit → replay the same
deposit key to prove the replay path.

Rollback: **all three migrations are additive**, so a code rollback is always
safe (the older code ignores the extra columns and tables). The reverse — new
code on an old schema — is **not** safe: the confirmation path and the deposit
idempotency path would fail closed. There is no down-migration, and none is
needed: on this project's `db push`-managed database the schema is reconciled
additively, so a rollback leaves the extra objects in place. Dropping them
would destroy the execution audit trail and is not part of any rollback path.

**Changes that cannot be rolled back safely:** none of the Phase 5 code
changes touch user data. The only irreversible operation in the whole release
is `DROP TABLE idempotency_records` / `DROP COLUMN transactions.idempotencyKey`,
which is not automated and must not be run as part of a rollback.

---

## 7. Off-site recovery and live-provider smoke-test status (Phase F)

**Both are BLOCKED on missing prerequisites, and neither is claimed to have
passed.**

### 7.1 Prerequisites that are missing

| Prerequisite | Where it goes | Present? |
|---|---|---|
| `BACKUP_DATABASE_URL` | GitHub Actions secret (or a local operator env) | **no** |
| `BACKUP_ENCRYPTION_KEY` (base64 32 bytes or 64 hex) | GitHub Actions secret | **no** |
| `BACKUP_S3_BUCKET` | GitHub Actions repository variable | **no** |
| `BACKUP_S3_PREFIX` (default `finpro/postgres`) | repository variable | no |
| `BACKUP_S3_ENDPOINT` (for a non-AWS provider) | repository variable | no |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or an IAM role) | GitHub Actions secrets | **no** |
| `BACKUP_ENABLED=true` | repository variable — the scheduled job is disabled without it | **no** |
| The `aws` CLI on the runner | provided by the runner image | available locally, verified in the workflow |
| A staging `GEMINI_API_KEY` with quota | staging environment | **no** (only a local key exists, and using it for a live smoke test was not authorised) |

### 7.2 Exact operator steps

**A. Encrypted off-site backup (no production write, no resource creation)**

```bash
# 1. Credentials (values come from the secret manager — never typed into a file
#    that is committed, never echoed):
export BACKUP_DATABASE_URL='postgresql://…/staging_database'
export BACKUP_ENCRYPTION_KEY='<base64 32 bytes or 64 hex chars>'

# 2. Create the encrypted archive locally and verify it:
cd node-backend
node scripts/backup-db.js --allow-non-local --encrypt \
  --out-dir ./backups --retention-days 0
#    → prints the archive SHA-256 and writes <archive>.dump.enc + <archive>.dump.enc.json

# 3. Dry-run the publish step first (it validates the manifest and prints the
#    deterministic object key WITHOUT any network call):
node scripts/publish-backup.js --file ./backups/finpro-*.dump.enc

# 4. Publish for real (needs the bucket + AWS credentials; the script verifies
#    the local checksum, never overwrites an existing key, uploads, downloads
#    the object back and compares its SHA-256 before reporting success):
export BACKUP_S3_BUCKET='…' BACKUP_S3_PREFIX='finpro/postgres'
export AWS_REGION='us-east-1' AWS_ACCESS_KEY_ID='…' AWS_SECRET_ACCESS_KEY='…'
node scripts/publish-backup.js --file ./backups/finpro-*.dump.enc --execute
```

**B. Remote download and isolated restore**

```bash
# 1. Download the published object and its manifest:
aws s3 cp "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/<partition>/<archive>" ./restore/
aws s3 cp "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/<partition>/<archive>.json" ./restore/

# 2. Compare the downloaded archive against the manifest (the restore script
#    does this itself and refuses on a mismatch):
sha256sum ./restore/finpro-*.dump.enc

# 3. Restore into a NEW, EMPTY, LOCAL database (restores are local-only and
#    refuse a non-empty target):
createdb finpro_restore_check
export BACKUP_ENCRYPTION_KEY='…'
node scripts/restore-db.js --file ./restore/finpro-*.dump.enc --confirm finpro_restore_check

# 4. Prove the data is there and complete:
psql -d finpro_restore_check -c "select count(*) from transactions;"
psql -d finpro_restore_check -c "select sum(amount) from transactions;"
#    → compare with the source numbers recorded at backup time.

# 5. Clean up the scratch database:
dropdb finpro_restore_check
```

**C. Live AI provider smoke test (staging, read-only intent, test user)**

```bash
# Runs the whole custom suite against the LIVE provider instead of the stub.
# The live check uses a "view user data" intent on the suite's own throwaway
# user: no money moves and no real customer data is involved.
cd node-backend
AI_LIVE_SMOKE=1 npm test
```

Expected: the suite reports the live check as executed instead of
`ℹ️ Live Gemini smoke test skipped`. If the provider is unavailable, the
assistant must degrade to the deterministic engine and still propose (never
execute) a mutation.

### 7.3 What is proven today

- The **local** backup/restore path is proven end-to-end by the recovery drill
  (plaintext, encrypted, wrong key, non-empty target refusal).
- `publish-backup.js` was exercised in **dry-run** mode against a real
  encrypted archive: it validates the manifest and prints the deterministic
  object key without a network call.
- **No off-site object has been uploaded, downloaded or restored, and no live
  provider call has been made.** The repository's own documentation
  (`docs/BACKUP_DR.md`) keeps that distinction explicit.

---

## 8. Flutter CI and runtime limitations (Phase G)

### 8.1 The smallest safe CI change

A single new job in `.github/workflows/ci.yml`:

```yaml
  mobile-tests:
    name: Flutter Client (analyze + widget tests)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2      # pinned: flutter-version '3.38.7'
      - working-directory: mobile
        run: flutter pub get
      - working-directory: mobile
        run: flutter analyze --no-pub
      - working-directory: mobile
        run: flutter test --no-pub
```

Why this shape:

- **Pinned Flutter version** (`3.38.7`, the version the repository is verified
  with; the pubspec requires Dart `^3.10.7`). An unpinned `stable` can change
  the toolchain under you and turn a green build red without a code change.
- **`flutter pub get` first**: `--no-pub` on the test step then proves the
  lockfile is sufficient and avoids a network fetch inside the test step.
- **No database, no secrets, no services**: the mobile suite runs against a
  fake HTTP adapter, so the job is hermetic and cheap.
- **It does not touch the backend job** — the two run in parallel, and
  whether the new job blocks a merge is a branch-protection setting for the
  repository owner.

The two commands were validated locally against the pinned toolchain
(`flutter analyze --no-pub` → no issues; `flutter test --no-pub` → 184 passed).
The job itself has **not** run on GitHub (no commit/push was performed).

### 8.2 Render runtime limitations

**Confirmed by configuration in this repository:**

| Limitation | Evidence |
|---|---|
| Single instance, free plan | `render.yaml`: `plan: free` |
| Liveness probe only | `render.yaml`: `healthCheckPath: /api/v1/health/live`; the strict `/api/v1/health` and `/api/v1/health/ready` probes check the database and storage and are **not** used as the platform probe |
| Container health check uses the strict path | `Dockerfile`: `HEALTHCHECK … /api/v1/health` — different from Render's probe. A storage outage marks the container unhealthy (Docker does not restart on unhealthy by default) |
| In-memory push queue | `src/services/pushQueue.js`: capped at `PUSH_QUEUE_MAX` (200), 3 attempts, **not durable across a restart** |
| In-memory cache and rate-limit fallback | `src/services/cacheService.js`, `rateLimitStore.js`: without `REDIS_URL` the state is per-process, so a second instance would have a separate cache and separate counters |
| In-process market warm worker | `src/services/marketService.js`: a `setInterval` in the web process, disabled by `MARKET_WORKER_ENABLED=false`; it runs **once per instance** |
| No explicit Prisma connection limit | `prisma/schema.prisma` has no `connection_limit`; Prisma's default pool applies, and a `connection_limit` query parameter in `DATABASE_URL` would override it |
| AI request budget | `AI_ASSISTANT_TOTAL_TIMEOUT_MS` default 45 s (clamped 5–120 s); the mobile client uses a 120 s receive timeout for `/ai/chat` |
| Graceful shutdown budget | 10 s HTTP drain + 5 s push-queue drain before `process.exit(0)` |

**Assumptions that were NOT measured here** (flagged, not asserted):

- Render's free plan idles the service out after inactivity and the first
  request pays a **cold start** (platform spin-up + this application's own
  boot). The application boots to healthy in **0.58 s** on this machine
  (measured), so the dominant term is the platform's, not the code's. The
  actual platform cold-start time was **not** measured from here.
- The platform's request timeout and its concurrent-connection ceiling were
  **not** measured or confirmed against a live staging service.
- A direct (non-pooler) PostgreSQL connection plus a long-running interactive
  transaction (the deposit holds one open) can exhaust a small pool. The
  deposit transaction is short, but this has not been load-tested.

**Operational consequences to plan for**

1. A first request after an idle period can take tens of seconds; the mobile
   client's 120 s timeout and the 45 s AI budget are the only client-side
   protection.
2. The push queue and the cache are lost on every restart and are not shared
   between instances — do not treat them as a durable system until
   `REDIS_URL` and a managed queue are provisioned.
3. The market warm worker runs on every instance; with more than one instance
   it multiplies the upstream calls. Set `MARKET_WORKER_ENABLED=false` on
   all but one instance.
4. Any scale-out must add `REDIS_URL` first, otherwise rate limiting and
   caching silently become per-instance.
5. Uploaded files live on an **ephemeral** filesystem on the free plan
   (`STORAGE_PROVIDER=local`): they disappear on every deploy. Use an
   `s3` provider with an external bucket for anything that must survive.

---

## 9. Remaining production blockers (concise)

| # | Blocker | Severity | Owner action |
|---|---|---|---|
| 1 | **The working tree is not committed.** HEAD does not contain the confirmation gate, the migrations, the date-only contract, the transfer destination or the backup tooling. A deploy from HEAD would ship an application that can execute AI mutations without confirmation. | **Critical** | Commit the working tree (204 release files; see §12 and `docs/PHASE6_RELEASE_INVENTORY.md`) and cut the release from that commit. |
| 2 | **The production schema is unverified.** `ai_action_proposals`, its Phase 4 columns, `transactions.idempotencyKey`, `transactions.toAccountId`, `idempotency_records` and its `requestFingerprint` column must exist before the new code serves traffic. | **Critical** | Run `npm run db:reconcile` on production, then verify the tables/columns. |
| 3 | **No off-site backup/restore has been performed.** | **High** | Execute §7.2 A + B once with real credentials. |
| 4 | **No live AI provider smoke test.** | **High** | Execute §7.2 C against staging with a test user. |
| 5 | **No staging deployment has been exercised** — no staging environment exists from here. | **High** | Create/confirm a staging service and work §6.3 + the checklist. |
| 6 | **The Flutter suite was not running in CI** until this phase; the new job has never executed on the remote repository. | Medium | Push the workflow and confirm the first green run; make the job required. |
| 7 | **Render free-tier limits** (§8.2): cold starts, ephemeral files, per-instance state. | Medium | Accept for staging; plan a paid tier, managed Redis, external storage and monitoring before production scale. |
| 8 | **Deposits and transfers now have idempotency**, but generic transaction creation and loan payments do not. | Medium | Track as follow-up; the same `idempotency_records` mechanism applies. |
| 9 | **Observability is minimal** — `/metrics` exists but there is no alerting, and `METRICS_TOKEN` must be set for production exposure. | Medium | Set the token and wire a scraper/alert before production. |
| 10 | **No load test** and no measured RPO/RTO. | Low | Measure before production scale. |

---

## 10. Verdict

**Locally verified; not staging-ready and not production-ready.** The code,
tests, schema and local real-database behaviour are verified. The *deployment*
claims are not, because no staging or production environment was available.

| Claim | Verdict | Evidence |
|---|---|---|
| Is the release artifact reproducible? | **Yes, with one manual step.** The working tree is the artifact; it must be committed first (blocker 1). Every build/test command is scripted (`npm run build`, `npm test`, `npm run test:unit`, `npm run test:cloud`, `npm run test:failure`, `flutter test`, `npm run lint`, `npm run backup:verify`, `npm run db:reconcile`). | §1.1, §3 |
| Do the checks that can run locally pass? | **Yes.** Latest full run (2026-10-24, disposable database): **493 Jest tests / 32 suites**, **166 acceptance + 41 SMS/mobile**, **62/62** transfer-idempotency real-DB checks, **10/10** migrations from empty, build passed, **197 Flutter** tests, `flutter analyze` clean, lint clean, `git diff --check` clean. | §11.2, §12 |
| Is the financial behaviour correct? | **Yes for deposits, transfers and the tested paths.** Deposit and transfer idempotency, conflicting-payload rejection, rollback atomicity, replay-after-commit, replay-after-delete and identical/conflicting concurrency are proven against real PostgreSQL. Residual: generic creation and loan payments still lack keys. | §4, §5.3, §12 |
| Is it staging-ready? | **Not proven.** A staging deployment has not been executed, and there is no staging host, database or credentials from here. Calling it "staging-ready" would be an assertion without evidence. | §5, §6, §9 |
| Is it production-ready? | **No.** Blockers 1–5 are open: the release is not committed, the production schema is unverified, no off-site restore has been performed, no live provider smoke test has run, and no staging deployment has been exercised. | §9 |

"Locally verified" means: on this machine, against a freshly migrated local
database, the release passes its automated suites and its real-database
deposit checks. It does **not** mean a staging deployment has happened.

---

## 11. 2026-10-24 hardening pass

This section supersedes the test counts in §3 and §10 for the current working
tree. The Phase 5 verdict is unchanged: the release is locally verified, but it
is **not staging-ready and not production-ready**, and nothing was deployed,
committed, pushed, merged, reset or cleaned in this pass.

### 11.1 Changes verified in this pass

| Area | Change | Verification |
|---|---|---|
| Transfers | `Transaction.toAccountId` + `toAccount` relation, `FinancialAccount.incomingTransfers`, index, additive migration `20261024120000_transfer_destination` | Fresh-database migration run, Jest transfer suite |
| Ledger | Shared `services/transactionBalance.js` effects/reversal helpers used by controller and AI tools; one aggregated balance write | Jest transfer suite + existing Phase 4 finance/date suite |
| API contract | Transfer source/destination ownership and distinctness, `toAccountId` only on `TRANSFER`, no PATCH conversion to/from `TRANSFER`, bounded `page`/`limit`, validated `type` | Jest transfer suite; `docs/API.md` §4.1 |
| Web | Transfer destination field/column, neutral transfer display, XSS escaping on dashboard and transactions | Static review, `node --check` on the inline script, existing web checks |
| Mobile | Transfer destination dropdown, client-side validation and a per-sheet retry key in the add-transaction sheet | `flutter analyze`, 197 widget tests |
| Export | CSV gains a `To Account` column | Static review + Jest export contract |
| Landing page | Homepage-only ambient water-ripple canvas in `frontend/public/index.html` | Real-browser check described in §11.3 |

### 11.2 Commands actually executed (2026-10-24)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npx prisma validate` | 0 | schema valid |
| 2 | `npm run build` | 0 | Prisma validate/generate, entrypoints and public assets passed |
| 3 | `npm run db:reconcile` on local `finance_jinay` | 0 | P3005 (db was `db push`-managed) → additive `prisma db push`; no `--accept-data-loss`; schema in sync |
| 4 | `npm run test:unit` | 0 | **479 tests / 31 suites passed** earlier in this pass; the Phase 6 disposable-database run later superseded it with **493 tests / 32 suites** (§12) |
| 5 | `npm test` | 0 | `run-all-tests.js` **166/0** · SMS suite **41/0** |
| 6 | `npm run test:cloud` | 0 | **29/0** |
| 7 | `npm run test:failure` | 0 | **17/0** |
| 8 | `npm run lint` | 0 | 108 JavaScript files syntax-clean; 240 Git-tracked files scanned; **0 secrets** |
| 9 | `npx prisma migrate deploy` on an isolated empty database | 0 | **10/10 migrations applied**; `migrate status` reports up to date |
| 10 | `flutter analyze --no-pub` | 0 | no issues found |
| 11 | `flutter test --no-pub` | 0 | **195 tests passed** at this point; **197** after the Phase 6 retry-key tests (§12) |
| 12 | `git diff --check` | 0 | clean |
| 13 | `git status --porcelain` | 0 | 92 modified, 103 untracked, 0 staged, 0 deleted (**195 paths** at this point; **204 release files** after Phase 6); HEAD `f3dd6be` |

The first Jest run failed 5 tests in `api.test.js` because the local development
database predated `transactions.toAccountId`. The errors were explicit
(`The column transactions.toAccountId does not exist`). After the additive
reconciliation in row 3, one full run still reported 3 failures in the same
real-database suite; running `api.test.js` alone then passed 45/45, and two
subsequent full runs passed 479/479. Phase 6 later passed **493/493** twice on
the disposable database (§12). The intermediate failure was not
root-caused, so the local real-database suite should be treated as stateful
until it runs against a disposable database. This is evidence that the schema
step is mandatory, not optional, for any environment that runs this code.

Row 3 changed the **local development database only**. No production database,
staging database, environment variable or remote resource was touched. Existing
row counts before/after the additive push were not independently re-counted in
this pass.

### 11.3 Landing-page ripple: browser verification

Verified against a local static server serving `frontend/public/index.html` in a
real browser (not the deployed Render URL):

- canvas rendered at 1086×880 CSS pixels with a 2172×1760 backing buffer (DPR 2);
- `pointer-events: none`, `z-index: 0`, absolutely positioned behind the hero;
- no horizontal overflow (`scrollWidth === clientWidth`) and no layout contribution (the canvas is out of flow);
- painted pixels changed between frames, so the animation is running;
- a 25-point hit test across the hero never hit the canvas; every hero CTA remained clickable;
- a synthetic `pagehide` cleared the canvas, and page height was unchanged before/after cleanup;
- no console errors.

**Phase 6 reduced-motion result:** the page was re-opened in real headless
Chrome with `--force-prefers-reduced-motion`. `matchMedia('(prefers-reduced-motion: reduce)').matches`
was `true`, the canvas computed style was `display: none` with a zero-size
rectangle, no canvas pixels changed, the hero CTA was still clickable and there
was no horizontal overflow. The reduced-motion path is therefore
browser-verified locally, not merely implemented.

The deployed `https://finpro-finance-ai.onrender.com` page was **not** inspected
because deployment was out of scope. The ripple is referenced only by
`frontend/public/index.html`.

### 11.4 Residual blockers

The §9 blockers remain open. In addition:

- The local `finance_jinay` database needed the additive reconciliation above;
  any deploy target must run `npm run db:reconcile` (or an equivalent
  migration/baseline step) before serving this code.
- Transfers are two-leg and idempotent. Generic transaction creation and loan
  payments still do not accept an idempotency key; §9 blocker 8 therefore
  applies only to those paths.
- The Flutter suite and `flutter analyze` were run locally, not in remote CI.
- No live provider, staging, production, load, or off-host backup verification
  was performed.

---

## 12. Phase 6 evidence (2026-10-24)

This section is the authoritative evidence for the Phase 6 work. It supersedes
the earlier test counts in §3, §10 and §11.2. The verdict is unchanged:
**locally verified, not staging-ready and not production-ready.** Nothing was
committed, pushed, merged, deployed, or run against `finance_jinay` or any
production resource in this phase.

### 12.1 What was added

| Area | Change | Verification |
|---|---|---|
| Transfer idempotency | Optional `idempotencyKey` for `POST /transactions` with `type: "TRANSFER"`, scope `account_transfer`, SHA-256 request fingerprint, replay/conflict handling, per-user advisory lock | Mocked suite + real-PostgreSQL verifier |
| Financial integrity | Key claim, transfer row, source debit and destination credit commit or roll back together; retry after commit returns the original; rollback leaves no claim | Real-PostgreSQL verifier |
| Client retries | Web keeps one key per logical transfer until confirmed success; mobile generates one key per sheet, sends it only for transfers, blocks duplicate submits | `node --check` + 2 new Flutter widget tests |
| Verification | Guarded disposable-database verifier with a runtime `current_database()` check and a forced mid-transaction failure | 62/62 checks, plus three refusal cases |
| Docs | API contract, testing matrix, parity gap and this evidence section | Static review |

No schema migration was needed for transfer idempotency: the existing
`IdempotencyRecord` model already has the composite primary key
`(userId, scope, key)`. The Phase 5 `20261024120000_transfer_destination`
migration remains part of the release.

### 12.2 Disposable database and migration

The transfer verifier is deliberately hard to point at the wrong database. It
refuses to run unless **all** of the following hold:

- `FINPRO_TRANSFER_VERIFY=1`;
- `FINPRO_TEST_DATABASE_URL` is set;
- the URL host is local;
- the database name matches `^finpro_[a-z0-9_]+(?:_test|_verify)$`;
- a runtime query returns the same `current_database()`.

A disposable database named `finpro_p6_transfer_verify` was created on local
PostgreSQL (`127.0.0.1:5432`). `prisma migrate deploy` applied **10/10
migrations** to it. The database was dropped after the final checks. It never
contained real user data, and `finance_jinay` was not used or modified in this
phase.

The guard was proved by attempting three invalid targets: no marker, the
`finance_jinay` database, and a database whose name does not match the test
pattern. Each attempt exited non-zero without running the scenarios.

### 12.3 Commands and results

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `prisma migrate deploy` against `finpro_p6_transfer_verify` | 0 | **10/10 migrations applied** |
| 2 | `FINPRO_TRANSFER_VERIFY=1 FINPRO_TEST_DATABASE_URL=... node scripts/verify-transfer-idempotency.js` | 0 | **62/62 checks passed** |
| 3 | Guard refusal: missing marker | 1 | refused before touching the database |
| 4 | Guard refusal: `finance_jinay` | 1 | refused before touching the database |
| 5 | Guard refusal: non-matching database name | 1 | refused before touching the database |
| 6 | `DATABASE_URL=... NODE_ENV=test npx jest --runInBand` | 0 | **493/493 tests, 32/32 suites** (two clean full runs) |
| 7 | `DATABASE_URL=... NODE_ENV=test npm test` | 0 | acceptance **166/166**, SMS/mobile **41/41** |
| 8 | `npm run lint` | 0 | **109 JavaScript files** syntax-clean; **240 Git-tracked files** scanned; **0 secrets** |
| 9 | `npm run build` | 0 | Prisma schema valid, client regenerated, required fields and entrypoints present |
| 10 | `flutter analyze --no-pub` | 0 | **No issues found** |
| 11 | `flutter test test/add_transaction_sheet_test.dart` | 0 | **2/2** retry-key tests passed |
| 12 | `flutter test` | 0 | **197/197 tests passed** |
| 13 | Inline web-script parse (`node --check` on `transactions.html` script) | 0 | `INLINE_SCRIPTS_OK 1` |
| 14 | `git diff --check` | 0 | clean |

The two full Jest runs were clean. Earlier intermittent real-database failures
were not reproduced and were not root-caused; the disposable-database procedure
is now the supported way to run the suite. The SMS/mobile suite leaves residual
test users in the disposable database; it does not run against `finance_jinay`.

### 12.4 What the real-database verifier proves

Against real PostgreSQL, the verifier exercised:

- a successful keyed transfer (source debit + destination credit, one row);
- a replay of the same key and payload, returning the original transaction and
  applying no second ledger effect;
- replay when the original request omitted the date;
- a conflicting payload with the same key, rejected without writes;
- concurrent identical requests, creating at most one transfer;
- concurrent conflicting requests, creating at most one transfer;
- an invalid destination, the same source/destination, and a foreign
  destination, all rejected without ledger effects;
- a failure before the ledger with no idempotency claim left behind;
- a forced failure on the second balance write, proving atomic rollback;
- a retry after rollback and a retry after commit;
- deletion of the original transaction, then replay: `409` and no recreation;
- per-user key scoping, so one user's key cannot expose another user's
  transaction;
- reconciliation of opening balances (`1000`, `250`, `0`) plus all ledger
  deltas;
- income/expense exclusion from the transfer path.

The mocked `transactionTransferIdempotency.test.js` suite additionally covers
malformed keys, keys supplied to non-transfer requests, invalid dates, and the
transactional category-resolution path.

### 12.5 Client behaviour

**Web (`frontend/public/transactions.html`):** the key is generated on the
first transfer submit and retained after any failure. A network failure
re-enables Save and tells the user that retrying is safe. The key is cleared
only after a confirmed success. It is sent only when `type === "TRANSFER"`; the
inline script parses cleanly.

**Mobile (`mobile/lib/features/transactions/add_transaction_sheet.dart`):** the
key is generated per sheet, used only for `TRANSFER`, and retained across failed
attempts; a new sheet gets a new key. A re-entry guard prevents duplicate
submits. Two widget tests prove failed-transfer key reuse and
non-transfer key omission/new-sheet key presence. `flutter analyze` reports no
issues and the full suite passes **197/197**. No device or emulator was used, so
no device-level claim is made.

### 12.6 Homepage ripple (Phase 6 verification)

The ripple remains exclusive to `frontend/public/index.html`. A repository
search for `rippleCanvas`, `ripple-canvas` and `initWaterRipples` found matches
only in that file; `status.html` loaded in the browser with no canvas or init
code.

On a local static server, in real headless Chrome:

- canvas rendered at **1086×880 CSS** with a **2172×1760 backing buffer** (DPR 2);
- `pointer-events: none` and `z-index: 0`, behind the hero;
- painted pixels changed between frames;
- a **25-point hit test** never hit the canvas; hero CTAs were clickable;
- `scrollWidth === clientWidth` (no horizontal overflow);
- a synthetic `pagehide` cleared the canvas; page height was unchanged.

With `--force-prefers-reduced-motion`, `matchMedia(...).matches` was `true`, the
canvas computed `display: none`, its rectangle was zero-sized, no canvas pixels
changed, the CTA remained clickable and there was no horizontal overflow.

This is **local** browser evidence. The deployed Render page was not inspected.

### 12.7 Not done

- No commit, push, merge, deploy, or production migration.
- No staging environment, live provider call, load test, or off-host
  backup/restore.
- No Android device/emulator run for the Flutter changes.
- No remote CI run of the Flutter job or the new tests.
- No production schema or applied-migration-history verification.

### 12.8 Verdict

The release is **locally verified**, including a disposable-database proof of
transfer idempotency and financial atomicity, two clean full Jest runs, a clean
build/lint, 197 Flutter tests, and local browser verification of the homepage
ripple including reduced motion. It is **not staging-ready** and **not
production-ready**, because the release is uncommitted and no staging or
production environment has been exercised.
