# Phase 6 Release Inventory

**Date:** 2026-10-24
**Repository:** `/Volumes/Projects/Minor/FINpro/tanishq version`
**Branch:** `finpro/pre-deployment-checkpoint`
**HEAD:** `f3dd6be`
**Artifact:** the current working tree, not `HEAD`
**Status:** locally verified; **not committed, not staging-ready, not production-ready**

This is the single inventory for the Phase 6 release candidate. It records the
exact files, exclusions, migrations and generated artifacts, the commands that
were run, the environment-variable names, the staging migration procedure, the
limits of rollback, and the post-deploy smoke tests. It does not authorize a
deployment.

> **Phase 7 additions:** privacy policy, account deletion, SMS disclosure/consent,
> storage fail-closed behaviour and the rebuilt signed artifacts are documented
> separately in [GOOGLE_PLAY_COMPLIANCE.md](GOOGLE_PLAY_COMPLIANCE.md). The file
> counts and test totals below describe the Phase 6 tree and are not updated by
> that later work.

---

## 1. Release identity and counts

| Item | Value |
|---|---|
| Modified tracked files | **92** |
| Untracked files (expanded, excluding `.artifacts/`) | **112** |
| Total release files | **204** |
| `git status --porcelain` entries | 199 (directories collapsed) |
| `git status --porcelain -uall` entries | 230 (including the 26 excluded `.artifacts/` files) |
| Staged files | **0** |
| Deleted files | **0** |
| Local QA files excluded | **26** under `.artifacts/` |

The difference between 199 and 204 is deliberate: plain `git status` collapses
new directories to one entry. The appendix expands every file. The count
includes this inventory document itself.

The release **cannot be reproduced from `HEAD`**. `HEAD` lacks the Phase 3–6
migrations, the confirmation gate, the transfer destination, the retry-key
clients and most of the tests. A deploy from `HEAD` would ship an application
that can execute AI mutations without confirmation and cannot store transfer
destinations. The working tree must be reviewed and committed first; this
inventory does not commit it.

---

## 2. Exclusions

Only `.artifacts/` is excluded from the release:

- 24 device/UI screenshots (`device-*.png`) and 2 UI dumps (`ui-final-ai*.xml`).
- They are local QA evidence. No application file references them.
- They are not test fixtures and are not needed at runtime.

No unrelated source change was identified. All other working-tree changes are
part of Phases 3–6 (AI confirmation, deposits, transfers, backup/DR,
observability, Flutter client, docs and tests) and must ship together because
`HEAD` does not contain their dependencies.

The following are also not part of the artifact because they are not tracked:
`.env` files with real values, `node_modules/`, Prisma's generated client,
Flutter `.dart_tool/`/`build/` outputs, and local server logs. No secret value is
present in the release paths.

---

## 3. Release-critical files by area

This is a map, not a substitute for the exact appendix.

| Area | Files |
|---|---|
| Transfer API | `node-backend/src/controllers/transactionController.js`, `node-backend/src/services/transactionBalance.js`, `node-backend/src/services/aiTools.js` |
| Transfer verification | `node-backend/scripts/verify-transfer-idempotency.js`, `node-backend/src/__tests__/transactionTransfer.test.js`, `node-backend/src/__tests__/transactionTransferIdempotency.test.js` |
| Schema / migrations | `node-backend/prisma/schema.prisma`, `node-backend/prisma/migrations/20261024120000_transfer_destination/migration.sql`, the five earlier untracked migrations |
| Web clients | `frontend/public/transactions.html`, `frontend/public/dashboard.html`, `frontend/public/assets/js/api.js` |
| Mobile client | `mobile/lib/features/transactions/add_transaction_sheet.dart`, `mobile/test/add_transaction_sheet_test.dart`, `mobile/lib/core/models/transaction_model.dart` |
| Homepage ripple | `frontend/public/index.html` only |
| AI safety | `node-backend/src/services/aiConfirmationService.js`, `node-backend/src/controllers/aiController.js`, `node-backend/src/__tests__/aiConfirmation.test.js` |
| Build / test / lint | `node-backend/scripts/build.js`, `node-backend/scripts/lint.js`, `node-backend/run-all-tests.js`, `node-backend/jest.setup.js`, `node-backend/package.json` |
| Deployment configuration | `render.yaml`, `.github/workflows/ci.yml`, `.github/workflows/backup.yml`, `.env.example`, `node-backend/.env.example` |
| Documentation | `docs/API.md`, `docs/TESTING.md`, `docs/PARITY.md`, `docs/PHASE5_STAGING_READINESS.md`, this file |

---

## 4. Migrations and generated files

### 4.1 Migrations

`prisma migrate deploy` applied **10/10** migrations to the disposable database.
Six of them are untracked and therefore absent from `HEAD`:

| Migration | Purpose | Lines |
|---|---|---|
| `20261021120000_ai_action_proposals` | AI proposal persistence | 34 |
| `20261021130000_ai_action_execution_state` | Execution state/attempts | 14 |
| `20261022120000_transaction_idempotency_key` | Transaction key column | 42 |
| `20261022130000_idempotency_request_fingerprint` | Request fingerprint | 18 |
| `20261022140000_account_cash_categories` | Account/cash categories | 10 |
| `20261024120000_transfer_destination` | Nullable `transactions.toAccountId`, FK, index | 33 |

The four already-tracked migrations are `init_finance_jinay`,
`cloud_sync`, `mobile_sms_detection` and `pending_sms_unique_hash`.

`20261024120000_transfer_destination` is purely additive. It does **not**
backfill destinations, because the destination was never stored for legacy
transfers. Existing rows keep `NULL` and remain source-only on reversal.

### 4.2 Generated at build/run time (not release files)

| Artifact | Produced by | Where |
|---|---|---|
| Prisma Client | `npm run build` / `prisma generate` | `node-backend/node_modules/.prisma/client` |
| Flutter dependency state | `flutter pub get` | `mobile/.dart_tool/` |
| Flutter build outputs | `flutter build` | `mobile/build/` |
| Local backups | `npm run backup:db` | `BACKUP_DIR` (default `./backups`) |
| Local browser evidence | manual | `.artifacts/` (excluded) |

The Prisma Client must be regenerated on every deploy. `scripts/build.js`
checks that it exposes the Phase 4 AI fields but does **not** prove the database
has the transfer column; the migration step and the post-deploy schema check do
that.

---

## 5. Build, test and verification commands

Run from the repository root unless stated otherwise.

### 5.1 Install and build

```bash
npm ci
npm --prefix node-backend ci
npm --prefix node-backend run prisma:generate
npm run lint
npm run build
```

`npm run lint` scans JavaScript syntax, tracked files and secret patterns.
`npm run build` validates the Prisma schema, regenerates the client, and checks
the server entrypoints and `frontend/public/index.html`.

### 5.2 Backend tests (require PostgreSQL)

Use a disposable database, never `finance_jinay` or production. The database
name must be clearly a test target.

```bash
export DATABASE_URL='postgresql://postgres@127.0.0.1:5432/finpro_p6_transfer_verify'
export NODE_ENV=test
(cd node-backend && npx prisma migrate deploy)
npm run test:unit
npm test
```

Phase 6 results: **493/493 Jest tests, 32/32 suites** (two clean full runs),
acceptance **166/166**, SMS/mobile **41/41**. The disposable database was
dropped after the final run; no Phase 6 command wrote to `finance_jinay`.

### 5.3 Guarded real-database transfer verifier

```bash
cd node-backend
FINPRO_TRANSFER_VERIFY=1 \
FINPRO_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:5432/finpro_p6_transfer_verify' \
node scripts/verify-transfer-idempotency.js
```

The verifier refuses to run unless the marker is present, the host is local,
the database name matches `^finpro_[a-z0-9_]+(?:_test|_verify)$`, and a runtime
`current_database()` check agrees. Phase 6 result: **62/62 checks passed**.
Three invalid targets (missing marker, `finance_jinay`, non-matching name) were
each refused with exit 1.

### 5.4 Mobile

```bash
cd mobile
flutter pub get
flutter analyze --no-pub
flutter test
```

Phase 6 result: analysis clean, **197/197 tests passed**. No device or emulator
was used.

### 5.5 Web

The frontend is static; there is no build step. Parse the inline script and run
the manual smoke tests in §8.

```bash
node --check /tmp/transactions-inline.js   # after extracting the inline script
```

Phase 6 result: `INLINE_SCRIPTS_OK 1`.

### 5.6 Git hygiene

```bash
git diff --check
git status --porcelain=v1 -uall
git diff --stat
```

Phase 6 result: `git diff --check` clean; no staged or deleted paths.

---

## 6. Environment variable names

Do not commit values. Names only.

### 6.1 Required server variables

| Name | Purpose |
|---|---|
| `NODE_ENV` | `production` on staging/production |
| `PORT` | HTTP port (Render supplies it) |
| `DATABASE_URL` | Pooled/runtime PostgreSQL URL |
| `DIRECT_URL` | Direct PostgreSQL URL for migrations, when the provider requires it |
| `JWT_SECRET` | Access-token signing key, at least 32 characters |
| `JWT_REFRESH_SECRET` | Refresh-token signing key, at least 32 characters |
| `JWT_EXPIRES_IN` | Access-token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | Refresh-token lifetime |
| `FRONTEND_URL` | Allowed browser origin / public app URL |
| `TRUST_PROXY_HOPS` | Proxy depth for correct client IPs |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin credentials (JSON string) |
| `FIREBASE_WEB_API_KEY` | Firebase web client key exposed by the server config |
| `GEMINI_API_KEY` | AI provider key |
| `AI_MODEL` | Gemini model name |
| `FINNHUB_API_KEY` | Market data |
| `ALPHA_VANTAGE_API_KEY` | Market data fallback |
| `MARKETAUX_API_KEY` | News |
| `MARKETAUX_BASE_URL` | News API base URL |

### 6.2 Optional / feature variables

`STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`, `S3_ENDPOINT`, `S3_REGION`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`,
`S3_PUBLIC_URL`, `REDIS_URL`, `CACHE_ENABLED`, `CACHE_KEY_PREFIX`,
`CACHE_DEFAULT_TTL_MS`, `CACHE_MEMORY_MAX_ENTRIES`, `CACHE_MAX_VALUE_BYTES`,
`REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS`,
`REDIS_FAILURE_THRESHOLD`, `REDIS_COOLDOWN_MS`, `METRICS_TOKEN`,
`PUSH_QUEUE_MAX`, `PUSH_CONCURRENCY`, `PUSH_MAX_ATTEMPTS`,
`PUSH_RETRY_BASE_MS`, `PUSH_RETRY_MAX_MS`, `PUSH_ATTEMPT_TIMEOUT_MS`,
`PUSH_DEDUPE_TTL_MS`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`,
`BACKUP_ALLOW_NON_LOCAL`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_S3_BUCKET`,
`BACKUP_S3_PREFIX`, `BACKUP_S3_ENDPOINT`, `BACKUP_AWS_REGION`,
`BACKUP_S3_SSE`.

### 6.3 Mobile build

| Name | Purpose |
|---|---|
| `API_BASE_URL` | Passed as `--dart-define=API_BASE_URL=...`; must point at the staging API, not localhost |

### 6.4 Test-only

`FINPRO_TRANSFER_VERIFY=1`, `FINPRO_TEST_DATABASE_URL`, `DATABASE_URL`,
`NODE_ENV=test`. These must never be set on a production service.

---

## 7. Staging migration procedure

This procedure has **not** been executed against staging. It is the required
sequence for the operator who has a verified staging target.

1. **Identify the target.** Confirm the database host, name and environment.
   Staging must not share a database with production. Record the target.
2. **Snapshot first.** Take a provider snapshot or `pg_dump` and verify it can be
   listed/restored. Do not proceed with an unverified backup.
3. **Install the exact artifact.** Check out the reviewed release commit (once
   created) and run `npm ci` and `npm --prefix node-backend ci`.
4. **Generate the client.** Run `npm --prefix node-backend run prisma:generate`.
5. **Apply migrations.** From `node-backend`, with staging `DATABASE_URL` and
   `DIRECT_URL`:
   ```bash
   npx prisma migrate deploy
   ```
   Do **not** use `prisma migrate dev` or `prisma db push` on staging.
6. **Handle a drifted database deliberately.** If `migrate deploy` reports
   P3005 because the database was previously `db push`-managed, stop and use
   `npm run db:reconcile` only after confirming the target. Never pass
   `--accept-data-loss`. Record what changed.
7. **Verify the schema.** Confirm the presence of:
   - `transactions.toAccountId` and `transactions_toAccountId_idx`;
   - `transactions.idempotencyKey`;
   - `idempotency_records.requestFingerprint` and its composite primary key;
   - `ai_action_proposals` and its Phase 4 columns.
8. **Deploy the application.** Only after the schema verification. Build with
   `npm run build` in the release pipeline.
9. **Run the smoke tests** in §8 before opening traffic.

If any step fails, stop. Do not "fix forward" by dropping columns or rewriting
financial rows.

---

## 8. Rollback limits

The migrations are additive and forward-only. There is no down migration.

| Situation | What is safe | What is not |
|---|---|---|
| Bad application code, schema already migrated | Roll back the application to the previous code. The extra nullable column, index, tables and keys are harmless to older code. | Dropping `toAccountId`, `idempotency_records` or the AI tables to "clean up". |
| Bad migration before traffic | Stop the deploy and restore the pre-migration snapshot. | Editing an already-applied migration file. |
| Transfers created after deploy | Older code will ignore `toAccountId`; reversing those transfers would be source-only and financially wrong. | Treating a code rollback as a data rollback. |
| Duplicate or conflicting transfer reports | Keep the transaction and `idempotency_records` row for diagnosis. | Deleting the transaction to "reset" the key; the key stays claimed and replay returns a conflict. |
| Data corruption | Restore the verified snapshot and reconcile. | Running ad-hoc balance edits without a ledger record. |

A rollback of the code does **not** roll back data. If the release must be
withdrawn after users created transfers, the operator must preserve the data and
accept that the previous UI does not understand destinations.

---

## 9. Post-deploy smoke tests

Use a dedicated staging test user. Do not use real customer data.

### 9.1 Service and auth

1. `GET /api/v1/health` (or the deployed health path) returns success.
2. Register/login the test user; access and refresh tokens work.
3. `GET /api/v1/accounts` returns the user's accounts only.
4. A second test user cannot read the first user's account or transaction.

### 9.2 Financial paths

5. Create an expense; the balance decreases by exactly the amount.
6. Create an income; the balance increases by exactly the amount.
7. Create a transfer with an `idempotencyKey`; the source decreases and the
   destination increases by the same amount, once.
8. Repeat the identical request; HTTP `200`, `replayed: true`, same
   `transactionId`, no second ledger effect.
9. Reuse the key with a different amount; HTTP `409 IDEMPOTENCY_CONFLICT`, no
   write.
10. Deposit with a key, then replay it; same transaction, no double credit.
11. Delete a keyed transfer, then replay the key; HTTP `409`, no recreation.
12. Attempt a transfer to the same account and to another user's account; both
    are rejected, and no balance changes.

### 9.3 AI safety

13. Ask the assistant to create an expense; verify it returns a proposal that
    requires confirmation and does not mutate until confirmed.
14. Confirm once; the mutation happens once. Replay/expire the proposal; it does
    not execute twice.

### 9.4 Web and mobile

15. Load `index.html` on desktop: the ripple animates, does not intercept
    clicks, does not create horizontal overflow, and stops on `pagehide`.
16. Load it with reduced motion enabled: no canvas animation, hero CTA still
    usable, no overflow.
17. Open `status.html`: no ripple code or canvas.
18. On mobile, perform one transfer, force a failure/retry, and confirm the
    retry succeeds without duplicating the transfer. This requires a real
    device/emulator; it has not been done in this phase.

### 9.5 Observability

19. `GET /metrics` behaves as configured (token-protected if `METRICS_TOKEN` is
    set) and records the requests.
20. Check application logs for unhandled errors during the smoke run.

---

## 10. Release verdict

The artifact is **locally verified**:

- 493 Jest tests / 32 suites, twice;
- 166 acceptance + 41 SMS/mobile tests;
- 62/62 guarded real-database transfer checks;
- 10/10 migrations from empty;
- clean build and lint;
- 197 Flutter tests and clean analysis;
- local browser verification of the ripple, pointer pass-through, cleanup and
  reduced motion.

It is **not staging-ready** and **not production-ready**. The release is
uncommitted, no staging deployment exists, the production schema is unverified,
no off-host restore or live-provider smoke test has run, and no device-level
mobile run has been performed.

---

## Appendix A — exact release manifest

The following is `git status --porcelain=v1 -uall` with the 26
`.artifacts/` entries removed, plus this inventory document. `M` means modified
tracked file; `??` means untracked. Paths are relative to the repository root.

```text
 M .env.example
?? .github/workflows/backup.yml
 M .github/workflows/ci.yml
 M .gitignore
 M README.md
?? docs/AI.md
 M docs/API.md
 M docs/ARCHITECTURE.md
?? docs/BACKUP_DR.md
?? docs/CLOUD_AUDIT.md
 M docs/DATABASE.md
 M docs/DEPLOYMENT.md
?? docs/OPERATIONS.md
?? docs/PARITY.md
?? docs/PHASE3_RELEASE_READINESS.md
?? docs/PHASE4_RELEASE_CHECKLIST.md
?? docs/PHASE4_RELEASE_READINESS.md
?? docs/PHASE5_STAGING_CHECKLIST.md
?? docs/PHASE5_STAGING_READINESS.md
?? docs/PHASE6_RELEASE_INVENTORY.md
?? docs/README.md
 M docs/TESTING.md
 M frontend/public/ai-advisor.html
 M frontend/public/assets/js/api.js
 M frontend/public/calendar.html
 M frontend/public/dashboard.html
 M frontend/public/index.html
 M frontend/public/profile.html
 M frontend/public/transactions.html
 M mobile/android/app/build.gradle.kts
 M mobile/android/app/src/debug/AndroidManifest.xml
 M mobile/android/app/src/main/AndroidManifest.xml
?? mobile/android/key.properties.example
 M mobile/ios/Runner.xcodeproj/project.pbxproj
 M mobile/ios/Runner/Info.plist
?? mobile/ios/Runner/Runner.entitlements
 M mobile/lib/app/app.dart
?? mobile/lib/app/auth_route_guard.dart
?? mobile/lib/app/configuration_error_app.dart
 M mobile/lib/app/router.dart
 M mobile/lib/core/api/api_client.dart
 M mobile/lib/core/api/api_endpoints.dart
?? mobile/lib/core/api/api_error.dart
 M mobile/lib/core/auth/auth_notifier.dart
?? mobile/lib/core/auth/secure_store.dart
?? mobile/lib/core/auth/session_events.dart
 M mobile/lib/core/auth/token_storage.dart
?? mobile/lib/core/config/app_environment.dart
?? mobile/lib/core/config/theme_preference.dart
?? mobile/lib/core/firebase/device_identity.dart
?? mobile/lib/core/firebase/fcm_token_manager.dart
 M mobile/lib/core/firebase/firebase_service.dart
 M mobile/lib/core/models/account_model.dart
?? mobile/lib/core/models/analytics_models.dart
 M mobile/lib/core/models/budget_model.dart
?? mobile/lib/core/models/calendar_event_model.dart
 M mobile/lib/core/models/goal_model.dart
?? mobile/lib/core/models/insurance_policy_model.dart
 M mobile/lib/core/models/investment_model.dart
 M mobile/lib/core/models/loan_model.dart
?? mobile/lib/core/models/model_parse.dart
 M mobile/lib/core/models/pending_sms_model.dart
?? mobile/lib/core/models/subscription_model.dart
 M mobile/lib/core/models/transaction_model.dart
 M mobile/lib/core/models/user_model.dart
?? mobile/lib/core/models/user_profile_model.dart
?? mobile/lib/core/utils/app_log.dart
 M mobile/lib/core/utils/date_formatter.dart
 M mobile/lib/features/accounts/accounts_screen.dart
 M mobile/lib/features/ai_advisor/ai_advisor_screen.dart
?? mobile/lib/features/analytics/analytics_screen.dart
 M mobile/lib/features/auth/login_screen.dart
?? mobile/lib/features/budgets/add_budget_sheet.dart
 M mobile/lib/features/budgets/budgets_screen.dart
 M mobile/lib/features/budgets/category_detail_screen.dart
?? mobile/lib/features/calendar/add_calendar_event_sheet.dart
?? mobile/lib/features/calendar/calendar_screen.dart
 M mobile/lib/features/dashboard/dashboard_screen.dart
 M mobile/lib/features/goals/goals_screen.dart
?? mobile/lib/features/insurance/add_policy_sheet.dart
?? mobile/lib/features/insurance/add_subscription_sheet.dart
?? mobile/lib/features/insurance/insurance_screen.dart
?? mobile/lib/features/investments/buy_investment_sheet.dart
 M mobile/lib/features/investments/investments_screen.dart
?? mobile/lib/features/loans/add_loan_sheet.dart
 M mobile/lib/features/loans/loans_screen.dart
 M mobile/lib/features/notifications/notifications_screen.dart
 M mobile/lib/features/onboarding/onboarding_screen.dart
?? mobile/lib/features/profile/profile_screen.dart
 M mobile/lib/features/settings/settings_screen.dart
 M mobile/lib/features/sms_detection/pending_sms_screen.dart
 M mobile/lib/features/splash/splash_screen.dart
 M mobile/lib/features/sync/sync_status_screen.dart
?? mobile/lib/features/transactions/add_transaction_sheet.dart
 M mobile/lib/features/transactions/transaction_detail_screen.dart
 M mobile/lib/features/transactions/transactions_screen.dart
 M mobile/lib/main.dart
?? mobile/lib/shared/widgets/error_state_view.dart
 M mobile/lib/shared/widgets/gradient_button.dart
?? mobile/test/account_cash_categories_test.dart
?? mobile/test/add_transaction_sheet_test.dart
?? mobile/test/ai_advisor_screen_test.dart
?? mobile/test/analytics_profile_deposit_test.dart
?? mobile/test/api_client_session_test.dart
?? mobile/test/api_error_test.dart
?? mobile/test/app_environment_test.dart
?? mobile/test/auth_route_guard_test.dart
?? mobile/test/backend_contract_test.dart
?? mobile/test/calendar_screen_test.dart
?? mobile/test/device_identity_test.dart
?? mobile/test/error_state_view_test.dart
?? mobile/test/fcm_token_manager_test.dart
?? mobile/test/feature_crud_test.dart
?? mobile/test/financial_correctness_test.dart
?? mobile/test/insurance_screen_test.dart
?? mobile/test/model_parse_test.dart
?? mobile/test/theme_preference_test.dart
?? mobile/test/token_storage_test.dart
?? mobile/test/transactions_screen_test.dart
 M node-backend/.env.example
?? node-backend/jest.setup.js
 M node-backend/package-lock.json
 M node-backend/package.json
?? node-backend/prisma/migrations/20261021120000_ai_action_proposals/migration.sql
?? node-backend/prisma/migrations/20261021130000_ai_action_execution_state/migration.sql
?? node-backend/prisma/migrations/20261022120000_transaction_idempotency_key/migration.sql
?? node-backend/prisma/migrations/20261022130000_idempotency_request_fingerprint/migration.sql
?? node-backend/prisma/migrations/20261022140000_account_cash_categories/migration.sql
?? node-backend/prisma/migrations/20261024120000_transfer_destination/migration.sql
 M node-backend/prisma/schema.prisma
 M node-backend/run-all-tests.js
?? node-backend/scripts/backup-db.js
 M node-backend/scripts/build.js
?? node-backend/scripts/lib/backupCrypto.js
?? node-backend/scripts/lib/backupRemote.js
?? node-backend/scripts/lib/dbSafety.js
?? node-backend/scripts/publish-backup.js
?? node-backend/scripts/restore-db.js
?? node-backend/scripts/verify-ai-confirmation.js
?? node-backend/scripts/verify-backup-restore.js
?? node-backend/scripts/verify-deposit-idempotency.js
?? node-backend/scripts/verify-transfer-idempotency.js
?? node-backend/src/__tests__/accountCashCategories.test.js
?? node-backend/src/__tests__/aiConfirmation.test.js
?? node-backend/src/__tests__/backupCrypto.test.js
?? node-backend/src/__tests__/backupRemote.test.js
?? node-backend/src/__tests__/cacheService.test.js
?? node-backend/src/__tests__/dateOnly.test.js
?? node-backend/src/__tests__/dbSafety.test.js
?? node-backend/src/__tests__/depositIdempotency.test.js
?? node-backend/src/__tests__/httpClient.test.js
?? node-backend/src/__tests__/marketMetalsController.test.js
?? node-backend/src/__tests__/marketPuneRetail.test.js
?? node-backend/src/__tests__/metrics.test.js
?? node-backend/src/__tests__/observability.test.js
?? node-backend/src/__tests__/phase3Finance.test.js
?? node-backend/src/__tests__/phase4Backup.test.js
?? node-backend/src/__tests__/phase4FinanceDate.test.js
?? node-backend/src/__tests__/pushQueue.test.js
?? node-backend/src/__tests__/ragSources.test.js
?? node-backend/src/__tests__/rateLimitStore.test.js
?? node-backend/src/__tests__/storageHardening.test.js
?? node-backend/src/__tests__/transactionTransfer.test.js
?? node-backend/src/__tests__/transactionTransferIdempotency.test.js
 M node-backend/src/app.js
?? node-backend/src/config/accountTypes.js
 M node-backend/src/controllers/accountController.js
 M node-backend/src/controllers/aiController.js
 M node-backend/src/controllers/analyticsController.js
 M node-backend/src/controllers/cardController.js
 M node-backend/src/controllers/dashboardController.js
 M node-backend/src/controllers/exportController.js
 M node-backend/src/controllers/goalController.js
 M node-backend/src/controllers/insuranceController.js
 M node-backend/src/controllers/investmentController.js
 M node-backend/src/controllers/loanController.js
 M node-backend/src/controllers/ocrImportController.js
 M node-backend/src/controllers/smsController.js
 M node-backend/src/controllers/storageController.js
 M node-backend/src/controllers/subscriptionController.js
 M node-backend/src/controllers/taskController.js
 M node-backend/src/controllers/transactionController.js
?? node-backend/src/middleware/metricsMiddleware.js
 M node-backend/src/routes/index.js
 M node-backend/src/server.js
 M node-backend/src/services/aiActionService.js
 M node-backend/src/services/aiAssistantService.js
?? node-backend/src/services/aiConfirmationService.js
 M node-backend/src/services/aiService.js
 M node-backend/src/services/aiTools.js
?? node-backend/src/services/cacheService.js
 M node-backend/src/services/fcmService.js
?? node-backend/src/services/httpClient.js
 M node-backend/src/services/marketService.js
?? node-backend/src/services/metrics.js
 M node-backend/src/services/newsService.js
?? node-backend/src/services/pushQueue.js
 M node-backend/src/services/ragService.js
?? node-backend/src/services/rateLimitStore.js
?? node-backend/src/services/transactionBalance.js
?? node-backend/src/utils/dateOnly.js
 M package-lock.json
 M package.json
 M render.yaml
```
