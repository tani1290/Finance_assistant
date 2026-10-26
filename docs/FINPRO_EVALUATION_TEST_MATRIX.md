# FinPro — Evaluation Test Matrix

**Date:** 2026-10-26
**Branch:** `finpro/pre-deployment-checkpoint`
**Backend under test:** `f6cdf9f` (live `dep-dbfl1oq9lscs73ahr2hg`)
**Frontend under test:** `https://fin-pro-wheat.vercel.app`
**Isolated verification database:** `finpro_phase9_verify` (11/11 migrations)

---

## 1. How to read this document

### 1.1 Test levels

| Level | Meaning | What it proves | What it does **not** prove |
|---|---|---|---|
| **L1** | Automated unit / mocked integration (Jest) | Contract logic, error paths, security guards | Real database constraints, real network, deployed config |
| **L2** | Local real PostgreSQL verifier | Unique constraints, transactions, concurrency, rollback | HTTP edge, deployment, TLS, platform limits |
| **L3** | Local full-stack harness (real Express + real DB) | End-to-end request path on one machine | Production environment, cold start, CDN |
| **L4** | Production smoke (live HTTPS, synthetic account) | Deployed behaviour, real TLS, real database, real provider calls | Capacity, soak, multi-instance, device |
| **L5** | Android device / emulator | Runtime permissions, SMS channel, layout, OS integration | — |
| **L6** | Load / performance | Throughput and latency under concurrency | Production capacity (unless run against production, which was not done) |

### 1.2 Status vocabulary

| Status | Meaning |
|---|---|
| **PASS** | Executed and observed to meet the expected result at the stated level |
| **PARTIAL** | Core behaviour verified, but a named sub-case or environment is not |
| **BLOCKED** | Cannot be executed without an owner decision, credential, billing change, hardware, or external console |
| **NOT TESTED** | No execution evidence; implementation may exist |
| **FAIL** | Executed and did not meet the expected result |

A status always carries its level. `PASS (L1)` is not `PASS (L4)`.

---

## 2. Summary

| Suite / activity | Level | Result |
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
| Production API smoke | L4 | **31 PASS, 1 PARTIAL, 1 harness-assertion artefact** |
| Production storage / receipt / FCM smoke | L4 | **23 PASS** |
| Frontend production pages | L4 | **5/5 PASS** |
| Flutter widget tests | L1 (mobile) | **239/239 PASS** |
| Flutter static analysis | L1 (mobile) | **No issues found** |
| JavaScript syntax lint | L1 | **115/115 files PASS** |
| Tracked-secret scan | L1 | **367 files, 0 secrets** |
| Production build verification | L1 | **PASS** |
| Android physical device | L5 | **NOT TESTED** |
| Production load / soak | L6 | **NOT TESTED** (local bounded run only) |

**Total executed assertions in this pass:** 572 + 166 + 41 + 29 + 17 + 62 + 32
+ 31 + 19 + 23 + 31 + 23 + 239 = **1,285**, plus lint/secret/build checks.

---

## 3. Authentication and account lifecycle

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| AUTH-1 | Register creates a user and returns access + refresh tokens | `run-all-tests.js`; production smoke register → 201 | L3 + L4 | **PASS** |
| AUTH-2 | Duplicate email returns `409 EMAIL_EXISTS` | Jest `api.test.js`; negative matrix | L1 | **PASS** |
| AUTH-3 | Weak password rejected with `400 VALIDATION_ERROR` | Jest + negative matrix | L1 | **PASS** |
| AUTH-4 | Login returns a valid access token | Production smoke login → 200 | L4 | **PASS** |
| AUTH-5 | `/auth/me` returns only the caller | Production smoke → 200, correct user | L4 | **PASS** |
| AUTH-6 | Malformed JWT → `401 INVALID_TOKEN` | Negative matrix | L1 | **PASS** |
| AUTH-7 | Expired access token → `401 TOKEN_EXPIRED` | Negative matrix; refresh flow | L1 | **PASS** |
| AUTH-8 | Revoked refresh token → `401 TOKEN_REVOKED` | Negative matrix | L1 | **PASS** |
| AUTH-9 | Refresh rotates and invalidates the old token | Jest auth suites | L1 | **PASS** |
| AUTH-10 | Logout revokes the refresh token | Jest auth suites | L1 | **PASS** |
| AUTH-11 | Auth limiter is separate from the general API limiter | `app.js`; local limiter probe | L3 | **PASS** |
| AUTH-12 | Account deletion requires password + `confirmation:"DELETE"` | Jest; production smoke | L1 + L4 | **PASS** |
| AUTH-13 | Wrong confirmation → `400` | Production smoke | L4 | **PASS** |
| AUTH-14 | Wrong password → `401` | Production smoke | L4 | **PASS** |
| AUTH-15 | Successful deletion invalidates the token | Production smoke: delete 200, old token 401 | L4 | **PASS** |
| AUTH-16 | Login after deletion → `401` | Production smoke | L4 | **PASS** |
| AUTH-17 | Deletion cascades across all 38 user-owned FKs | Schema inspection + deletion smoke | L2 + L4 | **PASS** |
| AUTH-18 | Deletion purges stored files before the row is removed | Production storage smoke with a stored file → 200; file then unreachable | L4 | **PASS** |

---

## 4. Accounts and transactions

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| ACC-1 | Create account with opening balance | `run-all-tests.js`; production smoke → 201 | L3 + L4 | **PASS** |
| ACC-2 | List accounts is tenant-scoped | Production smoke: user B cannot see user A | L4 | **PASS** |
| ACC-3 | Read another user's account → `404` | Production smoke | L4 | **PASS** |
| ACC-4 | Update account | `run-all-tests.js` | L3 | **PASS** |
| ACC-5 | Delete account | `run-all-tests.js` | L3 | **PASS** |
| ACC-6 | Balance reflects ledger effects | `verify-transfer-idempotency.js` reconciliation | L2 | **PASS** |
| TX-1 | Create income | Production smoke → 201 | L4 | **PASS** |
| TX-2 | Create expense | Production smoke → 201 | L4 | **PASS** |
| TX-3 | Negative amount rejected | Negative matrix | L1 | **PASS** |
| TX-4 | Invalid date rejected (`400`) | Jest; deposit verifier | L1 + L2 | **PASS** |
| TX-5 | Pagination validated (`page`, `limit`, `type`) | Jest `transactionTransfer.test.js` | L1 | **PASS** |
| TX-6 | Cross-tenant transaction read → `404` | Production smoke | L4 | **PASS** |
| TX-7 | Delete transaction reverses its balance effect | Jest; verifier | L1 + L2 | **PASS** |
| TX-8 | Income/expense totals exclude transfers | `verify-transfer-idempotency.js` | L2 | **PASS** |
| TX-9 | Generic creation is **not** idempotent | Code inspection; documented | — | **PARTIAL** (known limitation) |

---

## 5. Transfers, deposits and idempotency

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| TR-1 | Transfer writes one debit and one credit atomically | `verify-transfer-idempotency.js` 62/62 | L2 | **PASS** |
| TR-2 | Same key replays the same transaction id | Verifier + production smoke | L2 + L4 | **PASS** |
| TR-3 | Same key with a different payload → `409 IDEMPOTENCY_CONFLICT` | Verifier + production smoke | L2 + L4 | **PASS** |
| TR-4 | Concurrent identical transfers converge on one row | Verifier | L2 | **PASS** |
| TR-5 | Concurrent conflicting transfers: one winner, four `409`s | Verifier | L2 | **PASS** |
| TR-6 | Mid-transaction failure rolls back both legs and the key claim | Verifier | L2 | **PASS** |
| TR-7 | Retry after rollback succeeds once | Verifier | L2 | **PASS** |
| TR-8 | Delete after commit leaves the key claimed | Verifier | L2 | **PASS** |
| TR-9 | Deleted-transfer retry is a conflict, not a resurrection | Verifier | L2 | **PASS** |
| TR-10 | Same key value can be reused by a different user | Verifier | L2 | **PASS** |
| TR-11 | Transfer to a foreign account → `404`, no movement | Verifier + Jest | L1 + L2 | **PASS** |
| TR-12 | Transfer to the same account → `400` | Jest | L1 | **PASS** |
| TR-13 | `toAccountId` on a non-transfer → `400` | Jest | L1 | **PASS** |
| TR-14 | PATCH cannot convert to/from `TRANSFER` | Jest | L1 | **PASS** |
| DEP-1 | Deposit credits exactly once | `verify-deposit-idempotency.js` 32/32 | L2 | **PASS** |
| DEP-2 | Concurrent deposits with one key create one row | Verifier | L2 | **PASS** |
| DEP-3 | Concurrent conflicting deposits: one winner, four `409`s | Verifier | L2 | **PASS** |
| DEP-4 | Keyless deposits credit twice (expected) | Verifier | L2 | **PASS** |
| DEP-5 | Rejected deposit claims no key and writes no row | Verifier | L2 | **PASS** |
| DEP-6 | Same key retried after rollback succeeds once | Verifier | L2 | **PASS** |
| DEP-7 | Balance equals the sum of the ledger | Verifier | L2 | **PASS** |
| DEP-8 | Production deposit replay returns `200 replayed:true` | Production smoke | L4 | **PASS** |

> **Note on the one production "FAIL".** The first smoke run reported a failure
> on deposit idempotency. Investigation showed the harness asserted `201` while
> the deposit endpoint correctly returns `200`, and it compared the wrong field.
> The same transaction id was replayed, so idempotency passed. The harness
> assertion was corrected; this was **not** a product failure.

---

## 6. Budgets, dashboard and analytics

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| BUD-1 | Create / list / update / delete budget | `run-all-tests.js` | L3 | **PASS** |
| BUD-2 | Budget usage reflects transactions | Jest analytics/budget suites | L1 | **PASS** |
| BUD-3 | Budgets are tenant-scoped | Production smoke | L4 | **PASS** |
| DASH-1 | Dashboard totals agree with ledger | `phase4FinanceDate.test.js` | L1 | **PASS** |
| DASH-2 | Transfers excluded from income/expense | Jest + verifier | L1 + L2 | **PASS** |
| DASH-3 | Refunds counted as income | Jest | L1 | **PASS** |
| DASH-4 | Empty period returns zeroes, not errors | Jest | L1 | **PASS** |
| DASH-5 | Month boundary / IST rollover correct | Jest | L1 | **PASS** |
| DASH-6 | Leap day and impossible dates handled | Jest | L1 | **PASS** |
| ANA-1 | Analytics endpoints return tenant-scoped data | `run-all-tests.js` | L3 | **PASS** |
| ANA-2 | CSV/statement import validates amounts | `run-all-tests.js` (negative rows) | L3 | **PASS** |

---

## 7. AI assistant

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| AI-1 | Model tool call writes a real ledger row | `run-all-tests.js` (stubbed provider) | L3 | **PASS** |
| AI-2 | Provider error degrades to deterministic engine, no 500 | `run-all-tests.js` | L3 | **PASS** |
| AI-3 | Empty message → `400 VALIDATION_ERROR` | `run-all-tests.js` | L3 | **PASS** |
| AI-4 | History capped at 50, most recent, oldest-first | `run-all-tests.js` | L3 | **PASS** |
| AI-5 | History is tenant-scoped | Jest | L1 | **PASS** |
| AI-6 | Confirmation token is hashed, never stored in plaintext | `verify-ai-confirmation.js` | L2 | **PASS** |
| AI-7 | Another user cannot claim a proposal → `404` | Verifier | L2 | **PASS** |
| AI-8 | Expired proposal → `410`, marked `EXPIRED` | Verifier | L2 | **PASS** |
| AI-9 | Live proposal claimed exactly once | Verifier | L2 | **PASS** |
| AI-10 | Five concurrent claims → one winner, four `409`s | Verifier | L2 | **PASS** |
| AI-11 | `COMPLETED` / `FAILED` / `CANCELLED` are terminal | Verifier | L2 | **PASS** |
| AI-12 | A failed action is not marked retryable | Verifier | L2 | **PASS** |
| AI-13 | Replay is `409 ACTION_IN_PROGRESS`, not a second mutation | Verifier | L2 | **PASS** |
| AI-14 | Production `/ai/chat` uses Gemini tools | Production smoke: `source=gemini-tools` | L4 | **PASS** |
| AI-15 | Answer quality / hallucination resistance | Not evaluated | — | **NOT TESTED** |
| AI-16 | Total wall-clock deadline for the worst-case chain | Per-call timeout only | — | **PARTIAL** |

---

## 8. Market data and external providers

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| MKT-1 | Live quote returns a price | Production smoke: `RELIANCE` → 1201.8 | L4 | **PASS** |
| MKT-2 | Provider timeout → bounded retry then safe error | Jest `marketEngine.test.js` | L1 | **PASS** |
| MKT-3 | Circuit breaker opens after repeated failures | Jest | L1 | **PASS** |
| MKT-4 | `404` is a valid answer and does not open the circuit | Jest | L1 | **PASS** |
| MKT-5 | Cache serves fresh data only | Jest; cache service probe | L1 | **PASS** |
| MKT-6 | Upstream `429` is honoured with `Retry-After` | Jest | L1 | **PASS** |
| MKT-7 | Metals / news endpoints | Jest `marketMetalsController.test.js` | L1 | **PASS** |

---

## 9. Payment simulator

The simulator is **disabled in production** by two independent keys. Its full
state machine was therefore proven locally against the isolated database with
`PAYMENT_SIMULATOR_ENABLED=true`.

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| SIM-1 | Production status is readable and reports disabled | Production smoke → 200 `enabled:false`, `production:true`, `synthetic:true` | L4 | **PASS** |
| SIM-2 | Production mutations → `403 SIMULATOR_DISABLED` | Production smoke `POST /simulator/seed` | L4 | **PASS** |
| SIM-3 | Unauthenticated status → `401` | Production smoke | L4 | **PASS** |
| SIM-4 | Seed creates a synthetic balance | Local harness | L3 | **PASS** |
| SIM-5 | `SUCCESS` settles atomically | Local harness | L3 | **PASS** |
| SIM-6 | Idempotent replay returns `200` | Local harness | L3 | **PASS** |
| SIM-7 | Key reuse with a different payload → `409` | Local harness | L3 | **PASS** |
| SIM-8 | `PENDING → confirm → SUCCESS` | Local harness | L3 | **PASS** |
| SIM-9 | Settled payment cannot be failed → `409` | Local harness | L3 | **PASS** |
| SIM-10 | `FAILURE` moves no money | Local harness | L3 | **PASS** |
| SIM-11 | Refund credits and is idempotent | Local harness | L3 | **PASS** |
| SIM-12 | Refund blocks a reverse | Local harness | L3 | **PASS** |
| SIM-13 | Reversal credits the payer | Local harness | L3 | **PASS** |
| SIM-14 | `INSUFFICIENT_FUNDS` → `FAILED`, no ledger row | Local harness | L3 | **PASS** |
| SIM-15 | List returns the user's payments | Local harness (5) | L3 | **PASS** |
| SIM-16 | Cross-user payment read → `404` | Local harness | L3 | **PASS** |
| SIM-17 | Reset unwinds the ledger | Local harness: 5 payments / 5 transactions deleted | L3 | **PASS** |
| SIM-18 | Cleanup removes synthetic rows | Local harness → 200 | L3 | **PASS** |
| SIM-19 | Simulator enabled in **production** | Deliberately not enabled | — | **BLOCKED** (policy) |

---

## 10. Receipts, OCR and storage

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| OCR-1 | Text receipt scan extracts amount and GST | Production smoke: GST 44.82 | L4 | **PASS** |
| OCR-2 | Text confirm creates a transaction | Production smoke → 201 | L4 | **PASS** |
| OCR-3 | Confirm replay returns `200 alreadyConfirmed:true` | Production smoke | L4 | **PASS** |
| OCR-4 | Cross-user confirm → `404` | Production smoke | L4 | **PASS** |
| OCR-5 | Image OCR extracts merchant/amount/confidence | Production smoke: Starbucks Coffee, 249, 94% | L4 | **PASS** |
| OCR-6 | Confirmed image receipt becomes a visible expense | Production smoke: 249 EXPENSE `CONFIRMED` | L4 | **PASS** |
| OCR-7 | Image smaller than 100 bytes rejected | Jest | L1 | **PASS** |
| STO-1 | PNG / PDF / CSV upload → 201 | Production storage smoke | L4 | **PASS** |
| STO-2 | Owner download is byte-identical | Production storage smoke | L4 | **PASS** |
| STO-3 | Download sends `nosniff` and sandbox CSP | Production storage smoke | L4 | **PASS** |
| STO-4 | Cross-user read / delete → `403` | Production storage smoke | L4 | **PASS** |
| STO-5 | SVG → `415` | Production storage smoke | L4 | **PASS** |
| STO-6 | MIME mismatch → `415` | Production storage smoke | L4 | **PASS** |
| STO-7 | 4 MB upload accepted | Production storage smoke → 201 | L4 | **PASS** |
| STO-8 | 8 MB upload rejected | Production storage smoke → 413 | L4 | **PASS** |
| STO-9 | Owner delete → 200, then 404 | Production storage smoke | L4 | **PASS** |
| STO-10 | Missing cloud object returns 404, not 503 | Jest `storageProductionFailClosed.test.js` + live probe | L1 + L4 | **PASS** |
| STO-11 | S3 path survives a restart (MinIO) | 22-check harness | L3 | **PASS** |
| STO-12 | Production storage is durable | Live `durable:false` | L4 | **BLOCKED** |
| STO-13 | Uploaded file survives a Render redeploy | Not executed (would require a deploy) | — | **NOT TESTED** |

---

## 11. Notifications and push

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| FCM-1 | Register token | Production smoke → 200 | L4 | **PASS** |
| FCM-2 | Remove token | Production smoke → 200 | L4 | **PASS** |
| FCM-3 | Test push accepted | Production smoke → 200 | L4 | **PASS** |
| FCM-4 | Push with no token → `404 NO_TOKENS` | Production smoke | L4 | **PASS** |
| FCM-5 | End-to-end delivery to a device | No device/token | L5 | **NOT TESTED** |
| FCM-6 | Queue bounds, dedupe, retry, timeout | Jest `pushQueue.test.js` | L1 | **PASS** |
| FCM-7 | Failed-token-only retry and permanent drop | Jest | L1 | **PASS** |
| FCM-8 | No token values in logs | Jest | L1 | **PASS** |

---

## 12. Security

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| SEC-1 | Helmet security headers | Code + live response headers | L4 | **PASS** |
| SEC-2 | CORS allowlist, not `*` | Code; `OPTIONS` from both deployed origins → 204 | L4 | **PASS** |
| SEC-3 | 10 MB body limit | Code; oversized upload → 413 | L4 | **PASS** |
| SEC-4 | General API rate limit | 1000/15 min; local probe capped | L3 | **PASS** |
| SEC-5 | Health probes never rate-limited | Local 1100/1100; production 24/24 | L3 + L4 | **PASS** |
| SEC-6 | Auth limiter 100/15 min, separate namespace | Code + local probe | L3 | **PASS** |
| SEC-7 | Account-deletion limiter 5/hour | Code | L1 | **PASS** |
| SEC-8 | Cross-tenant reads return 404, not 403 | Production smoke (accounts, transactions, storage, receipts) | L4 | **PASS** |
| SEC-9 | No secrets in tracked files | `scan-secrets.js`: 367 files, 0 secrets | L1 | **PASS** |
| SEC-10 | No critical dependency advisory | `npm audit --omit=dev`: 0 critical | L1 | **PASS** |
| SEC-11 | No high dependency advisory | 1 high (`zod`) remains, major upgrade required | L1 | **PARTIAL** |
| SEC-12 | Independent penetration test | Not performed | — | **NOT TESTED** |
| SEC-13 | Prompt-injection resistance | Not evaluated | — | **NOT TESTED** |
| SEC-14 | Refresh tokens stored hashed | Schema + auth service inspection | L1 | **PASS** |
| SEC-15 | Passwords hashed with bcrypt | Auth service inspection + tests | L1 | **PASS** |
| SEC-16 | Production auth requirements unchanged in Phase 9 | Diff review | — | **PASS** |

---

## 13. Health, operations and deployment

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| OPS-1 | `/api/v1/health/live` → 200 | Live probe | L4 | **PASS** |
| OPS-2 | `/api/v1/health` → 200, database connected | Live probe | L4 | **PASS** |
| OPS-3 | `/api/v1/health/dependencies` → 200 | Live probe | L4 | **PASS** |
| OPS-4 | `/api/v1/health/ready` → 200 | Live probe | L4 | **PASS** |
| OPS-5 | `/api/v1/health/database` → 200 | Live probe | L4 | **PASS** |
| OPS-6 | `/api/v1/health/storage` → 200 | Live probe | L4 | **PASS** |
| OPS-7 | No health endpoint leaks credentials | Payload inspection | L4 | **PASS** |
| OPS-8 | Health probes stable over 4+ minutes | 24/24 `200`, no `429` | L4 | **PASS** |
| OPS-9 | Deploy record matches the live commit | `dep-dbfl1oq9lscs73ahr2hg` at `f6cdf9f` | L4 | **PASS** |
| OPS-10 | Frontend production pages load | `/`, `/privacy.html`, `/terms.html`, `/delete-account.html`, `/simulator.html` → 200 | L4 | **PASS** |
| OPS-11 | Vercel → Render proxy works | `/api/v1/health` through the Vercel origin | L4 | **PASS** |
| OPS-12 | `render.yaml` matches the live service | Drift: node vs Docker, `/health/live` vs `/health` | — | **PARTIAL** (documented) |
| OPS-13 | Metrics scraping | `/metrics` → 404 without token | L4 | **PARTIAL** |
| OPS-14 | Database migrations current | 11/11 in `_prisma_migrations` | L4 | **PASS** |
| OPS-15 | 44 tables, 50 FKs, 38 user cascades | Read-only SQL | L4 | **PASS** |
| OPS-16 | Free-tier cold start | Observed behaviour; not measured | L4 | **PARTIAL** |

---

## 14. Backup and disaster recovery

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| BAK-1 | Encrypted production backup created | `BACKUP_DR.md` §13.1 | L4 | **PASS** |
| BAK-2 | Restore into isolated PostgreSQL 18 | 44 tables, 11 migrations, matching hashes | L3 | **PASS** |
| BAK-3 | Restore over a non-empty DB is refused | Recovery drill | L3 | **PASS** |
| BAK-4 | Wrong encryption key rejected, target unchanged | Drill + Jest | L3 | **PASS** |
| BAK-5 | Tampered archive fails GCM authentication | Jest | L1 | **PASS** |
| BAK-6 | Backup runs on a schedule | `.github/workflows/backup.yml` exists but is gated on repo variable `BACKUP_ENABLED=true` + `BACKUP_S3_BUCKET`; no scheduled run ever observed | — | **NOT TESTED** |
| BAK-7 | Off-host copy exists | No authorised destination | — | **BLOCKED** |
| BAK-8 | Restore from off-host copy | Not performed | — | **NOT TESTED** |
| BAK-9 | RPO/RTO measured | Not timed | — | **NOT TESTED** |

---

## 15. Mobile

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| MOB-1 | Static analysis clean | `flutter analyze --no-pub` → no issues | L1 | **PASS** |
| MOB-2 | Widget tests | `flutter test --no-pub` → 239 passed | L1 | **PASS** |
| MOB-3 | Release APK signed, not debug | `apksigner` / manifest inspection | L1 | **PASS** |
| MOB-4 | AAB signed | `jarsigner -verify` | L1 | **PASS** |
| MOB-5 | `allowBackup=false`, no cleartext, no debuggable | Merged manifest | L1 | **PASS** |
| MOB-6 | targetSdk 36, minSdk 24 | Manifest / APK badging | L1 | **PASS** |
| MOB-7 | App points at the production HTTPS API | `app_environment.dart` | L1 | **PASS** |
| MOB-8 | Install and launch on a physical device | No device | L5 | **NOT TESTED** |
| MOB-9 | Runtime SMS permission + `MethodChannel` | No device | L5 | **NOT TESTED** |
| MOB-10 | External-link handoff (privacy/terms/deletion) | No device | L5 | **NOT TESTED** |
| MOB-11 | Push notification delivery | No device/token | L5 | **NOT TESTED** |
| MOB-12 | Accessibility / TalkBack | No device | L5 | **NOT TESTED** |
| MOB-13 | Play Console declarations | Console access required | — | **BLOCKED** |

---

## 16. Web frontend

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| WEB-1 | Landing page loads | `curl` → 200 | L4 | **PASS** |
| WEB-2 | Privacy page loads with effective date | `curl` → 200; content inspected | L4 | **PASS** |
| WEB-3 | Terms page loads | `curl` → 200 | L4 | **PASS** |
| WEB-4 | Account-deletion page loads | `curl` → 200 | L4 | **PASS** |
| WEB-5 | Simulator page loads | `curl` → 200 | L4 | **PASS** |
| WEB-6 | `index.html` matches the repo | SHA-256 comparison | L4 | **PASS** |
| WEB-7 | Register → login → dashboard in a browser | Phase 4/6 manual sessions; not re-run in Phase 9 | L3 | **PARTIAL** |
| WEB-8 | AI propose → confirm → cancel in a browser | Phase 4 manual session | L3 | **PARTIAL** |
| WEB-9 | Responsive layout / reduced motion | Phase 6 manual Chrome checks | L3 | **PARTIAL** |
| WEB-10 | Automated browser regression suite | None exists | — | **NOT TESTED** |

---

## 17. Performance

| ID | Requirement | Method / evidence | Level | Status |
|---|---|---|---|---|
| PERF-1 | Bounded local load | 900 mixed requests, concurrency 12, 900/900 `200`, p50 8.4 ms, p95 15.8 ms, p99 22.5 ms, max 36.2 ms, ~1,366 req/s | L6 (local) | **PASS** |
| PERF-2 | Production capacity | Deliberately not tested | L6 | **NOT TESTED** |
| PERF-3 | Sustained soak | Not run | L6 | **NOT TESTED** |
| PERF-4 | Multi-instance behaviour | One instance; no Redis | — | **NOT TESTED** |
| PERF-5 | Cold start measured | Not measured | L4 | **NOT TESTED** |

> The local load run used `NODE_ENV=test`, which disables the rate limiter, and
> no Redis. It measures the app + database path on one laptop, nothing more.

---

## 18. What an examiner should not be told

Do **not** claim any of the following:

- "Fully tested" — device, production load, off-host restore, and AI quality are
  untested.
- "Production-ready storage" — it is local and ephemeral.
- "Secure" or "penetration-tested" — no independent assessment was performed.
- "Works on Android" — only static artifacts and widget tests exist.
- "Unlimited scale" — one free instance, no Redis, no queue durability.
- "Payments work in production" — the simulator is intentionally disabled.

The honest claim is: **the web app and API are live and verified; the Android
build is signed and statically validated; the remaining gaps are environmental,
not hidden.**
