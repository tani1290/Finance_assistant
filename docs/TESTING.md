# Jinay Finance AI — Automated & Regression Testing Guide
**Owner:** Jinay Golecha (`jinay_golecha`)  
**Test Harness:** Supertest-based custom Node runners (configured) · Jest (separate, not CI-integrated)

---

## 1. Test Suite Architecture

The repository ships **four configured, independently counted test suites** (run by `npm test`, `npm run test:cloud`, and `npm run test:failure`), plus one separate Jest suite that is **not** wired into `npm test` or CI:

```
┌────────────────────────────────┬────────────────────────┬------------------------------┐
│ Suite File                     │ Assertions / Tests     │ Focus Area                   │
├────────────────────────────────┼────────────────────────┼------------------------------┤
│ run-all-tests.js               │ 135 Assertions         │ Core APIs & DB               │
│ test-sms-mobile-suite.js       │ 36 Assertions          │ Mobile SMS Sync & Dedup      │
│ test-cloud-verification.js     │ 29 Assertions          │ Cloud Persistence            │
│ test-cloud-failure.js          │ 17 Assertions          │ Failure & Resiliency         │
├────────────────────────────────┼────────────────────────┼------------------------------┤
│ src/__tests__/api.test.js      │ 34 pass / 3 fail (Jest)│ Legacy Jest (not configured) │
└────────────────────────────────┴────────────────────────┴------------------------------┘
```

The four configured suites total **217 passing assertion checks** with 0 failures. The Jest suite in `src/__tests__/api.test.js` is a separate, currently failing legacy suite — it is not run by `npm test` or CI and is documented here for completeness only.

---

## 2. Executing Automated Tests

### 2.1 Master Integration & Acceptance Suite
Runs the 135-point top-to-bottom pipeline:
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
Runs the 36-point Android SMS detection and mobile sync pipeline:
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

### 2.5 Legacy Jest Suite (Not CI-integrated)
`src/__tests__/api.test.js` is a separate Jest suite that is **not** executed by `npm test` or the CI workflow. It currently reports **34 passing / 3 failing** of 37 tests due to stale assertions (Decimal amounts serialized as strings, an updated parser category taxonomy) and a 5 s default timeout on a live network AI call. It is retained for reference only and is excluded from the passing totals above.

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
| **Invalid Transaction ID** | `DELETE /transactions/non-existent-uuid` | `404 NOT_FOUND` | ✅ Verified |
| **Voice Intent Safety** | "Create expense ₹500" via voice | Returns intent with `requiresConfirmation: true` | ✅ Verified |
| **Negative Amount** | Transaction amount `-500` | Rejected by validation | ✅ Verified |
