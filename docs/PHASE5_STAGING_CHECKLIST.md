# FinPro Phase 5 — Staging Operator Checklist

Companion to `docs/PHASE5_STAGING_READINESS.md`. One staging release, executed
by an operator with access to the staging service. **Nothing here is executed
automatically.** Every box is a human action with an evidence line.

> **Stop and request authorisation before** anything marked 🔒, anything that
> touches a production resource, and before the first write to a database you
> have not confirmed is staging.

---

## 0. Pre-flight — the release artifact

| # | Step | Evidence | ☐ |
|---|---|---|---|
| 0.1 | Confirm the target is **staging**: the Render service name, its URL and its database. Write the database host/name here: `______________________`. If you cannot prove it is staging, **stop**. | operator | ☐ |
| 0.2 | **Commit the working tree** (181 paths: 87 modified, 94 untracked). HEAD `f3dd6be` does **not** contain the AI confirmation gate, the migrations, the date-only contract or the backup tooling — a deploy from HEAD ships an app that can mutate data without confirmation. | `git log --stat -1` | ☐ |
| 0.3 | Exclude `.artifacts/` (7.1 MB of QA screenshots) from the commit, or add it to `.gitignore`. | `git status` | ☐ |
| 0.4 | Confirm the commit contains the four migration folders and `node-backend/src/services/aiConfirmationService.js`. | `git ls-files \| grep -E "20261021120000\|20261021130000\|20261022120000\|20261022130000\|aiConfirmationService"` | ☐ |
| 0.5 | Push the branch the staging service tracks. | operator | ☐ |

---

## 1. Staging environment variables (names only — never paste values into a ticket)

| # | Variable | Required | Value set? | ☐ |
|---|---|---|---|---|
| 1.1 | `DATABASE_URL` | **yes** — staging database, direct or session-pooler | ☐ |  |
| 1.2 | `DIRECT_URL` | only if `DATABASE_URL` is a transaction pooler (port 6543) | ☐ |  |
| 1.3 | `JWT_SECRET`, `JWT_REFRESH_SECRET` | **yes** — no fallback; the app cannot sign tokens without them | ☐ |  |
| 1.4 | `FRONTEND_URL` | **yes** — the staging web origin, or CORS blocks the client | ☐ |  |
| 1.5 | `GEMINI_API_KEY`, `AI_MODEL` | optional (rule-based fallback), needed for the live smoke test | ☐ |  |
| 1.6 | `TRUST_PROXY_HOPS=1` | **yes** on Render (one edge proxy) | ☐ |  |
| 1.7 | `METRICS_TOKEN` | to expose `/metrics`; without it the endpoint is 404 in production | ☐ |  |
| 1.8 | `STORAGE_PROVIDER` | `local` (ephemeral on the free plan) or `s3` | ☐ |  |
| 1.9 | `REDIS_URL` | optional; without it the cache/rate limiter are per-process | ☐ |  |
| 1.10 | `AI_ACTION_TOKEN_TTL_MS`, `AI_ASSISTANT_TOTAL_TIMEOUT_MS` | optional (5 min / 45 s defaults) | ☐ |  |

---

## 2. Database — backup first, then schema

| # | Step | Command / evidence | ☐ |
|---|---|---|---|
| 2.1 | Create an encrypted backup of the staging database **before** the schema change | `cd node-backend && BACKUP_ENCRYPTION_KEY=… node scripts/backup-db.js --encrypt --out-dir ./backups` | ☐ |
| 2.2 | Confirm the archive **and** its `.json` manifest exist and record the SHA-256 out of band | `ls -l backups/` · `sha256sum backups/*.enc` | ☐ |
| 2.3 | Apply the schema with the documented command (it now exists at the repo root) | `npm run db:reconcile` → "DATABASE SCHEMA RECONCILED SUCCESSFULLY" | ☐ |
| 2.4 | Verify the AI confirmation table | `psql -c '\d ai_action_proposals'` → `executionStartedAt`, `attempts`, `lastError`, `retryable` | ☐ |
| 2.5 | Verify the deposit/transfer idempotency and transfer-destination objects | `psql -c '\d idempotency_records'` → PK `(userId, scope, key)` and a nullable `requestFingerprint` column; `psql -c '\d transactions'` → `idempotencyKey`, nullable `toAccountId` and `transactions_toAccountId_idx` | ☐ |
| 2.6 | Verify no row was lost | compare transaction/user counts and `sum(amount)` with the pre-change values | ☐ |
| 2.7 | Rehearse a restore into an empty local database | `node scripts/restore-db.js --file <archive> --confirm <empty_db>` | ☐ |

**Ordering constraint:** the schema must be applied **before** the new build
serves traffic. Old code on a new schema is fine; new code on an old schema
fails closed.

---

## 3. Deploy

| # | Step | Evidence | ☐ |
|---|---|---|---|
| 3.1 | Build succeeds | Render build log: "Prisma Client generated successfully" and "exposes every required model field" | ☐ |
| 3.2 | Schema reconciliation succeeded at start-up | start log: "DATABASE SCHEMA RECONCILED SUCCESSFULLY" | ☐ |
| 3.3 | Liveness probe | `GET /api/v1/health/live` → 200 | ☐ |
| 3.4 | Dependency probe | `GET /api/v1/health/dependencies` → 200 | ☐ |
| 3.5 | Strict readiness probe | `GET /api/v1/health/ready` → 200 | ☐ |
| 3.6 | Metrics protection | `GET /metrics` without a token → 404 (or 401 with a token) | ☐ |
| 3.7 | No production variable was changed by this release | `git diff` shows no `render.yaml` env edits | ☐ |

---

## 4. AI confirmation smoke tests (staging, test user only)

| # | Step | Expected | ☐ |
|---|---|---|---|
| 4.1 | `POST /ai/chat` with a mutating request | `pendingConfirmation: true`, `action.executed: false` | ☐ |
| 4.2 | `POST /ai/actions/confirm` (CONFIRM) | 200, `executed: true`, `executionState: "COMPLETED"` | ☐ |
| 4.3 | Replay the same token | 409 `ACTION_ALREADY_COMPLETED` (or `ACTION_IN_PROGRESS`), no second mutation | ☐ |
| 4.4 | Confirm from a second user | 404 `ACTION_NOT_FOUND` | ☐ |
| 4.5 | Confirm an expired token | 410 `ACTION_EXPIRED` | ☐ |
| 4.6 | Cancel a proposal | 200, `executionState: "CANCELLED"`, no mutation | ☐ |
| 4.7 | Five concurrent confirms of one token | exactly one 200, four 409, **exactly one** ledger row | ☐ |
| 4.8 | `POST /ai/actions/status` on a completed token | `applied: true`, `retryable: false` | ☐ |
| 4.9 | `POST /ai/actions/status` on a pending token | `applied: false`, `retryable: true` | ☐ |
| 4.10 | Web UI propose → confirm | the proposal is shown with its parameters, one mutation applied | ☐ |
| 4.11 | Web UI propose → cancel | "Cancelled. Nothing was changed.", no mutation | ☐ |
| 4.12 | Web UI with the network cut | the client probes the status and reports "already applied" or "not applied — safe to confirm again" | ☐ |
| 4.13 | Mobile AI advisor | read-only answers work; a proposal shows "Not applied" and **no** "Actions performed" chip | ☐ |

---

## 5. Deposit idempotency smoke tests (staging, test user only)

| # | Step | Expected | ☐ |
|---|---|---|---|
| 5.1 | Deposit with an `idempotencyKey` | 200, one credit, one ledger row | ☐ |
| 5.2 | Repeat the same request with the same key | 200, `replayed: true`, **the same `transactionId`**, `originalAmount` equals the first amount, and the message says the deposit was already applied (never "added"); the balance is unchanged | ☐ |
| 5.3 | Five concurrent deposits with the same key | all 200, one credit, one row, one transaction id | ☐ |
| 5.4 | Deposit **without** a key twice | two credits, two rows (unchanged behaviour) | ☐ |
| 5.5 | The balance equals the sum of the ledger | `sum(amount)` == balance | ☐ |
| 5.6 | Mobile deposit, then fail the request and retry | the retry carries the **same** key | ☐ |
| 5.7 | Two concurrent **first** deposits with no `accountId` (new user) | exactly **one** default account is created; both amounts land on it | ☐ |
| 5.8 | Deposit with a key and an invalid date (`2026-02-31`), then retry the same key with a valid date | 400 first; no balance change, no ledger row, no `idempotency_records` row; the retry succeeds once | ☐ |
| 5.9 | Replay a key with a **different** amount (`250` then `9999`) | **409 `IDEMPOTENCY_CONFLICT`**; no extra credit, no new ledger row, balance unchanged; use a new key for a new deposit | ☐ |
| 5.10 | Five concurrent deposits with the same key but different amounts | exactly one 200 and four 409s; one ledger row; only the winner's amount credited | ☐ |

---

## 5A. Transfer idempotency smoke tests (staging, test user only)

Transfers use the same `idempotency_records` table with scope
`account_transfer`. A new keyed transfer returns `201`; a replay returns `200`
with `replayed: true`. The source debit and destination credit must always be a
single ledger event.

| # | Step | Expected | ☐ |
|---|---|---|---|
| 5A.1 | Create a keyed transfer between two owned accounts | 201; one `TRANSFER` row with the destination; source decreases and destination increases by the same amount, once | ☐ |
| 5A.2 | Repeat the identical request with the same key | 200, `replayed: true`, the **same `transactionId`**; no second debit or credit | ☐ |
| 5A.3 | Replay the key with a different amount, destination, category or date | **409 `IDEMPOTENCY_CONFLICT`**; no row, no balance change | ☐ |
| 5A.4 | Five concurrent identical keyed transfers | exactly one transfer row and one debit/credit pair; all responses 200/201, the same transaction id | ☐ |
| 5A.5 | Five concurrent requests with the same key but different destinations | exactly one transfer created; the others 409; only the winner's destination is credited | ☐ |
| 5A.6 | Transfer to the same account, an unknown account, another user's account, or an invalid/missing destination | rejected with a 4xx; no ledger row and no balance change | ☐ |
| 5A.7 | Force a failure before the ledger (invalid date/category), then retry the same key with a valid payload | first request fails with no `idempotency_records` claim; the retry succeeds once | ☐ |
| 5A.8 | Delete the original keyed transfer, then replay the key | 409 `IDEMPOTENCY_CONFLICT`; the transfer is **not** recreated and no balance is credited | ☐ |
| 5A.9 | Web: submit a transfer, cut the network, then retry | the retry carries the **same** key and produces one transfer; the UI explains that retrying is safe | ☐ |
| 5A.10 | Web: start a second, different transfer after a success | a **new** key is generated; the first key is never reused | ☐ |
| 5A.11 | Mobile: fail a transfer and retry; then open a new sheet | the retry uses the same per-sheet key; the new sheet gets a new key; double-tapping Save does not submit twice | ☐ |
| 5A.12 | User B submits the same key string as user A | user B never receives user A's transaction id or data; the key is scoped per authenticated user | ☐ |
| 5A.13 | Reconcile both accounts after the transfer scenarios | balance == opening balance + ledger deltas for each account; no orphaned debit/credit | ☐ |
| 5A.14 | Check income and expense aggregates after transfers | no `TRANSFER` is counted as income or expense | ☐ |

Generic transaction creation and loan payments still have no idempotency key;
do not report those paths as covered by this section.

---

## 6. Financial summary and date handling

| # | Step | Expected | ☐ |
|---|---|---|---|
| 6.1 | Dashboard income == the ledger INCOME sum for the month | `incomeBasis: "RECORDED_LEDGER_TRANSACTIONS"` | ☐ |
| 6.2 | AI snapshot income == dashboard income | identical values and identical `period` | ☐ |
| 6.3 | A transfer is excluded from income and expenses | no `TRANSFER` in either aggregate | ☐ |
| 6.4 | A refund counts as income, never reduces expenses | income +refund | ☐ |
| 6.5 | An empty month returns zeroes | no `NaN` | ☐ |
| 6.6 | Month boundary | the last day is in the window, the first day of the next month is not | ☐ |
| 6.7 | `startDate=2026-02-30` | 400 `VALIDATION_ERROR` | ☐ |
| 6.8 | `2024-02-29` | accepted | ☐ |
| 6.9 | Inactive insurance / subscriptions | excluded from coverage, premium and recurring spend | ☐ |

---

## 7. Off-site backup and the live provider 🔒

> These steps need credentials that are **not** available in the development
> environment. They are written out so the operator can execute them without
> inventing anything. Do not upload data or create resources without
> authorisation.

| # | Step | Command | ☐ |
|---|---|---|---|
| 7.1 | Set the backup secrets | `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY` | ☐ |
| 7.2 | Create + verify the encrypted archive | `node scripts/backup-db.js --allow-non-local --encrypt --out-dir ./backups --retention-days 0` | ☐ |
| 7.3 | Dry-run the publish (no network call) | `node scripts/publish-backup.js --file <archive>` | ☐ |
| 7.4 | Publish for real, with download-back verification | `node scripts/publish-backup.js --file <archive> --execute` (needs `BACKUP_S3_BUCKET`, `AWS_*`) | ☐ |
| 7.5 | Download the object + manifest | `aws s3 cp s3://… ./restore/` | ☐ |
| 7.6 | Restore into a NEW empty local database | `node scripts/restore-db.js --file ./restore/<archive> --confirm finpro_restore_check` | ☐ |
| 7.7 | Prove the data is complete | row counts and `sum(amount)` match the source | ☐ |
| 7.8 | Drop the scratch database | `dropdb finpro_restore_check` | ☐ |
| 7.9 | Live AI provider smoke test | `cd node-backend && AI_LIVE_SMOKE=1 npm test` (read-only intent, throwaway user) | ☐ |
| 7.10 | Record the outcome | paste the real results into `docs/PHASE5_STAGING_READINESS.md` §7 | ☐ |

---

## 8. Post-deploy monitoring

| # | Check | Evidence | ☐ |
|---|---|---|---|
| 8.1 | No `ACTION_*` 5xx spikes | application logs | ☐ |
| 8.2 | No proposal stuck in `EXECUTING` | `select status, count(*) from ai_action_proposals group by status` | ☐ |
| 8.3 | Every `FAILED` proposal has a `lastError` | same query | ☐ |
| 8.4 | Idempotency records match applied deposits | `select count(*) from idempotency_records` | ☐ |
| 8.5 | Ledger integrity | transaction count and `sum(amount)` behave as expected | ☐ |
| 8.6 | Cold start | the first request after an idle period completes within the client timeout | ☐ |
| 8.7 | Uploads survive a restart (only if `STORAGE_PROVIDER=s3`) | upload → restart → download | ☐ |

---

## 9. Rollback

| Situation | Action | Safe? |
|---|---|---|
| Bad build, schema already applied | Redeploy the previous commit. The extra columns/tables are ignored by the old code. | ✅ yes |
| Schema not applied, new code live | The AI mutation path and the deposit idempotency path fail closed; read-only paths keep working. Apply the schema or roll the code back. | ✅ yes (degraded) |
| Data corruption suspected | Restore the verified backup into a **new** database and repoint. Never restore over the live database — `restore-db.js` refuses a non-empty target by design. | ✅ yes |
| Remove the new objects | **Not** part of any rollback. `DROP TABLE idempotency_records` destroys the idempotency audit trail. | ⚠️ destructive |
| `migrate deploy` "rollback" | There is no down-migration. On this project's `db push`-managed database the schema is reconciled additively, so a code rollback leaves the objects in place. | ✅ yes |

**Changes that cannot be rolled back safely:** none of the Phase 5 code
changes touch user data. The only irreversible operation in the release is
dropping the new table/column, which no automated path performs.
