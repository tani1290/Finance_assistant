# FinPro Phase 4 — Staging Release Checklist

Owner: release operator · Scope: one staging release of the backend + web client.

> This checklist is **not** executed automatically. Every box is an operator
> action. Steps marked **[BLOCKED]** cannot be completed in the current
> environment and are listed with the exact reason and the required
> authorisation.

---

## 0. Before you start

| # | Step | Command / evidence | Owner | Status |
|---|---|---|---|---|
| 0.1 | Working tree reviewed; nothing reset, cleaned or discarded | `git status --porcelain` (167 → 171 paths, all preserved) | operator | ☐ |
| 0.2 | Phase 4 report read | `docs/PHASE4_RELEASE_READINESS.md` | operator | ☐ |
| 0.3 | Target environment confirmed (staging, never production) | Render dashboard / SSH target | operator | ☐ |
| 0.4 | Rollback owner and window agreed | release plan | operator | ☐ |

---

## 1. Final code review

| # | Step | Command / evidence | Status |
|---|---|---|---|
| 1.1 | Full diff reviewed (no debug code, no secrets, no unrelated changes) | `git diff` + `git status` | ☐ |
| 1.2 | Whitespace/conflict check clean | `git diff --check` → exit 0 | ☐ |
| 1.3 | Syntax lint clean | `npm run lint` → 101 files clean | ☐ |
| 1.4 | Secret scan clean | `npm run lint` → 240 tracked files, 0 secrets | ☐ |
| 1.5 | Prisma schema valid | `npx prisma validate` → valid | ☐ |
| 1.6 | Unit + integration suites green | `npm --prefix node-backend run test:unit` → 385/385 | ☐ |
| 1.7 | Custom suites green | `npm test` → 166/0 and 41/0 | ☐ |
| 1.8 | Cloud suites green | `npm run test:cloud` → 29/0; `npm run test:failure` → 17/0 | ☐ |
| 1.9 | Mobile tests green (Flutter SDK required) | `cd mobile && flutter test` → all passed | ☐ |

---

## 2. Migration validation in staging

| # | Step | Command / evidence | Status |
|---|---|---|---|
| 2.1 | Isolated local rehearsal done | `createdb finpro_phase4_verify` → `prisma migrate deploy` → 6/6 applied | ☐ |
| 2.2 | Staging schema applied **before** the new code | `npm run db:reconcile` | ☐ |
| 2.3 | Table + columns present | `psql -c '\d ai_action_proposals'` → `executionStartedAt`, `attempts`, `lastError`, `retryable` | ☐ |
| 2.4 | Indexes and FK intact | `tokenHash` unique, `(userId,status)`, `expiresAt`, FK → `users` ON DELETE CASCADE | ☐ |
| 2.5 | Existing financial rows untouched | row counts + `sum(amount)` identical before/after | ☐ |
| 2.6 | Prisma client matches the schema | `npm run build` → "exposes every required model field" | ☐ |
| 2.7 | Confirmation gate verified against staging | `node scripts/verify-ai-confirmation.js` with a staging-local URL | ☐ |

**Order matters:** 2.2 must complete before the new backend serves traffic. The
old code is compatible with the new columns; the new code is not compatible
with the old schema.

---

## 3. Backup before deployment

| # | Step | Command / evidence | Status |
|---|---|---|---|
| 3.1 | Encrypted backup created from staging | `npm run backup:db -- --encrypt --out-dir ./backups` | ☐ |
| 3.2 | Archive **and** `.json` manifest present | `ls -l backups/` | ☐ |
| 3.3 | Manifest SHA-256 recorded out of band | `sha256sum backups/finpro-*.dump.enc` | ☐ |
| 3.4 | Restore rehearsed into an empty local database | `node scripts/restore-db.js --file <archive> --confirm <empty_db>` | ☐ |
| 3.5 | Off-site copy exists and is reachable | **[BLOCKED]** no provider credentials / no authorised live test | ☐ |
| 3.6 | Retention window set on the backup host | `BACKUP_RETENTION_DAYS` (0 = keep forever) | ☐ |

---

## 4. Application deployment

| # | Step | Command / evidence | Status |
|---|---|---|---|
| 4.1 | Build succeeded on the platform | Render build log: `npm --prefix node-backend run build` | ☐ |
| 4.2 | Prisma client regenerated during the build | build log shows "Prisma Client generated successfully" | ☐ |
| 4.3 | Schema reconciliation reported success | start log: "DATABASE SCHEMA RECONCILED SUCCESSFULLY" | ☐ |
| 4.4 | Liveness probe passes | `GET /api/v1/health/live` → 200 | ☐ |
| 4.5 | Dependency probe passes | `GET /api/v1/health/dependencies` → 200 | ☐ |
| 4.6 | Strict readiness probe passes | `GET /api/v1/health/ready` → 200 | ☐ |
| 4.7 | Metrics still protected | `GET /metrics` without a token → 404 in production | ☐ |
| 4.8 | No production env var changed by this release | `git diff` shows no `.env` / `render.yaml` env edits | ☐ |

---

## 5. AI confirmation smoke tests (staging)

| # | Step | Expected | Status |
|---|---|---|---|
| 5.1 | `POST /ai/chat` with a mutating request | `pendingConfirmation: true`, `action.executed: false` | ☐ |
| 5.2 | `POST /ai/actions/confirm` (CONFIRM) | 200, `executed: true`, `executionState: "COMPLETED"` | ☐ |
| 5.3 | Replay the same token | 409 `ACTION_ALREADY_COMPLETED` (or `ACTION_IN_PROGRESS`), no second mutation | ☐ |
| 5.4 | Confirm from a second user | 404 `ACTION_NOT_FOUND` | ☐ |
| 5.5 | Confirm an expired token | 410 `ACTION_EXPIRED` | ☐ |
| 5.6 | Cancel a proposal | 200, `executionState: "CANCELLED"`, no mutation | ☐ |
| 5.7 | Five concurrent confirms of one token | exactly one 200, four 409, exactly one ledger row | ☐ |
| 5.8 | Web UI propose → confirm | proposal shown with parameters, one mutation applied | ☐ |
| 5.9 | Web UI propose → cancel | "Cancelled. Nothing was changed.", no mutation | ☐ |
| 5.10 | Mobile AI advisor | read-only answers work; a proposal shows "Not applied" and no "Actions performed" chip | ☐ |

---

## 6. Financial summary verification

| # | Step | Expected | Status |
|---|---|---|---|
| 6.1 | Dashboard income equals the ledger INCOME sum for the month | `incomeBasis: "RECORDED_LEDGER_TRANSACTIONS"` | ☐ |
| 6.2 | AI snapshot income equals the dashboard income | both `incomeThisMonth` == `monthlyIncome` | ☐ |
| 6.3 | Both surfaces report the same period | identical `period.start` / `period.end` / `timezone` | ☐ |
| 6.4 | Transfers are excluded from income and expenses | no `TRANSFER` in either aggregate | ☐ |
| 6.5 | A refund counts as income and never reduces expenses | income +refund, expenses unchanged | ☐ |
| 6.6 | An empty month returns zeroes, not `NaN` | `0` for income/expenses/savings | ☐ |
| 6.7 | Month boundary | the last day of the month is in the window, the first day of the next month is not | ☐ |

---

## 7. Date-handling regression

| # | Step | Expected | Status |
|---|---|---|---|
| 7.1 | Date-only round trip | `2026-10-31` → `2026-10-31`, never an ISO timestamp | ☐ |
| 7.2 | Impossible date | `startDate=2026-02-30` → 400 `VALIDATION_ERROR` | ☐ |
| 7.3 | Leap day | `2024-02-29` accepted; `2026-02-29` rejected | ☐ |
| 7.4 | Timezone | the reporting month follows `Asia/Kolkata`, not the server's UTC day | ☐ |
| 7.5 | Inclusive end date | `endDate` day is included in the result set | ☐ |
| 7.6 | Insurance / subscription counts | inactive rows excluded from coverage, premium and recurring spend | ☐ |

---

## 8. Post-deployment monitoring

| # | Step | Evidence | Status |
|---|---|---|---|
| 8.1 | Error rate | no `ACTION_*` 5xx spikes | ☐ |
| 8.2 | `ai_action_proposals` state distribution | no rows stuck in `EXECUTING` | ☐ |
| 8.3 | Failed proposals | each `FAILED` row has a `lastError` and a human-readable reason | ☐ |
| 8.4 | Ledger integrity | transaction count and `sum(amount)` behave as expected | ☐ |
| 8.5 | Cold start | first request after deploy completes (Render free tier, ~15 s) | ☐ |
| 8.6 | Backup job | the next scheduled off-host backup reports success — **[BLOCKED]** until provider credentials are configured | ☐ |

---

## 9. Rollback

| # | Situation | Action | Safe? |
|---|---|---|---|
| 9.1 | Bad backend build, schema already applied | Redeploy the previous build. The extra columns are ignored by the old code. | ✅ yes |
| 9.2 | Schema not yet applied and the new code is live | The AI mutation path fails closed (500, "column does not exist"); read-only paths keep working. Apply the schema immediately or roll the code back. | ✅ yes (degraded AI only) |
| 9.3 | Data corruption suspected | Restore from the verified backup into a **new** database and repoint. Never restore over the live database — `restore-db.js` refuses a non-empty target by design. | ✅ yes |
| 9.4 | Remove the new columns | Not required and **not** automatic. `ALTER TABLE ... DROP COLUMN` destroys the execution audit trail. | ⚠️ destructive |
| 9.5 | `prisma migrate deploy` "rollback" | There is no down-migration. On this project's db-push-managed production database the schema is reconciled additively, so a code rollback leaves the columns in place. | ✅ yes |

**Changes that cannot be rolled back safely:** none of the Phase 4 code changes
touch user data. The only irreversible operation in the whole release is
`ALTER TABLE ai_action_proposals DROP COLUMN`, which is not part of any
rollback path and must not be run automatically.
