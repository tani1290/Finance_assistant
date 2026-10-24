# FinPro Phase 4 — Staging Validation & Release Readiness

Status: **ready for a controlled staging release**, with two items that require
an operator with production access (§9) and one that cannot be closed from this
environment (§9.2).

Nothing in Phase 4 was deployed. No production infrastructure, environment
variable or database was touched. The only database changed outside a
throwaway database is the **local development database**, which received the
same additive schema change the deploy performs (§2.4).

---

## 1. Initial state

| Item | Finding |
|---|---|
| Branch / HEAD | `finpro/pre-deployment-checkpoint` @ `f3dd6be` — unchanged; nothing committed |
| Working tree | 165 changed/untracked paths at the start, **172 at the end**. Every pre-existing change is preserved; nothing was reset, cleaned, overwritten or committed |
| Phase 3 report | `docs/PHASE3_RELEASE_READINESS.md` — read; its three open risks are addressed below |
| `npm run db:reconcile` | `scripts/deploy-migrate.js`: `prisma migrate deploy` first, then an **additive** `prisma db push` (never `--accept-data-loss`) when the schema is non-empty and unrecorded; the outcome is reported loudly |
| Production | `https://finpro-finance-ai.onrender.com/api/v1`, Render free tier, single instance |

**Baseline defect found before any change.** The claimed baseline
("353 passing Jest tests across 24 suites") did **not** reproduce. `npx jest
--runInBand` exited 1: `src/__tests__/api.test.js` → *"POST /api/v1/ai/chat
should use real financial context and return response"* exceeded the 5 s Jest
timeout, because `src/app.js` loads `.env` and the developer's live
`GEMINI_API_KEY` made a unit test call the real provider.

Fixed with `node-backend/jest.setup.js` (blanks the provider key before any
module import; tests that need a fake key set it themselves). The suite is now
deterministic and offline.

**Phase 3 risks carried into Phase 4, and their disposition**

| Phase 3 risk | Disposition |
|---|---|
| A consumed token is not retryable when the downstream write fails | Replaced with an explicit execution state machine (§3) |
| The controller can return 500 after a successful mutation if the chat-history write fails | Fixed: chat history is best-effort (§3.3) |
| The web client re-enables Confirm after any failure | Fixed: only one explicitly retryable case re-arms the button (§4) |
| Mobile ignores `pendingConfirmation` | Fixed: an explicit "Not applied" notice; proposals are never shown as performed (§5) |

---

## 2. Migration validation

### 2.1 What was inspected

| Object | Finding |
|---|---|
| `AiActionProposal` model | `id`, `userId` (FK → `users`, `ON DELETE CASCADE`), `toolName`, `args` (JSONB), `description`, `tokenHash` (unique), `status`, `expiresAt`, `createdAt`, `resolvedAt`, `resultSummary` + Phase 4 columns |
| `20261021120000_ai_action_proposals` | **Additive.** `CREATE TABLE` + 3 indexes + 1 FK. No `DROP`, no `ALTER` of an existing table, no data statement |
| `20261021130000_ai_action_execution_state` | **Additive.** `ALTER TABLE … ADD COLUMN` × 4 (`executionStartedAt`, `attempts`, `lastError`, `retryable`), all with defaults or nullable |
| Indexes | `tokenHash` unique (one token → one row), `(userId, status)` (owner lookup), `expiresAt` (expiry sweeps) |
| Constraints | `NOT NULL` on the security-relevant columns; `attempts NOT NULL DEFAULT 0`; `retryable NOT NULL DEFAULT false` |
| Ownership / expiry | `userId` FK with cascade delete; `expiresAt NOT NULL`; every read is `where: { tokenHash, userId }` |

### 2.2 Isolated test database — clean install

`createdb finpro_phase4_verify` → `prisma migrate deploy` → **6/6 migrations
applied** on an empty PostgreSQL 14.24 database. Resulting schema verified
with `psql`:

```
id text NOT NULL | userId text NOT NULL | toolName text NOT NULL
args jsonb NOT NULL | description text NOT NULL | tokenHash text NOT NULL
status text NOT NULL DEFAULT 'PENDING' | expiresAt timestamp(3) NOT NULL
createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP | resolvedAt timestamp(3)
resultSummary text | executionStartedAt timestamp(3) | attempts integer NOT NULL DEFAULT 0
lastError text | retryable boolean NOT NULL DEFAULT false

Indexes : ai_action_proposals_pkey (PK) · ai_action_proposals_tokenHash_key (UNIQUE)
          ai_action_proposals_userId_status_idx · ai_action_proposals_expiresAt_idx
FK      : ai_action_proposals_userId_fkey → users(id) ON DELETE CASCADE ON UPDATE CASCADE
```

`_prisma_migrations` recorded all 6 entries. The database was dropped after
verification.

### 2.3 Isolated test database — upgrade over real data

`createdb -T finance_jinay finpro_phase4_upgrade` (a byte copy of the local
development database **with 71 transactions, 85 users, 135 accounts, 20 goals
and 21 budgets**), then the real deploy path:

```
[DB]   -> prisma migrate deploy            → Error: P3005 (schema is not empty)
[DB]   -> schema is non-empty and unrecorded (no _prisma_migrations history)
[DB]   -> Falling back to an additive `prisma db push` (never --accept-data-loss)
[DB]   -> db push OK — missing tables/indexes created ✓
```

This P3005 path is the **production** condition (the production database was
created with `db push` and has no migration history), so the rehearsal
exercised the real deploy behaviour, not an idealised one.

**Financial data integrity after the change**

| Measure | Before | After |
|---|---|---|
| transactions | 71 | 71 |
| users | 85 | 85 |
| financial accounts | 135 | 135 |
| goals / budgets | 20 / 21 | 20 / 21 |
| `sum(transactions.amount)` | 138097.00 | 138097.00 |

Nothing was dropped, rewritten or re-dated.

### 2.4 Runtime behaviour against a real database

`node-backend/scripts/verify-ai-confirmation.js` (new; refuses to run against a
non-local host) — **31/31 checks passed** on the clean database *and* on the
data-carrying upgrade clone:

creation with a hashed token (plaintext never persisted) · owner binding ·
cross-user claim → 404 · expiry → 410 + `EXPIRED` · claim → `EXECUTING` with
`attempts = 1` · replay → 409 · terminal `COMPLETED` · terminal `FAILED` and
not reopenable · **5 concurrent claims → exactly one winner, `attempts = 1`** ·
`CANCELLED` terminal.

The local development database (`finance_jinay`) was reconciled with the same
command the deploy uses (`npm run db:reconcile` → additive `db push`) so the
repository's own suites can run against the new schema. Its data was not
altered by the schema change.

### 2.5 PostgreSQL compatibility

Only standard DDL is used (`CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD
COLUMN`, `ADD CONSTRAINT`) — valid on PostgreSQL 12+ and executed unchanged on
the CI image (`postgres:17-alpine`) and on the local 14.24 server.

### 2.6 Migration procedure and rollback limitations

Documented in `docs/DEPLOYMENT.md` §2.3. Summary:

- **Procedure:** backup → `npm run db:reconcile` (or `prisma migrate deploy` on
  a migration-managed database) → verify `\d ai_action_proposals` → verify the
  build regenerated the Prisma client → smoke-test
  `POST /ai/chat` → `POST /ai/actions/confirm` → replay.
- **Rollback:** there is no down-migration. Because both migrations are
  additive, a **code rollback is always safe**: the old build ignores the extra
  columns, and the columns are harmless to keep. Removing them
  (`DROP COLUMN`) is destructive to the audit trail and is not part of any
  rollback path.
- **Ordering constraint:** new code on an old schema fails closed (500 on the
  AI mutation path). Old code on a new schema is fine. **Schema first.**

---

## 3. Confirmation workflow findings

### 3.1 Defects found

| # | Defect | Impact |
|---|---|---|
| C1 | The token was consumed (`PENDING → CONFIRMED`) **before** the mutation ran, and a downstream failure left it terminal-but-unlabelled | The client could not distinguish "not started" from "already applied"; the API answered `500 ACTION_FAILED` with *"Nothing else was changed"* — a claim it could not make |
| C2 | A failed chat-history write after a successful mutation returned 500 | The mutation was applied but the user was told it failed — the most dangerous class of bug in this flow |
| C3 | The web client re-enabled **Confirm** after *any* error, including 409/500/network failure | One extra click could re-submit a consumed token |
| C4 | `resolveAction` claimed "Nothing else was changed" for a mid-flight write failure | False reassurance about an unknown outcome |
| C5 | The mobile client rendered a proposal as an executed action (`Recorded a transaction` chip) | A change that was never applied was presented as applied |

### 3.2 State model implemented

```
PENDING ──confirm──▶ EXECUTING ──▶ COMPLETED   (mutation applied)
                        │
                        └──────────▶ FAILED      (terminal; outcome may be partial)

PENDING ──cancel───▶ CANCELLED
PENDING ──timeout──▶ EXPIRED
```

- The claim is a **single conditional UPDATE** (`status = 'PENDING' AND expiresAt > now()`), so exactly one concurrent request can win. There is no check-then-update window anywhere in the path.
- A claimed token is **never** returned to `PENDING`. A failed write ends in `FAILED` with `lastError` recorded; the user must prepare a new request.
- The only retryable failure is one that happens **before** the mutation starts (`503 ACTION_START_UNAVAILABLE`, `retryable: true`), where the server states that no change was applied.
- Every response carries `executionState` and `retryable` so a client can render an accurate outcome (`docs/API.md` §7.1).

**Design note (no distributed transaction).** The proposal row and the business
mutation are not wrapped in one database transaction. The tools already own
their own transactional boundaries (e.g. transaction + account balance +
notification), and some steps are not transactional at all. Introducing a
two-phase commit across them would be a broader architectural change with its
own failure modes. The chosen design instead guarantees **at-most-once
execution** and makes the outcome explicit and auditable, which is the property
the release actually needs. This is recorded here as the design decision, not
silently assumed.

### 3.3 Fixes applied

- `aiConfirmationService`: `beginExecution` (atomic claim), `completeProposal`,
  `failProposal`; `resolvedFailure()` maps every terminal state to a precise
  HTTP status and code; `recordResult` can no longer annotate a live proposal.
- `aiController`: chat-history writes are best-effort and never change the
  outcome of a committed decision; the failure envelope reports
  `executionState`/`retryable`; the 500 path no longer claims nothing changed.
- Schema: `executionStartedAt`, `attempts`, `lastError`, `retryable`.

### 3.4 Verification

| Scenario | Result |
|---|---|
| Successful confirmation | 200, `executed: true`, `executionState: COMPLETED`, `attempts: 1` |
| Missing / malformed token | 400 `INVALID_ACTION_TOKEN` |
| Expired token | 410 `ACTION_EXPIRED`, row marked `EXPIRED`, stays rejected on retry |
| Cross-user token | 404 `ACTION_NOT_FOUND`; the owner's row stays `PENDING` |
| Replayed token | 409 `ACTION_ALREADY_COMPLETED` / `ACTION_IN_PROGRESS` |
| Concurrent confirmation | 5 parallel HTTP confirms → **1×200, 4×409**, exactly **1** ledger row |
| Database failure before the write | 503 `ACTION_START_UNAVAILABLE`, `retryable: true`, token still `PENDING`, tool never called, same token succeeds on retry |
| Failure after execution starts | 500 `ACTION_OUTCOME_UNKNOWN`, `executionState: FAILED`, `retryable: false`, no "nothing changed" claim, second attempt → 409 `ACTION_ALREADY_FAILED` |
| Tool rejection | 422 `ACTION_REJECTED`, terminal |
| Chat-history write failure | 200 with `executed: true`; the action is **not** reported as failed |

---

## 4. Web confirmation verification

**The web flow was actually executed in a real browser** (Chromium via the
harness) against the local backend, the local frontend served by the same
Express app, and an **isolated test database** — not a mock, not a claim.

| Step | Observed |
|---|---|
| Propose | The reply shows *"Confirmation required"* with the parameters (`message: add 500 expense for coffee`), an *"Action not applied yet"* banner, the expiry time, and enabled **Confirm** / **Cancel** buttons |
| Cancel | The chat shows *"Cancelled. Nothing was changed."*; both buttons are disabled; DB row `CANCELLED`; **0 transactions created** |
| Confirm | The chat shows the applied result; DB row `COMPLETED`, `attempts: 1`, `resultSummary` written; **exactly 1 transaction** created |
| Replay | `409` `ACTION_ALREADY_COMPLETED`; the tool is not executed twice |
| Expired proposal (expiry set correctly in UTC) | `410 ACTION_EXPIRED`; the UI says *"This confirmation request has expired. Ask again to prepare a new one."*; buttons stay disabled; DB row `EXPIRED`; **no transaction** |
| Network failure (`fetch` patched to reject) | The UI says *"Failed to fetch … The action may still be running — check your records before trying again."*; the buttons **stay disabled**; the DB row stays `PENDING`; no false success is reported |
| Concurrent confirms | 1×200, 4×409 `ACTION_IN_PROGRESS`, one ledger row |

The client no longer re-arms the button except in the single server-declared
retryable case (`retryable: true` **and** `executionState: PENDING`).

---

## 5. Mobile release behavior

**Mobile still cannot approve a proposal, and that is now explicit.**

- Read-only AI is unchanged and still works.
- `pendingConfirmation: true` now produces a visible notice: *"Not applied.
  This change still needs approval — open the FinPro web app to confirm or
  cancel it."*
- Action chips are rendered **only** when the server reports
  `action.executed == true`, so a proposal can no longer appear as
  *"Recorded a transaction"*.
- The server keeps enforcing confirmation for every client, so an unsupported
  mobile mutation request cannot succeed.

**Mobile confirmation is NOT implemented and is not claimed to be.**

Tests: `mobile/test/ai_advisor_screen_test.dart` gained two cases (a pending
confirmation is never presented as applied; a proposal without confirmation
metadata is not shown as performed). Full Flutter suite: **183 tests, all
passed**.

---

## 6. Financial and date regression results

**Live cross-check** (isolated database, rows inserted directly to probe the
boundaries). Dashboard and AI snapshot, same moment:

| Surface | Income | Expenses | Savings | Basis | Period |
|---|---|---|---|---|---|
| `GET /api/v1/dashboard` | 1555 | 2450 | −2450 | `RECORDED_LEDGER_TRANSACTIONS` | 2026-10-01 → 2026-10-31, Asia/Kolkata |
| `GET /api/v1/ai/snapshot` | 1555 | 2450 | −2450 | `RECORDED_LEDGER_TRANSACTIONS` | 2026-10-01 → 2026-10-31, Asia/Kolkata |

Income 1555 = 1111 (income dated **2026-10-31**, the last day — included) + 444
(refund). Excluded: 2222 (income dated **2026-11-01**, the first day of the next
month) and 3333 (a `TRANSFER`, which is neither income nor expense).

Date behaviour on the live API:

| Case | Result |
|---|---|
| `startDate=2026-10-31&endDate=2026-10-31` | 200, the Oct-31 row is returned (inclusive end date) |
| `startDate=2026-11-01&endDate=2026-11-01` | 200, the Nov-1 row is returned (and it is *not* in the October period) |
| `startDate=2026-02-30` | 400 `VALIDATION_ERROR` — never a silently shifted date |
| `startDate=2024-02-29` | 200 — a real leap day is accepted |
| Month window | `monthRange(2024, 2)` ends 2024-02-29; `monthRange(2026, 2)` ends 2026-02-28 |
| Timezone | The same instant resolves to November in `Asia/Kolkata` and October in `UTC` — the reporting month follows the user-facing timezone |
| Empty period | Income/expenses/savings are `0`, never `NaN` |
| Inactive insurance / subscriptions | Excluded from coverage, premium and recurring spend |

**New automated coverage** — `src/__tests__/phase4FinanceDate.test.js` (14
tests) locks the dashboard/AI period agreement, transfer exclusion, refund
handling, duplicate-row behaviour (reporting never deduplicates — import
idempotency is the guard), empty periods, month boundaries, timezone
resolution, date-only round trips, leap days and protection-product counts.

**No business rule was changed.** Authoritative calculations and tenant
isolation are untouched.

---

## 7. Backup readiness

| Check | Result |
|---|---|
| Encryption key parsing | base64 / `base64:` / 64-hex accepted; empty, passphrase, wrong-length and malformed rejected; the key is never echoed in an error |
| Wrong-key rejection | The recovery drill decrypts with the wrong key → **rejected without writing to the target** |
| Tamper detection | A modified ciphertext byte is rejected (AES-256-GCM); a modified header is rejected before decryption; a non-FinPro file is rejected |
| Archive + manifest checksum | The restore path verifies the byte length **and** the SHA-256 against the manifest before touching the target; a truncated or tampered archive is refused (new unit tests in `phase4Backup.test.js`) |
| Overwrite refusal | The backup refuses to replace an existing archive or manifest (now a tested helper, `assertNoExistingOutputs`) |
| Restore restrictions | Local-only (there is no flag for a remote host), reserved databases rejected, `--confirm` must equal the target name exactly, a non-empty target is refused |
| Plaintext temp-file cleanup | The staging file is removed after encryption and on every failure path; the restore plaintext lives in a 0700 temp dir and is removed on exit/SIGINT/SIGTERM |
| Secret masking | URLs, `password=` values and provider errors are masked in every log line |
| Retention | Only `finpro-*.dump(.enc)` files this tool created are eligible for pruning; `0` disables pruning |
| Remote publish cleanup | `publish-backup.js` verifies the local checksum before any network call, never overwrites a remote key, downloads the object back and compares its SHA-256, and removes its temp files |

**Recovery drill** (`node scripts/verify-backup-restore.js`): **PASSED** on
both runs (before and after the Phase 4 refactor) — seeded source database →
backup → restore → the seeded row recovered; restore over a non-empty database
refused; encrypted round trip recovered the row; wrong key rejected.

**Honest limitation:** every result above is **local verification only**. No
off-site upload, download or restore has been performed, because no provider
credentials are available and no live test was authorised. The repository says
so explicitly: `docs/BACKUP_DR.md` and the drill output distinguish "local
verification" from "live provider verification". **No real off-site restore is
claimed.**

---

## 8. Tests executed

| Suite | Command | Result |
|---|---|---|
| Jest | `npx jest --runInBand` | **385 / 385 passed, 26 suites** (was 353 / 24, with one failing suite at the start) |
| Master integration & acceptance | `npm test` → `run-all-tests.js` | **166 passed / 0 failed** |
| SMS & mobile suite | `npm test` → `test-sms-mobile-suite.js` | **41 passed / 0 failed** |
| Cloud data persistence | `npm run test:cloud` | **29 passed / 0 failed** |
| Cloud failure & resiliency | `npm run test:failure` | **17 passed / 0 failed** |
| Flutter | `cd mobile && flutter test` | **183 passed / 0 failed** |
| Syntax lint | `npm run lint` | **101 files clean** |
| Secret scan | `npm run lint` | 240 tracked files, **0 secrets**; `.env` ignored; `.env.example` placeholders only |
| Prisma | `npx prisma validate` | **valid** |
| Prisma build | `npm run build` | **passed** — schema valid, client regenerated, required model fields present |
| Migration (isolated) | `prisma migrate deploy` × 2 databases | **6/6 applied** on a clean DB; additive upgrade over a data clone preserved every row |
| Confirmation state machine (real DB) | `scripts/verify-ai-confirmation.js` | **31 / 31** on both databases |
| Backup & recovery drill | `scripts/verify-backup-restore.js` | **PASSED** (twice) |
| Git hygiene | `git diff --check` | **exit 0** |

**No test was skipped, and no suite is reported as passing without having run.**
The only suites that could **not** be executed are listed in §9.

---

## 9. Remaining release blockers

| # | Blocker | Severity | Required action |
|---|---|---|---|
| 9.1 | The **production** schema has not been verified. If `ai_action_proposals` or the Phase 4 columns are missing in production, the AI mutation path fails closed (500) while read-only AI keeps working | High (pre-deploy) | Apply the schema on production with `npm run db:reconcile` (additive) **before** the new build serves traffic; then run the §5 smoke tests of the checklist |
| 9.2 | **No live off-site backup/restore has been performed.** No provider credentials and no authorisation | High (pre-production, not pre-staging) | Configure `BACKUP_S3_BUCKET` / `AWS_*` secrets, run `.github/workflows/backup.yml` manually once, then download and restore the object into a scratch database and verify the row count |
| 9.3 | **No live AI provider smoke test** (`AI_LIVE_SMOKE=1`) — every local run used the deterministic fallback, so the Gemini tool-calling path was exercised only with a stubbed provider | Medium | Run the live smoke test against staging with a non-financial test user before announcing the release |
| 9.4 | The **Flutter suite is not part of CI** — no Flutter job exists in `ci.yml` | Medium | Run `cd mobile && flutter test` in CI or as a pre-release manual step (the suite passes locally: 183/183) |
| 9.5 | The **stale Prisma client** risk is now caught by `scripts/build.js` (it always regenerates and fails on a missing field), but the staging build log must show the new line to prove it ran | Low | Confirm the staging build log contains *"Prisma Client generated successfully"* and *"exposes every required model field"* |
| 9.6 | ~~The **deposit endpoint** has no server-side idempotency~~ **Resolved in Phase 5** — optional `idempotencyKey`, enforced by the `idempotency_records` primary key. Other money-moving endpoints still lack it | — | See `PHASE5_STAGING_READINESS.md` §5 |
| 9.7 | Render free tier: ephemeral filesystem, no managed Redis, no worker process, no off-host storage, no monitoring | Low (pre-existing) | Accept for staging; plan the paid/managed tier before production scale |

Nothing in §9 blocks **staging**. Items 9.1–9.3 block **production**.

---

## 10. Required manual actions

1. Apply the schema on the staging database and verify the four new columns
   (`DEPLOYMENT.md` §2.3, checklist §2).
2. Take an encrypted backup of staging **before** deploying, and verify the
   archive against its manifest.
3. Deploy the staging build and confirm the build log lines from §9.5.
4. Run the AI confirmation smoke tests (checklist §5) and the financial and
   date checks (checklist §6, §7) against staging.
5. Run the live AI provider smoke test (`AI_LIVE_SMOKE=1`) with a test user.
6. Configure the off-site backup provider and perform one authorised
   upload → download → restore cycle (checklist §3.5).
7. Run `cd mobile && flutter test` as a release gate, or add a Flutter CI job.
8. Review `docs/PHASE4_RELEASE_CHECKLIST.md` end-to-end before the release.

**The full operator checklist is `docs/PHASE4_RELEASE_CHECKLIST.md`. It is not
executed automatically.**

---

## 11. Deployment readiness assessment

| Area | Assessment |
|---|---|
| Confirmation gate | **Ready.** At-most-once execution is proven against a real database, the failure semantics are explicit, and every terminal state is distinguishable by the client |
| Migration | **Ready, additive.** Verified on a clean database and on a data-carrying clone; data-preserving; rollback is a code rollback |
| Web client | **Ready.** The full propose → confirm → cancel journey was executed in a browser, including expiry, replay, network failure and concurrency |
| Mobile | **Ready for a read-only release.** Proposals are explicit and never shown as applied; in-app approval is not implemented and is not claimed |
| Financial & date reporting | **Ready.** Dashboard and AI agree on period, basis and values; the edge cases are covered by new tests and by live probes |
| Backup & recovery | **Ready for local use.** Off-site is unverified and is an explicit production blocker |
| CI & deployment | **Ready.** The suites CI runs are the suites that pass; the build now fails on a stale Prisma client; health paths and metrics protection were reviewed and unchanged |
| Documentation | **Updated.** `API.md` §7.1 (state machine + error table), `AI.md` (state machine, mobile limitation, test inventory), `DEPLOYMENT.md` §2.3 (procedure + rollback), `docs/README.md` index, plus this report and the checklist |

**Verdict:** the codebase is ready for a **controlled staging release** once an
operator applies the additive schema to the staging database and works through
`docs/PHASE4_RELEASE_CHECKLIST.md`. It is **not** ready for production until
§9.1 (production schema), §9.2 (a real off-site backup/restore) and §9.3 (a
live AI provider smoke test) are closed with evidence.

**No claim is made here that has not been executed.** The off-site restore, the
live provider smoke test and the staging deployment itself remain unperformed
and are listed as such.
