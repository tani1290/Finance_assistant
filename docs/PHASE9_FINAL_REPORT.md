# FinPro — Phase 9 Final Report

**Date:** 2026-10-26
**Branch:** `finpro/pre-deployment-checkpoint`
**Audited baseline:** `f6cdf9f4c3e2eb65c1012eb9c7e883d9fa686ebc`
**Target evaluation date:** on or before **2026-11-05**
**Report scope:** evaluation readiness, not a production certification

---

## 1. Executive summary

Phase 9 asked one question: *can this system be demonstrated and defended on
2026-11-05 without a surprise?*

The answer is **yes for the web and API surfaces**, **partially for the Android
client**, and **no for a small set of environmental items that cannot be closed
from this machine**.

Two real defects were found and fixed:

1. **P0 — health probes shared the general API rate limiter**, which caused a
   self-reinforcing `429 → unhealthy → restart → 502` loop with no user traffic.
   Fixed, deployed, and verified in production.
2. **P1 — a critical `proxy-addr` IP-spoofing advisory** (plus eight other
   production advisories) in the lockfile. Fixed with a semver-only
   `npm audit fix`; no `package.json` change.

Everything else that remains open is **blocked on an owner decision, a
credential, hardware, or an external console** — not on missing code.

| Verdict | Count |
|---|---|
| Verified (executed, observed) | 18 areas |
| Implemented but unverified in production | 4 areas |
| Failed | 0 product failures (1 harness assertion error, corrected) |
| Blocked (external dependency) | 6 items |
| Owner action required | 5 items |
| Not tested (no evidence) | 9 items |

---

## 2. Final status by requirement area

Status vocabulary: **PASS**, **FAIL**, **BLOCKED**, **PARTIAL**, **NOT TESTED**.
Every status carries the level at which it was observed (L1–L6, defined in
[`FINPRO_EVALUATION_TEST_MATRIX.md`](FINPRO_EVALUATION_TEST_MATRIX.md) §1).

| Area | Status | Level | Basis |
|---|---|---|---|
| Authentication and token lifecycle | **PASS** | L1 + L4 | Jest auth suites; production register/login/me/refresh/delete |
| Tenant isolation | **PASS** | L4 | Cross-user reads 404 across accounts, transactions, storage, receipts |
| Accounts CRUD | **PASS** | L3 + L4 | `run-all-tests.js`; production smoke |
| Transactions (income/expense) | **PASS** | L3 + L4 | Production create/read/delete; balance effects |
| Transfers (two-leg ledger) | **PASS** | L2 + L4 | 62/62 real-DB verifier; production replay |
| Deposit idempotency | **PASS** | L2 + L4 | 32/32 real-DB verifier; production replay `200` |
| Generic create idempotency | **PARTIAL** | — | Known gap: income/expense/loan have no key (P2-3) |
| Budgets and dashboard agreement | **PASS** | L1 + L3 | Phase 4 regression suite; production smoke |
| AI assistant plumbing | **PASS** | L3 + L4 | Stubbed provider tests; production `source=gemini-tools` |
| AI confirmation gate | **PASS** | L2 | 31/31 real-DB verifier, incl. 5-way concurrency |
| AI answer quality | **NOT TESTED** | — | No quality rubric or hallucination evaluation |
| Market data | **PASS** | L1 + L4 | Jest provider suites; live `RELIANCE` quote |
| Payment simulator (local semantics) | **PASS** | L3 | 19/19 harness on isolated DB |
| Payment simulator (production) | **BLOCKED** | L4 | Deliberately disabled; mutations 403 |
| Receipts / OCR | **PASS** | L4 | Text and image OCR, confirm, replay, isolation |
| Storage upload/download/isolation | **PASS** | L4 | 23-check production harness |
| Storage durability | **BLOCKED** | L4 | `provider:local`, `durable:false` |
| Notifications (API surface) | **PASS** | L4 | Register/remove/test-push/no-token |
| Notification delivery to a device | **NOT TESTED** | L5 | No device or token |
| Health and dependency probes | **PASS** | L4 | 24/24 over 4+ minutes, no 429 |
| Rate limiting | **PASS** | L3 + L4 | Local 1100/1100 health; general cap still enforced |
| Security middleware | **PASS** | L4 | Helmet, CORS allowlist, body limit, live headers |
| Dependency security | **PARTIAL** | L1 | 0 critical; 1 high + 2 moderate remain (majors) |
| Tracked-secret scan | **PASS** | L1 | 367 files, 0 secrets |
| Database schema and cascades | **PASS** | L4 | 11 migrations, 44 tables, 50 FKs, 38 user cascades |
| Backup creation and restore drill | **PASS** | L3 | Encrypted archive restored into PG 18 |
| Scheduled / off-host backup | **BLOCKED** | — | No scheduler destination; no off-host target |
| Frontend production pages | **PASS** | L4 | 5/5 pages 200; `index.html` hash matches repo |
| Frontend interactive flows | **PARTIAL** | L3 | Manual Phase 4/6 sessions; not re-run in Phase 9 |
| Android static validation | **PASS** | L1 | Signed APK/AAB, manifest, 239 widget tests |
| Android device validation | **NOT TESTED** | L5 | No device, no AVD/system image |
| Google Play submission | **BLOCKED** | — | No Console access; declarations outstanding |
| Production load / soak | **NOT TESTED** | L6 | Prohibited against production; local bounded run only |
| Database expiry | **BLOCKED** | — | Free plan expires **2026-11-11** |

---

## 3. Verified items (executed and observed)

These are the claims that can be made in front of an examiner without hedging.

### 3.1 Automated suites

| Suite | Level | Result |
|---|---|---|
| Jest (`npm run test:unit`) | L1 | **35/35 suites, 572/572 tests PASS** |
| `run-all-tests.js` | L3 | **166/166 PASS** |
| `test-sms-mobile-suite.js` | L3 | **41/41 PASS** |
| `test-cloud-verification.js` | L3 | **29/29 PASS** |
| `test-cloud-failure.js` | L3 | **17/17 PASS** |
| `verify-transfer-idempotency.js` | L2 | **62/62 PASS** |
| `verify-deposit-idempotency.js` | L2 | **32/32 PASS** |
| `verify-ai-confirmation.js` | L2 | **31/31 PASS** |
| Simulator semantics harness | L3 | **19/19 PASS** |
| Storage / receipt / FCM harness | L3 | **23/23 PASS** |
| Flutter widget tests | L1 | **239/239 PASS** |
| JavaScript syntax lint | L1 | **115/115 files clean** |
| Tracked-secret scan | L1 | **367 files, 0 secrets** |
| Production build verification | L1 | **PASS** |
| Flutter static analysis | L1 | **No issues found** |

**Total executed assertions this pass: 1,285**, plus lint, secret, and build
gates. These ran after the lockfile update, not before it.

### 3.2 Production (L4)

| Check | Observed |
|---|---|
| Backend health | `200`, `status:"healthy"`, `database:"connected"` |
| Health stability | 24/24 probes over 4+ minutes, no `429`, no `REQ-ERROR` |
| Live commit | `f6cdf9f` via `dep-dbfl1oq9lscs73ahr2hg` |
| Auth lifecycle | register 201, login 200, `/auth/me` 200, delete 200, old token 401 |
| Isolation | cross-user account/transaction/storage/receipt → `404` / `403` |
| Transfer replay | same key → same transaction id |
| Transfer conflict | same key, different payload → `409 IDEMPOTENCY_CONFLICT` |
| Deposit replay | `200`, `replayed:true` |
| AI | `source=gemini-tools` |
| Market | live `RELIANCE` quote at `1201.8` |
| Simulator | status `enabled:false`; mutations `403 SIMULATOR_DISABLED` |
| Storage | PNG/PDF/CSV upload 201; byte-identical download; SVG 415; MIME mismatch 415; 4 MB 201; 8 MB 413 |
| Download hardening | `nosniff` + sandbox CSP present |
| Receipt text | GST `44.82`; confirm 201; replay `alreadyConfirmed:true` |
| Receipt image | OCR `Starbucks Coffee`, `249`, confidence `94`; confirmed as `CONFIRMED` expense |
| FCM | register/remove/test-push 200; no token → `404 NO_TOKENS` |
| Deletion with file | 200; token afterwards 401 |
| Frontend | `/`, `/privacy.html`, `/terms.html`, `/delete-account.html`, `/simulator.html` → 200 |
| Proxy | `/api/v1/health` through the Vercel origin → 200 |
| Database | 11/11 migrations, 44 tables, 50 FKs, 38 user cascades |
| Baseline restored | 9 users, 30 transactions, 11 accounts, 5 budgets, 0 idempotency rows, 29 audit logs |

### 3.3 Local integration (L2/L3)

- Two-leg transfer atomicity, rollback, retry-after-rollback, delete-after-commit,
  and five-way concurrency.
- Deposit key claim, conflicting payloads, keyless double-credit (expected),
  rejected-deposit rollback, ledger reconciliation.
- AI confirmation token hashing, expiry, single-claim, terminal states,
  five-way concurrent claim.
- Simulator `SUCCESS`, `PENDING → confirm`, `FAILURE`, refund, reversal,
  `INSUFFICIENT_FUNDS`, idempotent replay, key conflict, reset, cleanup.
- S3 path against MinIO, including restart persistence and fail-closed
  behaviour.

### 3.4 Android artifacts (L1)

- APK SHA-256 `16b5516a0d225f506141bf5eac67e83ccc854448e9448b3c32c50e8282352187`
- AAB SHA-256 `7b796a91ef0cadd73658be8957e4a97af9d05bf621fb7402dab4478108260753`
- Package `com.finpro.app.finpro_mobile`, version `1.0.0` (code 1)
- minSdk 24, targetSdk 36, compileSdk 36
- Signed by `CN=FinPro`, cert SHA-256
  `5302c89b5c214d169d2affa1650103039f3d7ec1e5bc0aceb50b2f092c4e3d7a`,
  expires 2054-03-03
- `allowBackup=false`, not debuggable, no cleartext opt-in
- AAB signature verified

---

## 4. Implemented but unverified

Code exists and passes local tests, but no deployed environment proves the
behaviour. These must be described as "implemented" rather than "works".

| Item | Why unverified | What would verify it |
|---|---|---|
| Durable S3 object storage in production | No bucket or credentials | Provision a bucket, set env vars, upload → redeploy → download |
| Off-host encrypted backup restore | No authorised destination | Copy the archive off Render, restore into a clean PG 18, compare hashes |
| FCM end-to-end delivery | No device or valid token | Install the APK on a device, register, trigger a push |
| Android runtime behaviour (SMS channel, permissions, deep links, TalkBack) | No device or AVD | Physical device pass |
| Prometheus metrics | `/metrics` 404 without `METRICS_TOKEN` | Set a token, scrape, confirm series |
| Redis-backed shared rate limits / cache | No Redis in production | Provision Redis, run two instances, probe limits |

The S3 code path is not vapour: it passed a 22-check harness against MinIO,
including restart persistence and fail-closed production behaviour. It simply
has no production target.

---

## 5. Failed items

**Product failures in this pass: none.**

One apparent failure was investigated and dismissed:

| Reported | Reality | Resolution |
|---|---|---|
| "Deposit idempotency FAIL" in the first production smoke | The harness asserted `201`; the endpoint correctly returns `200`. It also compared the wrong field. The same transaction id was replayed, so idempotency passed. | Harness assertion corrected; reclassified as a test artefact, not a product defect. |

No test was deleted, skipped, or loosened to produce a pass. The only change to
test code was correcting the assertion to match the documented contract.

---

## 6. Blocked items

Blocked means *cannot be completed from this machine without an external
decision, credential, hardware, or console*. None of these is a hidden code
defect.

| ID | Item | Blocker | Impact on evaluation | Owner action |
|---|---|---|---|---|
| B-1 | Durable production object storage | No bucket, no credentials, no migration plan | Uploads survive only within one instance lifetime | Authorise a bucket + credentials, then migrate |
| B-2 | Render PostgreSQL expiry | Free plan ends **2026-11-11T11:24:01Z**; deletion after **2026-11-25** | Fine on demo day; dead shortly after | Upgrade to `0.1c-256mb` (~$6/mo) or migrate |
| B-3 | Android physical-device testing | No device; no AVD/system image | Cannot claim a device run | Provide a device or install an emulator image |
| B-4 | Google Play submission | No Console access; declarations outstanding | App cannot be published | Complete Data Safety, permissions, signing declarations |
| B-5 | Off-host backup | No authorised destination; `.github/workflows/backup.yml` is gated on `BACKUP_ENABLED=true` and never observed running | RPO/RTO unproven | Provide storage + enable the schedule |
| B-6 | Production load / soak | Explicitly prohibited in this phase | No capacity claim | Separate, authorised performance test |

Two further environment limits are worth naming even though they did not block a
deliverable:

- **Render env-var listing is unavailable via the CLI**, so the full secret set
  cannot be enumerated from here. Secrets were therefore not audited
  exhaustively; only tracked files were scanned.
- **`render.yaml` drifts from the live service** (`runtime: node` vs Docker,
  `/api/v1/health/live` vs `/api/v1/health`). Re-applying the blueprint could
  reconfigure the service, so it was left alone.

---

## 7. Owner actions

These are decisions, not engineering tasks. They are ordered by risk reduction.

| Priority | Action | Why now |
|---|---|---|
| 1 | Decide on the Render Postgres plan before **2026-11-11** | The database is deleted after the grace period; the demo is safe but any re-run is not |
| 2 | Provide object-storage credentials and approve a migration | Removes the only data-loss path in normal operation |
| 3 | Provide an Android device or approve an emulator image | Converts the largest "NOT TESTED" block into evidence |
| 4 | Approve an off-host backup destination and schedule | Closes the disaster-recovery gap |
| 5 | Schedule the `zod` and `node-cron` major upgrades **after** evaluation | Both are breaking majors; doing them now adds risk without demo benefit |

Nothing on this list requires a code rewrite. Items 1–4 are configuration and
authorisation; item 5 is a planned maintenance window.

---

## 8. Not tested

No execution evidence exists. Do not present these as working.

| ID | Item | Reason |
|---|---|---|
| N-1 | Android install, launch, and runtime permissions on a device | No hardware |
| N-2 | SMS `MethodChannel` against a real SMS | No device |
| N-3 | External-link handoff (privacy, terms, deletion) on Android | No device |
| N-4 | FCM delivery to a device | No device/token |
| N-5 | TalkBack / accessibility on Android | No device |
| N-6 | Production load, soak, and multi-instance behaviour | Prohibited / single instance |
| N-7 | Cold-start latency measurement | Observed qualitatively, never timed |
| N-8 | Off-host restore and measured RPO/RTO | No destination |
| N-9 | AI answer quality, hallucination rate, prompt-injection resistance | Out of scope for Phase 9 |

---

## 9. Changes made in Phase 9

| Change | File | Type | Verified by |
|---|---|---|---|
| Health probes exempt from the general limiter; general limit 200 → 1000 | `node-backend/src/app.js` | Code (P0 fix) | Local 1100/1100; production 24/24 |
| Semver-only dependency remediation | `node-backend/package-lock.json` | Lockfile (P1 fix) | Full suite + build + `npm audit` |
| Phase 9 documentation set | `docs/PHASE9_*.md`, `docs/FINPRO_*.md` | Docs | Diff review |
| Documentation corrections | `docs/README.md`, `DEPLOYMENT.md`, `TESTING.md`, `OPERATIONS.md`, `ARCHITECTURE.md`, `GOOGLE_PLAY_COMPLIANCE.md` | Docs | Diff review |

**Not changed:** `package.json`, database schema, migrations, environment
variables, auth requirements, deployment topology, storage provider, Render
plan, Vercel configuration, Android source.

No commit in this phase deletes data, rewrites history, or changes production
auth.

---

## 10. Evidence integrity

How to check that this report is not aspirational:

| Claim type | Where the evidence lives |
|---|---|
| Automated suites | Re-runnable: `npm run test:unit`, `node scripts/run-all-tests.js`, the three `verify-*.js` scripts |
| Real-database invariants | Require `DATABASE_URL` pointing at `finpro_phase9_verify`, never at `finance_jinay` |
| Production smoke | Live HTTPS responses against `f6cdf9f`; synthetic accounts deleted via API |
| Deployment identity | `render deploys list srv-db5sb1vavr4c739td7d0`; live `/api/v1/health` |
| Database structure | Read-only SQL via `render psql` |
| Android artifacts | SHA-256 and signature checks on the built files |
| Backup | Encrypted archive + isolated restore, `BACKUP_DR.md` §13.1 |

Two rules were enforced throughout:

1. **No production data was deleted directly.** Synthetic accounts were removed
   through the account-deletion API only. The isolated verification database is
   the only place destructive SQL ran.
2. **No test was run against production with a destructive intent.** Production
   probes created and removed their own synthetic accounts and left baseline
   counts intact.

---

## 11. What may and may not be claimed

### May be claimed

- The web app and REST API are **live and verified**.
- Authentication, tenant isolation, ledger effects, transfer/deposit
  idempotency, the AI confirmation gate, receipts, storage isolation, and
  account deletion were **executed against production**.
- Financial invariants were **proven against a real PostgreSQL** with
  concurrency and rollback tests.
- The Android build is **signed, statically validated, and source-equivalent to
  HEAD**.
- The known gaps are **environmental and documented**, not hidden.

### May not be claimed

- "Production-ready" — durable storage, database expiry, and off-host backup
  are open.
- "Secure" or "penetration-tested" — no independent assessment was performed.
- "Works on Android" — no device run exists.
- "Payments work in production" — the simulator is deliberately disabled.
- "Load-tested" — only a bounded local run exists.
- "Fully tested" — nine items are explicitly not tested.
- "The AI is accurate" — only its plumbing was verified, not its answers.

---

## 12. Go / no-go for 2026-11-05

**GO for a web + API demonstration**, subject to three operational conditions:

1. **Warm the backend** at least one hour before, and again ten minutes before.
2. **Use a fresh demo account** with the dataset in
   [`FINPRO_EVALUATION_DEMO.md`](FINPRO_EVALUATION_DEMO.md) §3.
3. **Do not attempt** a live simulator mutation, a durable-storage claim, or an
   Android device demo.

**CONDITIONAL for an Android demonstration** — static artifacts only, clearly
labelled as such, unless a device becomes available.

**NO-GO for any claim of production readiness, security certification, or
capacity.** Those are not supported by the evidence and should be declined
plainly if asked.

---

## 13. Related documents

| Document | Purpose |
|---|---|
| [`PHASE9_INITIAL_AUDIT.md`](PHASE9_INITIAL_AUDIT.md) | Baseline state, findings, severity, remediation, deferrals |
| [`FINPRO_EVALUATION_TEST_MATRIX.md`](FINPRO_EVALUATION_TEST_MATRIX.md) | Requirement-by-requirement evidence with levels and statuses |
| [`FINPRO_EVALUATION_DEMO.md`](FINPRO_EVALUATION_DEMO.md) | Warm-up, dataset, 15-minute script, fallbacks, Q&A |
| [`FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md`](FINPRO_CLOUD_ARCHITECTURE_DEFENSE.md) | Topology, components, security, trade-offs, STRIDE, examiner Q&A |
| [`BACKUP_DR.md`](BACKUP_DR.md) | Backup, restore drill, expiry and cutover runbook |
| [`GOOGLE_PLAY_COMPLIANCE.md`](GOOGLE_PLAY_COMPLIANCE.md) | Play requirement matrix and outstanding declarations |
| [`OPERATIONS.md`](OPERATIONS.md) | Health semantics, rate limits, storage durability, database expiry |

---

## 14. Sign-off statement

This report separates what was **executed** from what was **implemented** from
what is **blocked** and what is **not tested**. It does not claim security
certification, independent penetration testing, production capacity, or
physical-device validation.

The system is ready to be demonstrated and defended on the web and API surfaces.
It is not ready to be called production-grade, and the remaining blockers are
named above rather than absorbed into a general claim of success.
