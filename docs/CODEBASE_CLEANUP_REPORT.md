# FinPro — Codebase Cleanup Report

**Scope:** evidence-driven removal of confirmed redundant files, duplicate implementations,
dead code, unnecessary dependencies and temporary artifacts, while preserving behaviour,
security, data integrity, deployment compatibility and test coverage.

**Date:** 2026-10-26
**Repository:** `tanishq version` (cleanup developed on `finpro/pre-deployment-checkpoint`,
integrated into `main`)
**Baseline commit:** `375f8f2c793c82436777561e396db0991125199c`
**Cleanup commit:** `938cbf9` (`chore(cleanup): remove dead code and unused dependencies`)
**Live release at time of audit:** `b9c054c` (deploys after that commit are docs-only)

> The cleanup was committed as `938cbf9` and pushed to `origin/main` as a clean
> fast-forward from `4e9b6d3`. No merge conflict arose and no history was rewritten.
> No manual deploy, blueprint sync, environment-variable change or database migration
> was performed; the only deployment effect is the Render auto-deploy described in §9.

---

## 1. Method

1. **Read-only audit first.** Established a clean baseline (`git status` empty), then
   inventoried tracked files, manifests, lockfiles, ignore rules, CI, Docker and
   hosting configuration.
2. **Evidence before deletion.** Every candidate was cross-checked against:
   - direct `require`/`import` statements,
   - re-exports and barrel files,
   - test suites (35 Jest suites),
   - integration harnesses (`run-all-tests.js`, `test-cloud-*.js`,
     `test-sms-mobile-suite.js`, `scripts/verify-*.js`),
   - dynamic-access patterns (`Object.keys(...)`, computed property access),
   - build scripts, CI workflows and Docker packaging.
3. **Conservative classification.** A symbol was only deleted when it had
   *no* inbound reference outside its own definition and export. Symbols that are
   used internally but merely exported unnecessarily were handled separately
   (export binding removed, implementation kept).
4. **Incremental verification.** After each batch: diff review, Jest, integration
   harnesses, lint, build, broken-reference scan.
5. **No production contact.** No production data, configuration, cloud resource or
   deployed service was modified.

---

## 2. Baseline metrics (before cleanup)

| Metric | Value |
|---|---|
| Tracked files | 433 |
| Backend source (`node-backend/src`) | 39,781 LOC across 111 JS files |
| Backend tests (`node-backend/src/__tests__`) | 10,490 LOC across 35 Jest suites |
| Frontend (`frontend/public`) | 15,972 LOC (23 HTML + 4 JS + 2 CSS) |
| Mobile (`mobile/lib`) | 22,883 LOC across 91 Dart files (29 test files) |
| Documentation (`docs/`) | 8,752 LOC across 25 Markdown files |
| Prisma migrations | 11 |
| Backend runtime dependencies | 22 |
| Backend dev dependencies | 4 |
| Root runtime dependencies | 1 (`firebase`) |
| Flutter dependencies | 14 |
| Working tree size (incl. ignored artifacts) | 5.8 GB |

Working tree at baseline was clean. 32 ignored entries (`.env`, `node_modules/`,
`.artifacts/`, `mobile/build/`, signing material, local uploads) were left untouched.

---

## 3. Findings

### 3.1 Byte-identical duplicates — none safe to delete

A full hash scan of tracked files found no redundant copies:

- Identical hashes resolve to **iOS asset scale variants** (`@1x/@2x/@3x`), which are
  all required at runtime.
- Identical Xcode `xcshareddata`/`xcworkspacedata` files are per-target workspace
  settings, not duplicates.

**Decision:** no file deleted on duplicate grounds.

### 3.2 Backend modules — no fully unreferenced module

Every file under `node-backend/src` has at least one inbound `require`. There is no
orphan controller, route, service, middleware or utility.

Notable "looks dead but is live" cases, retained:

| Path | Why it stays |
|---|---|
| `node-backend/ml_engine/` | `mlCategorizerService.js` reads `model_artifacts.json` and spawns `train_transaction_classifier.py` |
| `node-backend/src/services/pushQueue.js` | Used by FCM retry path; `PushQueue` is test-referenced |
| `node-backend/src/services/realtimeService.js` | SSE stream + polling watermark, mounted in `app.js` |
| `node-backend/src/services/ragService.js` | AI advisor grounding; exports test-referenced |

### 3.3 Backend dead exports — 16 truly dead, 32 internal-only

Classification rule: *truly dead* = the symbol appears exactly twice in its own file
(definition + `module.exports` entry) and nowhere else; *internal-only* = used inside
its own module but exported without any external consumer.

**Truly dead (16)** — definition and export removed:

| File | Symbol |
|---|---|
| `src/config/accountTypes.js` | `ACCOUNT_TYPE_LABELS` |
| `src/middleware/auth.js` | `optionalAuth` |
| `src/middleware/auth.js` | `authorize` |
| `src/services/aiConfirmationService.js` | `recordResult` |
| `src/services/analyticsEngine.js` | `EXCLUDED_TYPES` |
| `src/services/cacheService.js` | `getMetrics` |
| `src/services/fcmService.js` | `sendTransactionAlert` |
| `src/services/fcmService.js` | `sendBudgetAlert` |
| `src/services/fcmService.js` | `verifyIdToken` |
| `src/services/fcmService.js` | `isFirebaseEnabled` (inline export arrow) |
| `src/services/notificationService.js` | `checkUpcomingObligations` |
| `src/services/realtimeService.js` | `closeAll` |
| `src/utils/inr.js` | `formatINRNumber` |
| `src/utils/inr.js` | `addMoney` |
| `src/utils/inr.js` | `subtractMoney` |
| `src/utils/inr.js` | `safeParseFloat` |

Safety notes:

- `optionalAuth` and `authorize` are **not applied to any route**; `authenticate`
  remains and all authorization behaviour is unchanged. Removing unused middleware
  does not weaken auth.
- `closeAll` was never called — `server.js` has no graceful-shutdown hook for it.
  `stopHeartbeat` remains because `removeClient` still uses it.
- `EXCLUDED_TYPES` is superseded by the `SPENDING_TYPES` allow-list; the exclusion
  behaviour is unchanged.
- `checkUpcomingObligations` had no scheduler and no caller (`node-cron` is unused);
  `checkBudgetThresholds` is the live notification path and is retained.
- `sendTransactionAlert` / `sendBudgetAlert` / `verifyIdToken` / `isFirebaseEnabled`
  had no consumers; `sendToDevice` and `sendToMultiple` are the live FCM API and are
  retained.
- `formatINR` stays exported (used across controllers). `safeParseFloat` was
  initially classified as internal-only because `addMoney`/`subtractMoney` called it;
  once those two dead helpers were deleted it had no caller left, so its definition was
  removed too.

**Internal-only (32)** — implementation retained, redundant export binding removed:

`DEFAULT_ACCOUNT_TYPE`, `sanitizeString`, `deepSanitize`,
`handleAddTransaction`, `handleViewUserData`, `handleDeleteTransaction`,
`handleEditTransaction`, `executeTool`, `TOKEN_TTL_MS`, `describeAction`,
`buildProposalMessage`, `pickAccount`, `FORECAST_METHOD`, `UNCATEGORIZED`,
`categoryLabelOf`, `duplicateKeyOf`, `budgetMatchesTransaction`, `sanitizeUser`,
`getEntry`, `sanitizedError`, `NETWORK_CODES`, `IDEMPOTENT_METHODS`,
`fetchDailyCloses`, `fetchSMA`, `fetchEMA`, `fetchRSI`, `fetchMACD`, `fetchBBands`,
`fetchLiveUSDINR`, `getISTTimestamp`, `escapeLabelValue`, `calculateTotalInterest`.

Each was verified to have a real internal call site (AI action dispatch switch,
proposal creation, analytics projections, HTTP retry policy, market indicator
pipeline, Prometheus rendering, loan prepayment math). Only the public surface
shrinks.

> **Count correction:** an earlier draft counted 34 internal-only because `verifyIdToken`
> was counted both as truly dead and as internal-only; it appears only in the truly-dead
> list. The set was later corrected again: `safeParseFloat` moved from internal-only to
> truly dead after its only callers (`addMoney`, `subtractMoney`) were deleted. Final
> split: **16 truly dead + 32 internal-only = 48 symbols**, unchanged from the original
> 48-symbol candidate set.

**Retained because tests reference them (19):** `consumeProposal`, `TOOL_LIST`,
`daysInMonth`, `detectExactDuplicates`, `dedupeExact`, `normalizeThreshold`,
`isRedisAvailable`, `namespaceKey`, `__setClientForTests`, `__resetForTests`,
`parseRetryAfterMs`, `buildPuneMarket`, `validateQuoteMetrics`, `PushQueue`,
`analyzeQueryIntent`, `retrieveFinancialKnowledge`, `buildGroundedRAGContext`,
`monthRangeStrings`, `isSimulatorEnabled`.

### 3.4 Dependencies

**Backend — 5 unused runtime dependencies** (referenced only by `package.json`,
nowhere in source, scripts, Jest config, Prisma config or Docker):

| Package | Evidence | Notes |
|---|---|---|
| `express-validator` | 0 references outside `package.json` | Validation is hand-rolled in controllers |
| `json2csv` | 0 references | CSV export implemented manually |
| `node-cron` | 0 references | No scheduler; obligations job was never wired |
| `socket.io` | 0 references | Realtime uses native SSE (`realtimeService.js`) |
| `zod` | 0 references | Validation is hand-rolled |

**Root — 1 unused dependency:** `firebase` (`^9.14.0`). No npm import anywhere; the
web frontend loads nothing from Firebase, and mobile uses Flutter packages
(`firebase_core`, `firebase_auth`, …) rather than this package.

**Flutter:** `cupertino_icons` is declared but no `CupertinoIcons` usage exists.
Deferred (see §7) — removing it requires a `pubspec.lock` refresh and has no runtime
or security benefit.

**Security benefit:** the three remaining production advisories were
`node-cron` (moderate, via `uuid`) and `zod` (high). Removing both unused packages
eliminates all three.

**Migration surface:** no dependency was removed without checking imports, scripts,
build tooling, tests, dynamic imports and runtime paths.

### 3.5 Frontend

- `frontend/public/assets/js/api.js` exports **42** symbols. **22** are never imported
  or accessed by any page; **6** are imported by name (`formatINR`, `escapeHtml`,
  `requireAuth`, `getUser`, `simulatorAPI`, `trainingAPI`) and **14** are reached
  through the default `api` object in `ai-advisor`, `dashboard`, `investments` and
  `market`.
- **17 of 23 HTML pages do not import `api.js`**. Of those, **13 inline `API_BASE`**
  and **8 define their own `apiFetch`**; each also carries local formatting/escape
  helpers. This is genuine duplication, but consolidating it touches each page's
  auth/error handling — classified **P3 / deferred**. `market.html` is already a module
  that imports `api.js` and still keeps an inline `API_BASE` for its chart calls.
- No image assets exist under `frontend/public` (only CSS, JS and the downloadable
  APK).
- `frontend/public/presentation.html` (49 KB) and `lit_Survey/presentation.html`
  (99 KB) are **distinct documents** (different theme, title and content). Both kept.
- `frontend/public/downloads/finpro-finance-ai.apk` is a 55 MB **intentional
  distribution artifact**, served by the backend and re-included in `.dockerignore`.
  Kept.
- `trainingAPI` and `requireAuth` are correctly exported — no broken imports found.

### 3.6 Mobile / Flutter

- All **91** `lib/` Dart files have at least one inbound reference. No file-level dead
  code.
- 14 packages declared; 12 used directly. `cupertino_icons` unused (deferred);
  `flutter_lints` is a dev-only analyzer dependency (used via `analysis_options.yaml`,
  not by `package:` import) and is retained.

### 3.7 Documentation

25 tracked Markdown files under `docs/` (plus the root `README.md` and `SECURITY`
files). No document was deleted. Classification:

**Authoritative (operational / evaluation set):**
`README.md`, `API.md`, `ARCHITECTURE.md`, `DATABASE.md`, `DEPLOYMENT.md`,
`OPERATIONS.md`, `TESTING.md`, `SECURITY` (root), `BACKUP_DR.md`,
`GOOGLE_PLAY_COMPLIANCE.md`, `MOBILE.md`, `DESIGN_SYSTEM.md`, `PARITY.md`, `AI.md`,
`CLOUD_AUDIT.md`, `FINPRO_EVALUATION_TEST_MATRIX.md`,
`FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md`, `FINPRO_EVALUATION_DEMO.md`,
`PHASE9_INITIAL_AUDIT.md`, `PHASE9_FINAL_REPORT.md`.

**Historical audit trail (retained for traceability):**
`PHASE3_RELEASE_READINESS.md`, `PHASE4_RELEASE_CHECKLIST.md`,
`PHASE4_RELEASE_READINESS.md`, `PHASE5_STAGING_CHECKLIST.md`,
`PHASE5_STAGING_READINESS.md`, `PHASE6_RELEASE_INVENTORY.md`.

`lit_Survey/` is a separate academic artifact set (12 files), excluded from Vercel via
`.vercelignore`, referenced only from that directory. Kept.

This report itself is the only new documentation file (`docs/CODEBASE_CLEANUP_REPORT.md`),
left untracked for review.

### 3.8 Configuration drift — documented, not changed

| Item | Observation | Action |
|---|---|---|
| `render.yaml` | Blueprint declares `runtime: node` and health path `/api/v1/health/live`; live service is Docker with `/api/v1/health` | Documented; restructuring deployment config is out of scope |
| `render.yaml` | `FRONTEND_URL` points at `finpro-finance-ai.vercel.app`; live frontend is `fin-pro-wheat.vercel.app` | Documented; changing env config is a deployment action |
| `.vercelignore` | References `legacy-django-backend/`, which does not exist | Harmless stale entry; no change |
| `.gitignore` | Trailing `.env*` re-ignores `.env.example` even though the file is tracked | No change (tracked file unaffected) |

### 3.9 Temporary artifacts

No tracked temporary artifacts. Ignored local artifacts (`.artifacts/`,
`mobile/build/`, `.vercel/`, local uploads, `.DS_Store`) are outside version control
and were not touched.

---

## 4. Cleanup plan

| Priority | Batch | Content | Risk |
|---|---|---|---|
| **P1-1** | Unused backend dependencies | Remove `express-validator`, `json2csv`, `node-cron`, `socket.io`, `zod` | Low — zero references |
| **P1-2** | Unused root dependency | Remove `firebase` | Low — zero npm imports |
| **P1-3** | Dead backend code | Delete 16 dead functions/constants and their exports | Low — zero inbound references |
| **P2** | Redundant export bindings | Remove 32 export entries, keep implementations | Low — internal call sites untouched |
| **P3** | Frontend API consolidation | Migrate 13 inline-`API_BASE` / 8 inline-`apiFetch` pages to `api.js`; prune 22 unused exports | Medium/high — broad cross-page refactor |
| **DEFER** | Flutter `cupertino_icons`; `.vercelignore` stale entry; `render.yaml` drift; frontend `api.js` surface | No safe, material benefit without broader change | — |

P3 and DEFER were **not implemented**, per the instruction to implement P1 first and
only justified P2 afterwards.

---

## 5. Implementation log

### P1-1 — Unused backend dependencies

Removed from `node-backend/package.json` and `node-backend/package-lock.json`:

```
express-validator
json2csv
node-cron
socket.io
zod
```

Observed effect: `npm uninstall` removed **28 packages** from the install tree; the
backend lockfile went from **632 → 604** package entries and runtime dependencies from
**22 → 17**. `npm audit --omit=dev` went from **3 vulnerabilities to 0** (the three were
transitive to `node-cron` and `zod`).

Verification: dependency reference scan, Jest, integration harnesses, lint, build.

### P1-2 — Unused root dependency

Removed `firebase` from the root `package.json` and `package-lock.json`.

Observed effect: **110 packages** removed from the install tree, root `dependencies`
went **1 → 0**, and the root lockfile collapsed from **111 → 1** package entry. `npm ls
--depth=0` is now empty. `@firebase/util` remains only as a legitimate transitive of
`firebase-admin`.

Verification: all root scripts delegate to `node-backend`; no root-level import existed.

### P1-3 — Dead backend code

Deleted 16 symbols (§3.3) including definitions, doc comments and export entries.
No route, controller, service call site or test referenced them. This includes
`safeParseFloat`, which lost its last caller when `addMoney`/`subtractMoney` were
removed in the same batch.

Verification: residual-reference scan returned zero hits; all `src` modules loaded
successfully; `server.js` started and shut down cleanly on `SIGTERM`.

### P2 — Redundant export bindings

Removed 32 export entries (§3.3) while keeping every implementation and its internal
call sites intact. `module.exports` now reflects only the actually consumed surface.

One correction during execution: `isMarketOpen` was briefly removed from
`marketService.js` exports and immediately restored — `src/__tests__/marketEngine.test.js`
imports it. It is counted in the retained set, not in the removed set.

### Not changed

- No migration, seed, fixture, rollback utility or schema file.
- No test removed or weakened.
- No auth, authorization, tenant isolation, validation, rate-limit, transaction,
  idempotency or AI-confirmation logic.
- No deployment config (`Dockerfile`, `docker-compose.yml`, `render.yaml`,
  `vercel.json`, `.dockerignore`, `.vercelignore`).
- No documentation deleted.
- No production data, environment or cloud resource.

---

## 6. Verification evidence

All database-backed suites were run against the isolated local database
`finpro_phase9_verify` (11/11 migrations applied). No production database, service or
cloud resource was contacted by these runs.

### 6.1 Static and unit gates

| Gate | Command | Result |
|---|---|---|
| Jest unit/integration | `DATABASE_URL=…/finpro_phase9_verify npx jest --runInBand` | **35/35 suites, 572/572 tests passed** |
| Syntax lint | `node scripts/lint.js` | **115/115 files clean** |
| Secret scan | `node scripts/scan-secrets.js` | **367 tracked files, 0 secrets** |
| Production build | `node scripts/build.js` | **PASS** (Prisma client generated, entrypoints and public assets verified) |
| Dependency audit | `npm audit --omit=dev` (backend) | **0 vulnerabilities** (was 3) |
| Module load | require every `src/**/*.js` except `server.js` | **75/75 loaded, 0 failures** |
| Residual references | scan `src` + `scripts` for all 48 removed symbols | **0 hits** |
| Lockfile consistency | `npm ci --dry-run` (backend and root) | **exit 0** for both; no lock/manifest mismatch |
| Docker image build | `docker build -t finpro-cleanup-verify:local .` | **PASS** — image built (`sha256:aa73ea…`, 840,947,593 bytes) |
| Whitespace / binary integrity | `git diff --check`; `git diff --numstat` | **clean**; no binary or artifact entries in the diff |

### 6.2 Integration and acceptance harnesses

| Suite | Command | Result |
|---|---|---|
| Master acceptance | `node run-all-tests.js` | **166/166 passed** |
| SMS & mobile | `node test-sms-mobile-suite.js` | **41/41 passed** |
| Cloud persistence | `node test-cloud-verification.js` | **29/29 passed** |
| Cloud failure modes | `node test-cloud-failure.js` | **17/17 passed** |
| Transfer idempotency | `FINPRO_TRANSFER_VERIFY=1 FINPRO_TEST_DATABASE_URL=… node scripts/verify-transfer-idempotency.js` | **62/62 passed** |
| Deposit idempotency | `PHASE5_VERIFY_DATABASE_URL=… node scripts/verify-deposit-idempotency.js` | **32/32 passed** |
| AI confirmation | `PHASE4_VERIFY_DATABASE_URL=… node scripts/verify-ai-confirmation.js` | **31/31 passed** |

Total executed assertions in this verification pass: **950** (572 + 166 + 41 + 29 + 17 +
62 + 32 + 31), plus the static gates above.

### 6.3 Mobile

| Gate | Command | Result |
|---|---|---|
| Static analysis | `flutter analyze` | **No issues found** |
| Unit/widget tests | `flutter test` | **239/239 passed** |
| Release build | `flutter build apk --release` | **PASS** — `build/app/outputs/flutter-apk/app-release.apk` (58.8 MB) built with the configured release keystore |

### 6.4 Pre-cleanup baseline (for comparison)

The same suites were executed before any edit and produced identical results
(Jest 35/35 572/572; run-all 166/166; SMS 41/41; cloud 29/29; failure 17/17;
transfer 62/62; deposit 32/32; AI 31/31; lint 115/115; secrets 367/0; build PASS;
Flutter analyze clean; Flutter tests 239/239). No test was added, removed, skipped or
had its expectations changed.

---

## 7. Deferred candidates and reasons

| Candidate | Reason deferred |
|---|---|
| Frontend `api.js` — 22 unused exports | They form the module's public client surface and are re-exported through the default object; pruning is cosmetic and risks future-page breakage |
| 13 HTML pages with inline `API_BASE` (8 also define `apiFetch`); 17 pages do not import `api.js` | Consolidation is a cross-page auth/error-handling refactor (P3), not a dead-code removal. Most affected pages are classic (non-module) scripts, so importing `api.js` first requires converting each page to a module and matching its 401/redirect semantics; `market.html` is already a module |
| Flutter `cupertino_icons` | Requires `pubspec.lock` refresh; no runtime, size or security benefit |
| `.vercelignore` `legacy-django-backend/` | Harmless; editing deployment ignore rules has no value |
| `render.yaml` runtime/health-path and `FRONTEND_URL` drift | Deployment configuration change requiring authorization |
| `sendTestPush` missing production guard | Behavioural change, not dead code; already documented as a P2 product risk |
| Insufficient-funds enforcement on the general tracker | Behavioural gap, out of cleanup scope |
| `frontend/public/presentation.html`, `lit_Survey/` | Distinct, intentionally published/archived content |
| 55 MB APK in `frontend/public/downloads` | Intentionally served distribution artifact |

---

## 8. Before / after metrics

| Metric | Before | After | Delta |
|---|---|---|---|
| Tracked files | 433 | 433 | 0 (no file deleted) |
| Backend runtime dependencies | 22 | 17 | −5 |
| Backend dev dependencies | 4 | 4 | 0 |
| Backend lockfile package entries | 632 | 604 | −28 |
| Root dependencies | 1 | 0 | −1 |
| Root lockfile package entries | 111 | 1 | −110 |
| Backend `src` lines (`wc -l`, all JS) | 39,781 | 39,490 | −291 (−0.73%) |
| Backend source files changed | — | 18 | — |
| Dead symbols deleted | — | 16 | — |
| Redundant export bindings removed | — | 32 | — |
| Backend production advisories | 3 | 0 | −3 |
| Jest suites / tests | 35 / 572 | 35 / 572 | unchanged |
| Flutter tests | 239 | 239 | unchanged |
| Cleanup commit (`938cbf9`) | — | 23 files, 479 insertions, 1,855 deletions | net −1,376 lines |

The deletion count is dominated by lockfile churn (1,548 of the 1,855 deleted lines are
the two lockfiles). Actual hand-edited source reduction is **291 lines across 18 files**.

---

## 9. Final state

- **Committed and pushed.** The cleanup is commit
  `938cbf953a02d31f6733b18b704652c4858fb073` on `main`, pushed to
  `origin/main` (`tani1290/Finance_assistant`) as a fast-forward from `4e9b6d3`.
  The push was a normal `git push origin main`; no `--force` or `--force-with-lease`
  was used and no commit was amended or rewritten.
- **Integration was a clean fast-forward.** `origin/main` was verified to be an
  ancestor of the cleanup branch before integration, so no merge commit, conflict
  resolution or rebase was required. The cleanup branch
  `finpro/pre-deployment-checkpoint` was left in place locally and on the remote.
- **Working tree is clean.** The commit contains 23 files (22 modified + the new
  report), 479 insertions and 1,855 deletions. Nothing was left staged or
  uncommitted, and no pre-existing local modification was overwritten.
- Behaviour is preserved per §6: every suite that passed before the cleanup passes
  after it, with no test added, removed, skipped or re-specified. The post-cleanup
  gates additionally include `npm ci --dry-run` (backend and root), a Docker image
  build, and a signed Flutter release APK build.
- Security posture improved: production advisories **3 → 0**; no auth, authorization,
  tenant-isolation, validation, rate-limit, transaction, idempotency or AI-confirmation
  logic was touched.
- No migration, seed, fixture, rollback utility, schema, test, deployment config or
  documentation file was deleted or altered.
- **Deployment:** no manual deploy was triggered. The Render service
  `finpro-finance-ai` (`srv-db5sb1vavr4c739td7d0`) tracks `main` with
  `autoDeploy: yes` / `autoDeployTrigger: commit`, so a push to `main` can start an
  automatic build/deploy. After the push, `render deploys list` still reported
  `dep-dbflt99srm7s73ff9bp0` (commit `b9c054c`) as the newest deploy — no new deploy
  for `938cbf9` or `8757a4f` had been created at the time of checking — and
  `GET /api/v1/health/live` returned HTTP 200. No Render or Vercel CLI deploy,
  blueprint sync, environment-variable edit or database migration was issued from
  this session. If Render later picks up the commit, it will build `8757a4f` (the
  docs-only report update on top of the verified `938cbf9` code).
- **This §9 status is itself recorded in a docs-only follow-up commit** on top of
  `938cbf9`; `git log -1 -- docs/CODEBASE_CLEANUP_REPORT.md` gives its hash. It changes
  documentation only and does not affect the verified code state above.

---

## 10. Remaining risks

1. **P3 duplication remains.** The 13 pages with an inline `API_BASE` (8 of which also
   define `apiFetch`) can drift from `api.js` (for example, different error handling or
   base-URL logic). This is a maintenance risk, not a correctness defect observed in
   testing.
2. **Deployment-config drift remains documented but unfixed** (`render.yaml` runtime
   and health path, stale `FRONTEND_URL`). Changing them requires deployment
   authorization and re-verification.
3. **Export-surface reduction is a public-API change.** Any out-of-repo consumer that
   imported the removed symbols would break. No in-repo consumer existed; the mobile
   app and web frontend speak HTTP, not Node modules.
4. **Backups are not operational off-host** (pre-existing, unrelated to cleanup).
5. **Free-tier constraints** (cold start, Postgres expiry `2026-11-11`) are unchanged.
