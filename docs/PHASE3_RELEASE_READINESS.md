# Phase 3 — Release Readiness Report

> Scope: finance correctness, calendar dates, AI confirmation, RAG sourcing, and
> release evidence. This is a local checkpoint, not a production release.
>
> Date: 2026-10-21
> Branch: `finpro/pre-deployment-checkpoint`
> HEAD: `f3dd6be6159d04c533bb2f9627106a2b6ebd5ae2`
> Working tree: Phase 2 + Phase 3 changes remain **uncommitted**.
> No commit, push, merge, deploy, production migration or paid provisioning was
> performed in this pass.

---

## 1. Initial state

Phase 3 started from the uncommitted Phase 2 reliability checkpoint on the
branch/HEAD above. At that point the app already had the optional Redis cache,
upstream HTTP resilience, metrics, split health checks, upload hardening, the
in-memory push queue, backup/restore scripts and the expanded Jest suite.

Baseline verification at the Phase 2 checkpoint:

- Jest: **296 tests / 20 suites**, all passing.
- Custom suites: **162 / 41 / 29 / 17**, all passing.
- Lint and repository secret scan: passing.
- Backup recovery drill: passing for plaintext and encrypted archives.

The known Phase 3 defects were:

1. The dashboard derived "monthly income" from the onboarding salary estimate
   while the AI advisor used recorded ledger transactions, so two screens could
   report different income for the same month.
2. PostgreSQL `date` columns were parsed/serialised as instants, and month
   windows used the server timezone. Users west of UTC could see a transaction
   on the previous day, and month boundaries could disagree across screens.
3. Mutating AI tool calls and deterministic mutating intents executed
   immediately. The model (or a prompt injection) could write without a
   second, user-bound approval.
4. Insurance and subscription summaries included inactive records in headline
   totals, overstating coverage and recurring spend.
5. RAG replies could include model-authored `**Sources:**` entries, including
   when nothing was retrieved, making the citations unverifiable.
6. While fixing date output, `formatDateOnly` returned only the year for plain
   `YYYY-MM-DD` input because the regex capture group was read with the wrong
   index. This was caught by the new date regression suite.

---

## 2. Root causes and fixes

| Defect | Root cause | Fix |
|---|---|---|
| Dashboard vs AI income divergence | Dashboard used `FinancialProfile.monthlySalary`; AI used `Transaction` rows. The profile value is an onboarding estimate, not recorded inflow. | Dashboard now aggregates `INCOME` ledger transactions for the current local calendar month. The response states `incomeBasis: "RECORDED_LEDGER_TRANSACTIONS"` and exposes the `period` window. The salary estimate is no longer reported as actual income. |
| Date-only shifts | `new Date(value)` and `toISOString()` treat a calendar date as an instant; month windows used server-local time. | New `utils/dateOnly.js` parses `YYYY-MM-DD` to UTC midnight for `@db.Date`, serialises back to `YYYY-MM-DD`, rejects impossible dates with `400`, and computes month windows in Asia/Kolkata. Applied across transactions, accounts, cards, loans, goals, tasks, insurance, subscriptions, calendar events, OCR, exports, AI tools and RAG. |
| AI confirmation bypass | The assistant executed mutating tools as soon as the model emitted them; the deterministic intent engine also wrote directly. | Added a server-side propose/confirm gate: hashed, user-bound, single-use tokens stored in `AiActionProposal`; a five-minute default TTL; atomic consume; replay `409`; expiry `410`; cross-user `404`; one mutation proposed per turn; deterministic mutating intents wrapped as `legacy:<ACTION>` proposals. New `POST /ai/actions/confirm` endpoint. Read-only tools are limited to `get_`, `list_`, `analyse_`, `analyze_`; everything else fails closed. |
| Insurance/subscription totals | Summary arithmetic summed all rows, including `isActive: false`. | Headline totals now use active records only. Total, active and inactive counts are returned, and inactive rows remain listed. |
| Unverifiable RAG sources | Model output was allowed to carry its own source list; an empty retrieval could still print a heading. | The server strips model-generated source sections, appends only the canonical retrieved-source set, and omits `**Sources:**` when the set is empty. |
| Month/date output bug | `formatDateOnly` read the wrong regex capture group, returning the year. | Corrected and covered by `dateOnly.test.js` / `phase3Finance.test.js`. |

Additional AI runtime hardening in this pass:

- Total wall-clock budget of 45 s by default (`AI_ASSISTANT_TOTAL_TIMEOUT_MS`,
  clamped 5–120 s), shared by model retries and tool rounds.
- Only one mutating proposal per assistant turn, avoiding ambiguous approvals.
- Proposal tokens are 32 random bytes, stored only as SHA-256 hashes.
- Proposal creation and consumption are scoped by `userId`; the API never
  reveals whether another user's token exists.
- Expiry defaults to five minutes, clamped 30 s–15 min via
  `AI_ACTION_TOKEN_TTL_MS`.

---

## 3. Files changed in Phase 3

### Backend — date and finance correctness

- `node-backend/src/utils/dateOnly.js` (new)
- `node-backend/src/controllers/dashboardController.js`
- `node-backend/src/controllers/analyticsController.js`
- `node-backend/src/controllers/transactionController.js`
- `node-backend/src/controllers/accountController.js`
- `node-backend/src/controllers/cardController.js`
- `node-backend/src/controllers/loanController.js`
- `node-backend/src/controllers/goalController.js`
- `node-backend/src/controllers/taskController.js`
- `node-backend/src/controllers/insuranceController.js`
- `node-backend/src/controllers/subscriptionController.js`
- `node-backend/src/controllers/ocrImportController.js`
- `node-backend/src/controllers/exportController.js`

### Backend — AI confirmation and retrieval

- `node-backend/src/services/aiConfirmationService.js` (new)
- `node-backend/src/services/aiAssistantService.js`
- `node-backend/src/services/aiActionService.js`
- `node-backend/src/services/aiService.js`
- `node-backend/src/services/ragService.js`
- `node-backend/src/controllers/aiController.js`
- `node-backend/src/routes/index.js`
- `node-backend/prisma/schema.prisma`
- `node-backend/prisma/migrations/20261021120000_ai_action_proposals/migration.sql` (new)

### Web

- `frontend/public/ai-advisor.html` — Confirm/Cancel prompt backed by the
  server-issued token.
- `frontend/public/assets/js/api.js` — `aiAPI.confirmAction`.
- `frontend/public/calendar.html` — date-only strings parsed as local calendar
  days, not UTC instants.

### Regression tests

- `node-backend/src/__tests__/dateOnly.test.js` (new)
- `node-backend/src/__tests__/phase3Finance.test.js` (new)
- `node-backend/src/__tests__/aiConfirmation.test.js` (new)
- `node-backend/src/__tests__/ragSources.test.js` (new)
- `node-backend/run-all-tests.js` — AI scenarios now assert propose → confirm →
  exactly-once persistence, plus replay rejection.

### Documentation and configuration examples

- `README.md`, `.env.example`, `node-backend/.env.example`
- `docs/AI.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/PARITY.md`
- `docs/TESTING.md`, `docs/DATABASE.md`, `docs/DEPLOYMENT.md`,
  `docs/CLOUD_AUDIT.md`

No unrelated feature was deliberately restyled; Phase 2 files already in the
working tree were not reset or overwritten.

---

## 4. Verification

All commands were run from `node-backend/` unless stated otherwise.

| Check | Command | Result |
|---|---|---|
| Jest unit/security/failure | `npx jest --runInBand` | **353 passed / 353**, 24 suites, 0 failed |
| Core + AI + SMS custom suite | `npm test` | **166 + 41 passed**, 0 failed |
| Cloud persistence | `node test-cloud-verification.js` | **29 passed**, 0 failed |
| Cloud failure/resiliency | `node test-cloud-failure.js` | **17 passed**, 0 failed |
| Lint + secret scan | `npm run lint` | **99 JS files clean**; 240 tracked files, **0 secrets** |
| Prisma schema | `npx prisma validate` | Valid |
| Backup recovery drill | `node scripts/verify-backup-restore.js` | **PASSED** — plaintext, encrypted, non-empty target refusal, wrong-key rejection |
| Whitespace/conflict check | `git diff --check` | Exit 0 |

The new suites cover synthetic income/expense transactions, month and leap-year
boundaries, impossible-date rejection, empty datasets, active/inactive insurance
and subscription totals, tenant isolation, confirmation token
expiry/replay/cancel/cross-user use, the one-proposal-per-turn rule, and RAG
source omission/canonicalisation. Existing analytics and ingestion suites already
cover refunds, internal transfers and duplicate grouping; the confirmation replay
test additionally proves that a replayed token cannot write a duplicate expense.

### Not verified

- No live AI provider run (`AI_LIVE_SMOKE=1` was not executed).
- No browser end-to-end test of the Confirm/Cancel UI; the web has no automated
  test harness.
- No mobile device or Flutter test run for this change.
- No staging deployment, load test or provider integration test.
- No live S3-compatible backup upload/download and no GitHub Actions backup run.
- No production database was inspected or migrated in this pass.

---

## 5. Compatibility implications

- **Schema:** `AiActionProposal` is additive. It creates one table, indexes and a
  cascading FK. There is no destructive change.
- **API:** `POST /ai/actions/confirm` is additive. `POST /ai/chat` can now return
  `pendingConfirmation` and a `confirmation` object. Existing fields remain.
- **Behaviour change (intentional):** a mutating AI action no longer executes on
  the model turn. Clients that used to reply "yes" in chat must call the confirm
  endpoint. This is a security fix, not a regression.
- **Dashboard:** adds `incomeBasis` and `period`. `monthlyIncome` now means
  recorded ledger income, not the onboarding salary estimate.
- **Dates:** affected date-only fields now serialise as `YYYY-MM-DD` instead of an
  ISO instant. Clients should send `YYYY-MM-DD`. A legacy client that sends a
  full UTC timestamp can still land on the previous/next local day; this is
  documented in `docs/API.md` §7.1.
- **Inactive records:** insurance/subscription totals exclude them while the rows
  remain listed, so consumers must read the new active/inactive counts rather
  than treating `total*` as the spendable total.

---

## 6. Remaining risks

1. **Production schema is not deployed.** The AI mutation path is fail-closed if
   `ai_action_proposals` is missing; proposals will error rather than write.
   Apply the schema before or atomically with the backend.
2. **Mobile cannot approve AI mutations.** The Flutter advisor does not render
   `pendingConfirmation`. A mobile user can prepare a change but cannot confirm
   it in-app. The action is not applied, so this fails closed, but the feature is
   incomplete on mobile.
3. **No live AI provider evidence.** Deterministic fallback and mocked provider
   paths are tested; a real Gemini call, provider 429/timeout behaviour and
   tool-calling quality were not exercised.
4. **Proposal rows accumulate.** There is no retention/cleanup job for expired or
   resolved `ai_action_proposals`. This is bounded by usage but should be added
   before high volume.
5. **Consumed-token failure semantics.** A token is consumed before the action
   executes. If the downstream write fails, the user must ask again; this is
   deliberate fail-closed behaviour, not automatic retry.
6. **Deposit idempotency remains absent.** A retried deposit can duplicate without
   a server-side idempotency key; fixing it requires a schema/contract change.
7. **Backup durability is not operational.** The backup drill is local. Render's
   free filesystem is ephemeral. Off-site upload, download-back verification and
   an isolated restore have not been demonstrated against real storage.
8. **No staging or load test.** Cold-start latency, multi-instance behaviour,
   Redis outage at scale, and the 45 s AI budget under real traffic remain
   unmeasured.
9. **Legacy ISO date clients** can still shift a calendar day, as noted above.

---

## 7. External setup required before deployment

- Apply the Prisma schema with the repository's deploy path
  (`npm run db:reconcile`) and verify `ai_action_proposals` exists.
- Keep `AI_ACTION_TOKEN_TTL_MS` and `AI_ASSISTANT_TOTAL_TIMEOUT_MS` at safe
  defaults unless there is a measured reason to change them.
- Configure the AI provider key if live assistant behaviour is required; the
  deterministic fallback works without it.
- Provision Redis only if multi-instance cache/rate limiting is actually needed;
  single-instance operation degrades to in-memory state.
- For off-host backups, configure an S3-compatible bucket, encryption key and
  `BACKUP_ALLOW_NON_LOCAL`; then run a real upload → download → restore drill.
- Set `METRICS_TOKEN` before exposing `/metrics` in production; it returns 404
  when unset.
- Keep the Render health check on `/api/v1/health/live`; readiness remains strict
  on DB + storage.

---

## 8. Deployment readiness

**Local code: ready for review. Production: not ready to release yet.**

The implementation and local regression suite are complete. The release is
blocked on four operational items:

1. Apply and verify the `AiActionProposal` schema in the target database.
2. Run a non-financial smoke test through propose → confirm on the deployed
   backend, and a browser check of the Confirm/Cancel UI.
3. Decide whether mobile support is required for this release; if yes, implement
   the pending-confirmation UI before shipping.
4. Treat backup/DR as unresolved until an off-site archive is uploaded,
   downloaded back, checksum-verified and restored into an isolated database.

No claim is made that the production backend, live AI provider, Redis, S3 backup
path, or mobile confirmation flow has been exercised successfully.

---

## 9. Next steps

1. Apply the schema in a staging database and run the Phase 3 suites there.
2. Add a browser E2E test for `pendingConfirmation` → Confirm/Cancel → replay
   rejection.
3. Implement the Flutter confirmation prompt, or explicitly ship web-only AI
   mutations.
4. Add a retention job for resolved/expired AI proposals.
5. Add server-side idempotency for deposits.
6. Provision off-site backup storage and complete a download-back restore drill.
7. Run a live AI smoke test with a dedicated test user and record the result.
8. Deploy to staging, measure cold start and the 45 s assistant budget, then
   decide on production rollout.
