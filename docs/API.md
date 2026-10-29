# Jinay Finance AI — REST API Documentation (v1)
**Base URL:** `http://127.0.0.1:5001/api/v1`  
**Authentication:** `Authorization: Bearer <access_token>`

---

## 1. Standard Response Format

### Success (`200 OK`, `201 Created`):
```json
{
  "success": true,
  "data": { ... }
}
```

### Error (`400`, `401`, `403`, `404`, `409`, `500`):
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Descriptive human-readable error explanation."
  }
}
```

---

## 2. Authentication & User Management

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Register a new user (`email`, `username`, `password`, `firstName`, `lastName`) |
| `POST` | `/auth/login` | Public | Authenticate user & return `{ accessToken, refreshToken, user }` |
| `POST` | `/auth/google` | Public | Authenticate with Google ID token (`idToken`); verifies token, links/provisions account & returns `{ accessToken, refreshToken, user }` |
| `POST` | `/auth/google/link` | Protected | Link verified Google account (`idToken`) to authenticated user's account |
| `POST` | `/auth/refresh` | Public | Issue new access token using valid `refreshToken` |
| `POST` | `/auth/logout` | Protected | Invalidate and revoke refresh token in database |
| `GET` | `/auth/me` | Protected | Retrieve authenticated user profile |

---

## 3. Financial Accounts & Dashboard

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/dashboard` | Protected | Consolidated financial metrics (balance, income, expense, health, recent tx) |
| `GET` | `/accounts` | Protected | List all active bank/wallet/cash accounts |
| `POST` | `/accounts` | Protected | Create a new financial account |
| `GET` | `/accounts/:id` | Protected | Retrieve specific financial account details |
| `PATCH` | `/accounts/:id` | Protected | Update account name, type, or institution |
| `DELETE`| `/accounts/:id` | Protected | Deactivate / delete account |
| `POST` | `/accounts/:id/deposit` | Protected | Atomically credit funds and create corresponding income record. Accepts an optional `idempotencyKey` (see §3.1) |
| `POST` | `/accounts/deposit` | Protected | Deposit into the user's default account (created on demand inside the same transaction) |

### 3.1 Deposit idempotency

`POST /accounts/:id/deposit` and `POST /accounts/deposit` accept an **optional**
`idempotencyKey` in the body:

```json
{ "amount": 5000, "source": "Salary", "description": "July", "idempotencyKey": "dep-9f2c1a7b-…" }
```

- The key is 8–128 characters of `A-Z a-z 0-9 . _ : -`. Anything else is `400 VALIDATION_ERROR`.
- The key identifies **one logical deposit**. The client generates it once and reuses it for every retry of that deposit.
- The first request creates the credit, the ledger row and an `idempotency_records` entry (primary key `userId, scope, key`). Every later request with the same key **and the same deposit details** returns the **original** `transactionId` with `replayed: true`, plus `originalAmount` / `formattedOriginalAmount`, and does **not** credit the account again. Its `message` says the deposit was already applied; it never claims that funds were added.
- The details that identify a deposit are the target `accountId`, `amount`, requested `date`, `source` and `description`. A retry must resend the same values. Reusing a key with any different value returns **`409 IDEMPOTENCY_CONFLICT`**, writes no ledger row and does not change the balance. Use a new key for a new deposit.
- An omitted `date` is treated as "server default" and is not resolved to a calendar date for identity purposes, so a retry after midnight still replays.
- A concurrent request that loses the race converges on the same original transaction when the payload matches; a concurrent request with conflicting details gets `409`.
- The key is scoped to the user: two users may use the same value.
- **Without a key the behaviour is unchanged** — every request is a new deposit. The key is opt-in.

The guarantee is enforced by the database (a primary key), not by application logic alone.

### 3.2 Account categories

`accountType` accepts one of these stable values:

| Group | Values |
|---|---|
| Bank / deposit | `BANK`, `SAVINGS`, `CURRENT` |
| Cash-like | `CASH`, `CASH_WALLET`, `CASH_IN_HAND`, `WALLET` |
| Card / other | `CREDIT_CARD`, `OTHER` |

- `POST /accounts` defaults to `BANK` when `accountType` is omitted.
- `PATCH /accounts/:id` leaves the stored category unchanged when `accountType` is omitted.
- An unknown category returns `400 VALIDATION_ERROR`; the request is not written.
- Values are trimmed and upper-cased, so `" cash_wallet "` is accepted as `CASH_WALLET`.
- `CASH_WALLET` and `CASH_IN_HAND` are asset accounts. They are included once in `totalBalance` and never create a second ledger entry. The existing `CASH` and `WALLET` values are unchanged for stored rows.
- Cash-like categories do not require `accountNumberMasked`. Sending an empty string on `PATCH` clears a previously stored mask.

---

## 4. Transactions & Budgets

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/transactions` | Protected | Query transactions with pagination, date, category & type filters |
| `POST` | `/transactions` | Protected | Record a new transaction (automatically updates account balance) |
| `GET` | `/transactions/:id` | Protected | Retrieve single transaction |
| `PATCH` | `/transactions/:id` | Protected | Update transaction details |
| `DELETE`| `/transactions/:id` | Protected | Delete transaction (reverses account balance effect automatically) |
| `POST` | `/transactions/voice` | Protected | Parse natural language voice string to transaction fields |
| `GET` | `/budgets` | Protected | Retrieve category budgets for specific month and year |
| `POST` | `/budgets` | Protected | Create category monthly spending limit |
| `PATCH` | `/budgets/:id` | Protected | Update budget limit |
| `DELETE`| `/budgets/:id` | Protected | Delete budget |

### 4.1 Transaction contract

`POST /transactions` accepts `amount` (positive), `type` (or the legacy
`transactionType`), `category`, `accountId`, `toAccountId`, `description`,
`merchant`, `notes`, `date` (`YYYY-MM-DD`), and `paymentMethod`. `type` must be
one of `INCOME`, `EXPENSE`, `TRANSFER`, `INVESTMENT`, `LOAN_PAYMENT`; an unknown
value is `400 VALIDATION_ERROR`. It defaults to `EXPENSE` when omitted.

- A non-transfer row affects one account: `INCOME` credits it, every other
  type debits it. When `accountId` is omitted the oldest active account is used,
  matching the pre-existing behaviour.
- `toAccountId` is valid **only** for a `TRANSFER`; supplying it for any other
  type is `400 VALIDATION_ERROR`. A transfer also requires a source account,
  a destination account, and two distinct accounts owned by the caller.
  Missing values are `400`; a destination owned by another user is `404`
  (the endpoint does not reveal that the account exists).
- A transfer writes exactly two balance legs, source debit and destination
  credit, inside the same database transaction as the row. It is never counted
  as income or expense by dashboard, budget, AI, or export aggregates.
- The response includes `toAccount` (the destination account name) and, for a
  transfer, a destination-aware `message`.
- **Insufficient Funds Enforcement:** All debit transactions (`EXPENSE`, `TRANSFER`, `INVESTMENT`, `LOAN_PAYMENT`) verify available account balance prior to mutation. If the debit amount exceeds the account's current balance, the request is rejected with HTTP `400 INSUFFICIENT_FUNDS` (`{ success: false, error: { code: 'INSUFFICIENT_FUNDS', message: '...' } }`). `CREDIT_CARD` accounts are exempt from insufficient-funds rejection (reflecting revolving credit limits). Incoming transactions (`INCOME`, `REFUND`) are never blocked. Transaction updates via `PATCH /transactions/:id` similarly enforce that net increases in debits do not overdraft the account.

A transfer accepts an optional `idempotencyKey`: 8–128 characters from
`A–Z a–z 0–9 . _ : -`. The key is scoped to the authenticated user and the
`account_transfer` scope, so one user's key can never expose another user's
transaction. The server claims the key in the **same database transaction** as
the transfer row, the source debit and the destination credit:

- a new keyed transfer returns `201` and `data.replayed` is `false`;
- a retry with the same key and an equivalent payload returns `200`, the
  **original** `transactionId`, `data.replayed: true`, and applies no ledger
  effect;
- reusing the key with a different payload returns `409
  IDEMPOTENCY_CONFLICT` and writes nothing;
- concurrent identical requests converge on one transfer (one `201`, the rest
  replay `200`); concurrent conflicting requests produce one winner and `409`s;
- if the original transfer was deleted, the key remains claimed and a retry
  returns `409 IDEMPOTENCY_CONFLICT`; it is never recreated;
- if the transaction rolls back, the key claim rolls back too, so a corrected
  retry may reuse the key;
- a key on a non-transfer is `400 VALIDATION_ERROR`; a malformed key is also
  `400 VALIDATION_ERROR`.

The key is optional, so keyless transfers keep the previous API shape. The
fingerprint includes the resolved source and destination accounts, the
canonical two-decimal amount, type `TRANSFER`, trimmed category, description,
merchant and notes, payment method, and the requested date (`null` when
omitted). Clients must reuse one key for every retry of the same transfer and
generate a new key for a new transfer.

`PATCH /transactions/:id` is a partial update. Omitted fields keep their stored
value, including `toAccountId`. A row cannot be converted **to or from**
`TRANSFER` through `PATCH` (`400 VALIDATION_ERROR`); delete the row and create a
new one. When an amount, source, or destination changes, the server reverses the
stored ledger effect and applies the new one atomically, so no intermediate
balance is observable. Deleting a transaction reverses every leg that was
originally applied.

`GET /transactions` accepts `page`, `limit`, `type`, `category`, `startDate`,
`endDate`, and `search`:

- `page` is an integer `>= 1` and defaults to `1`; an invalid value is
  `400 VALIDATION_ERROR`.
- `limit` is an integer from `1` to `100` and defaults to `20`; an invalid value
  is `400 VALIDATION_ERROR`. Callers must paginate rather than assume a full
  result set.
- `type` is validated against the same set as create; an unknown value is
  `400 VALIDATION_ERROR` rather than an empty page.
- The response is
  `data.transactions[]` plus `data.pagination { page, limit, total, totalPages }`;
  each row carries `toAccount` (`null` unless a destination is stored).

---

## 5. Investments & Real-Time Market

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/investments/portfolio` | Protected | Portfolio value, cost basis, total P&L, and asset holdings |
| `POST` | `/investments/buy` | Protected | Record buy transaction / increment asset holding |
| `PATCH` | `/investments/:id` | Protected | Update holding quantity or average buy price |
| `DELETE`| `/investments/:id` | Protected | Liquidate / delete holding |
| `GET` | `/market/quote?symbol=...` | Protected | Real-time stock quote from Alpha Vantage / Finnhub |
| `GET` | `/market/history?symbol=...&timeframe=1M` | Protected | Multi-timeframe OHLCV chart history (1D, 1W, 1M, 3M, 6M, 1Y, 5Y) |
| `GET` | `/market/metals` | Protected | 24K & 22K Gold and Silver spot rates in INR |
| `GET` | `/market/gold` | Protected | Dedicated 24K and 22K Gold rates |
| `GET` | `/market/silver` | Protected | Dedicated Silver rates |
| `GET` | `/market/dashboard` | Protected | Aggregated live stocks, metals, USD/INR FX, and crude oil feed |
| `GET` | `/market/technicals?symbol=...` | Protected | RSI, MACD, SMA 20/50, and Bollinger Bands indicators |
| `GET` | `/market/overview?symbol=...` | Protected | Company fundamentals (P/E, EPS, Beta, 52W range) |
| `GET` | `/market/earnings?symbol=...` | Protected | Quarterly reported vs estimated EPS earnings |
| `GET` | `/market/fx?from=USD&to=INR` | Protected | Real-time foreign exchange conversion rate |
| `GET` | `/market/commodity?type=WTI` | Protected | Global commodity price (WTI, Brent, Copper, Natural Gas) |
| `GET` | `/market/news` | Protected | Live financial market headlines |
| `GET` | `/market/watchlist` | Protected | User's tracked stocks with real-time valuation |
| `POST` | `/market/watchlist` | Protected | Add symbol to watchlist |
| `DELETE`| `/market/watchlist/:symbol`| Protected | Remove symbol from watchlist |
| `GET` | `/market/metals/status` | Protected | Precious-metals provider/cache status and data availability |
| `GET` | `/market/metals/pune` | Protected | Derived, indicative Pune retail gold/silver reference |

### 5.1 Market data availability

`GET /market/metals/status` reports the configured provider, whether cached data
exists, cache age, freshness, the last provider timestamp, supported metals and
units, and the fresh/stale cache TTLs. `dataStatus` is one of `LIVE`, `CACHED`,
`STALE` or `UNAVAILABLE`:

- `LIVE` — a verified provider observation from an open exchange session.
- `CACHED` — last verified observation, still within the fresh cache window.
- `STALE` — last verified observation older than the fresh window; the response
  flags it as stale rather than presenting it as live.
- `UNAVAILABLE` — no live or cached quote. The response is an explicit
  unavailable state, not mock data.

### 5.2 Pune retail metals (derived)

`GET /market/metals/pune` returns `selection_status: "DERIVED_INDICATIVE"` and
`is_live_provider_quote: false`. It is computed from the existing precious-metals
and USD/INR feed using the landed-import parity assumptions exposed in
`tariff_and_tax_breakdown`; it is not a dealer quote. No additional market-data
credential is required. The response carries `data_status`, `provider`,
`timestamp`, `usdToInr`, and per-karat bullion/jewellery rates in INR.

---

## 6. Loans, Goals, Protection & Calendar

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/loans` | Protected | List active debt obligations and total outstanding balance |
| `POST` | `/loans` | Protected | Create loan record |
| `POST` | `/loans/calculate-emi` | Protected | Calculate standard reducing-balance monthly EMI |
| `POST` | `/loans/prepayment-simulate` | Protected | Simulate interest savings and tenure reduction on lump-sum prepayment |
| `GET` | `/goals` | Protected | List financial goals and progress |
| `POST` | `/goals` | Protected | Create new savings goal |
| `PATCH` | `/goals/:id/contribute` | Protected | Add funds to a goal |
| `GET` | `/insurance` | Protected | List insurance policies + aggregate `summary` (totals include inactive rows — see `PARITY.md` §8.1) |
| `POST` | `/insurance` | Protected | Create insurance policy |
| `GET` | `/insurance/:id` | Protected | Fetch one policy |
| `PATCH` | `/insurance/:id` | Protected | Update a policy |
| `DELETE` | `/insurance/:id` | Protected | Delete a policy |
| `GET` | `/subscriptions` | Protected | List subscriptions + aggregate `summary` (same inactive-row caveat) |
| `POST` | `/subscriptions` | Protected | Add recurring subscription |
| `GET` | `/subscriptions/:id` | Protected | Fetch one subscription |
| `PATCH` | `/subscriptions/:id` | Protected | Update a subscription |
| `DELETE` | `/subscriptions/:id` | Protected | Delete a subscription |
| `GET` | `/calendar/events?month=10&year=2026` | Protected | Month view: user events **plus** derived EMI / subscription / goal events |
| `POST` | `/calendar/events` | Protected | Create a custom event — body `{ title, description?, eventType?, eventDate, amount?, color? }` |
| `PATCH` | `/calendar/events/:id` | Protected | Update a custom event |
| `DELETE` | `/calendar/events/:id` | Protected | Delete a custom event (derived events have no row to delete) |
| `GET` | `/notifications` | Protected | List notifications for the user |
| `POST` | `/notifications` | Protected | Create a notification |
| `PATCH` | `/notifications/:id/read` | Protected | Mark one notification read |
| `POST` | `/notifications/read-all` | Protected | Mark every notification read |
| `DELETE` | `/notifications/:id` | Protected | Delete a notification |

---

## 7. AI Advisor, Intelligence & Simulations

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/ai/chat` | Protected | Chat with the assistant (Gemini tool-calling → deterministic engine → RAG). Mutations return `pendingConfirmation`; see `AI.md` |
| `POST` | `/ai/actions/confirm` | Protected | Confirm or cancel a pending AI action (`{ token, decision }`); token is one-time, user-bound and expires |
| `GET` | `/ai/history` | Protected | Retrieve the **most recent 50** messages, oldest-first |
| `GET` | `/ai/insurance-review` | Protected | Rules-based life/health cover review (no LLM in this path) |
| `DELETE`| `/ai/history` | Protected | Clear conversation history |
| `GET` | `/ai/financial-health` | Protected | 10-Factor AI Health Score (0-100) and actionable breakdown |
| `GET` | `/ai/cash-flow?days=30`| Protected | Daily balance prediction and liquidity projection |
| `GET` | `/ai/anomalies` | Protected | Unusual expense detection records |
| `PATCH` | `/ai/anomalies/:id/feedback` | Protected | Submit feedback on detected anomaly (CONFIRMED_NORMAL / SUSPICIOUS) |
| `GET` | `/ai/budget-optimize` | Protected | Smart 50/30/20 budget allocations based on spending habits |
| `GET` | `/ai/risk-radar` | Protected | Financial risk assessment across debt, emergency fund, and insurance |
| `POST` | `/ai/simulate` | Protected | What-if scenario analysis (salary hike, major purchase, loan prepayment) |
| `POST` | `/ai/retirement-plan`| Protected | Compound interest retirement corpus projection |
| `GET` | `/ai/goals/:id/forecast`| Protected | Estimated completion date and acceleration scenarios for a goal |
| `POST` | `/ai/voice-intent` | Protected | Natural language voice intent classifier |

### 7.1 AI actions require out-of-band confirmation

A chat message is not consent. `/ai/chat` may return:

```json
{
  "pendingConfirmation": true,
  "confirmation": {
    "token": "64-hex-chars",
    "toolName": "create_transaction",
    "description": "Create a transaction: Coffee · ₹500",
    "expiresAt": "2026-10-21T12:05:00.000Z",
    "ttlSeconds": 300
  },
  "action": { "executed": false, "requiresConfirmation": true }
}
```

Apply or cancel it with:

```http
POST /api/v1/ai/actions/confirm
Content-Type: application/json

{ "token": "<token>", "decision": "CONFIRM" }
```

- `CONFIRM` executes the exact tool + arguments bound to the token and returns `{ executed: true, executionState: "COMPLETED", retryable: false, response }`.
- `CANCEL` marks the proposal cancelled and executes nothing (`executionState: "CANCELLED"`).
- Tokens are stored hashed, expire after 5 minutes by default, and are single-use.

**Execution states (Phase 4).** A proposal moves through one state machine, and a
consumed token is never returned to a runnable state:

| State | Meaning |
|---|---|
| `PENDING` | Prepared, waiting for the user. Not executed. |
| `EXECUTING` | Claimed by a request; the mutation is running. |
| `COMPLETED` | The mutation succeeded. Terminal. |
| `FAILED` | The mutation did not complete. Terminal — not retryable. |
| `CANCELLED` / `EXPIRED` | Discarded by the user / timed out. Terminal. |

Every error response carries `executionState` and `retryable` so a client can
tell "not started" from "already done" from "outcome unknown":

| HTTP | `code` | `executionState` | `retryable` | Meaning |
|---|---|---|---|---|
| `400` | `INVALID_ACTION_TOKEN` | — | — | Missing or malformed token. |
| `404` | `ACTION_NOT_FOUND` | — | — | Unknown token, or another user's token. |
| `409` | `ACTION_IN_PROGRESS` | `EXECUTING` | `false` | Another request already claimed it. Do not retry. |
| `409` | `ACTION_ALREADY_COMPLETED` | `COMPLETED` | `false` | It already ran. It will not run again. |
| `409` | `ACTION_ALREADY_FAILED` | `FAILED` | `false` | It failed earlier. Prepare a new request. |
| `409` | `ACTION_ALREADY_CANCELLED` | `CANCELLED` | `false` | It was cancelled. |
| `410` | `ACTION_EXPIRED` | `EXPIRED` | `false` | The 5-minute window elapsed. |
| `422` | `ACTION_REJECTED` | `FAILED` | `false` | The tool rejected the request (e.g. invalid amount). |
| `500` | `ACTION_OUTCOME_UNKNOWN` | `FAILED`/`EXECUTING` | `false` | The write failed mid-flight. Check the ledger before preparing a new request. |
| `503` | `ACTION_START_UNAVAILABLE` | `PENDING` | `true` | The action never started (e.g. the database was unreachable). Safe to retry the same token. |

- Only `503 ACTION_START_UNAVAILABLE` may be retried with the same token, and
  only because the mutation provably did not start. Every other failure is
  terminal.
- Concurrency: claiming a proposal is a single conditional `UPDATE` from
  `PENDING`, so simultaneous confirmations produce exactly one execution.
- Only one mutating action is proposed per assistant turn.

### 7.2 Read-only action status

```http
POST /api/v1/ai/actions/status
Content-Type: application/json

{ "token": "<token>" }
```

Reports the current state of a proposal **without changing it**. It exists for
one situation: the client sent a confirmation and the network dropped the
answer, so the client cannot know whether the mutation was applied. The token
travels in the body (never in a URL) and is only accepted for its owner.

```json
{
  "success": true,
  "data": {
    "toolName": "create_transaction",
    "description": "Create a transaction: Coffee · ₹500",
    "status": "COMPLETED",
    "executionState": "COMPLETED",
    "executed": true,
    "applied": true,
    "retryable": false,
    "outcomeKnown": true,
    "expiresAt": "2026-10-22T12:05:00.000Z",
    "createdAt": "2026-10-22T12:00:00.000Z",
    "resolvedAt": "2026-10-22T12:00:01.000Z",
    "result": "Recorded EXPENSE of ₹500.00 …"
  }
}
```

| Field | Meaning |
|---|---|
| `applied` | The mutation **was** applied. The client must not offer a retry. |
| `retryable` | The mutation provably never started, so the same token may be confirmed again. Only `true` while the proposal is still `PENDING` and unexpired. |
| `outcomeKnown` | `false` only while the action is still `PENDING`/`EXECUTING` (the outcome is not yet decided). |

The web client uses this to resolve a dropped response honestly: it reports
"already applied", "not applied — safe to confirm again", or the terminal
state, instead of guessing.

---

## 8. OCR Scanner, Bank Import & Exports

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/receipts/scan` | Protected | Extract merchant, amount, category and line items from receipt text |
| `POST` | `/receipts/confirm` | Protected | Commit extracted receipt transaction to database |
| `POST` | `/import/bank-statement` | Protected | Parse CSV bank statement and identify valid vs duplicate rows |
| `POST` | `/import/confirm` | Protected | Batch import verified bank statement rows into account |
| `GET` | `/export/transactions.csv` | Protected | Export user transactions as downloadable CSV |
| `GET` | `/export/summary.csv` | Protected | Export consolidated financial summary CSV |

---

## 9. Mobile Synchronization & Bank SMS Detection

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/mobile/register-device` | Protected | Register/update Android device metadata (`deviceId`, `platform`, `model`, `appVersion`, `smsDetectionEnabled`) |
| `GET` | `/mobile/sync-state` | Protected | Fetch client sync state, server timestamp, pending SMS count, and account balance checksums |
| `POST` | `/sms/ingest` | Protected | Ingest and parse single bank SMS alert (`messageText`, `sender`, `timestamp`, `deviceId`) |
| `POST` | `/sms/batch-ingest` | Protected | Batch ingest bank SMS alerts with per-item idempotency and atomic duplicate prevention |
| `GET` | `/sms/pending` | Protected | Fetch candidate transactions pending user review and confirmation (`status=PENDING`) |
| `POST` | `/sms/pending/:id/confirm` | Protected | Confirm pending candidate into canonical ledger (`FinancialTransaction` + atomic account balance update) |
| `POST` | `/sms/pending/:id/reject` | Protected | Reject pending SMS candidate without mutating account balance |
| `POST` | `/sms/parse-preview` | Protected | Stateless preview parser for debugging regex extraction without database mutation |



---

## 10. Financial Data Contract

These conventions are shared by both clients. Violating them is how web/mobile drift starts.

### 10.1 Money

- Prisma `Decimal` fields are serialised as JSON **numbers**, not strings, and are accompanied by a pre-formatted `formatted*` string on aggregate responses (`formattedTotalCoverage`, `formattedMonthlyTotal`, `formattedAmount`, …).
- Clients must render the server's formatted string when it exists. Local formatting is a fallback only, because the server is the single source of Indian digit grouping (`₹1,23,456`).
- No endpoint accepts a computed balance from the client. Balance changes happen through ledger operations (transaction, deposit, transfer, loan payment), each recomputed server-side inside a DB transaction.

### 10.2 Percentages

Ratios arrive already multiplied by 100 (`savingsRate: 24.5` means 24.5%). Apps append `%` and must never multiply again. `savingsRate` is `0`, not `null`, when income is zero.

### 10.3 Date vs instant

| Kind | Fields | Wire format |
|---|---|---|
| Calendar date | `Transaction.date`, `Goal.targetDate`, `Loan.startDate`, `InsurancePolicy.renewalDate`, `Subscription.nextBillingDate`, `CalendarEvent.eventDate`, `FinancialTask.dueDate`, `PaymentCard.dueDate` | `YYYY-MM-DD` |
| Instant | `createdAt`, `updatedAt`, proposal `expiresAt`/`resolvedAt` | ISO-8601 with `Z` |

Sending a UTC midnight instant for a date-only field can shift the displayed day for clients in negative-UTC-offset timezones. Clients send `YYYY-MM-DD`; the server parses it to UTC midnight for `@db.Date` and serializes the UTC date portion back to `YYYY-MM-DD` (`utils/dateOnly.js`). Impossible dates (e.g. `2026-02-31`) are rejected with `400 VALIDATION_ERROR` instead of rolling over.

Month windows ("this month" on the dashboard, AI context and RAG aggregates) use the **Asia/Kolkata calendar**, not the server's local timezone, so a UTC instant late on the last day of a month cannot leak into the next month. See `PARITY.md` §8.2 for the residual derived-event caveat.

### 10.4 Errors

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Amount must be a positive number." } }
```

Clients display `error.message` for 4xx. For 5xx they should show a generic message; mobile intentionally suppresses 5xx detail.

### 10.5 Pagination

List endpoints that paginate accept `page` and `limit` and return `pagination: { page, limit, total, totalPages }` (or `hasMore` where the mobile infinite scroll is used). Clients must not assume a full dataset from a single page.

For transactions specifically, `page` must be an integer `>= 1` (`limit` bounded to `1..100`, default `20`). Invalid `page`, `limit`, or `type` values return `400 VALIDATION_ERROR` instead of being silently coerced; see §4.1.

### 10.6 Idempotency

Only the endpoints that need it have it. **Deposits do** — both deposit endpoints accept an optional `idempotencyKey`; the contract is in §3.1 and the guarantee is a database primary key, not application logic. **Transfers do** — `POST /transactions` with `type: "TRANSFER"` accepts an optional key under the `account_transfer` scope; the contract is in §4.1. The key claim, the transaction row and both ledger legs commit or roll back together. Generic income/expense creation and loan payments still do not accept a key, so a retry of those can apply twice; `PARITY.md` §8.4 tracks the remaining follow-up. Any future money-moving endpoint must accept a client-generated key and return the original result on replay.

On a replay, clients should key off `transactionId` and `replayed`; the human-readable `message` is not part of the idempotency contract. The server still guarantees that the replay message describes the original amount and never claims that new funds were moved. A `409 IDEMPOTENCY_CONFLICT` means the key was already used for different details (deposit or transfer, depending on the endpoint); generate a new key rather than retrying the old one.
