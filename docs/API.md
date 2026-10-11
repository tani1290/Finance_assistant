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
| `POST` | `/auth/refresh` | Public | Issue new access token using valid `refreshToken` |
| `POST` | `/auth/logout` | Protected | Invalidate and revoke refresh token in database |
| `GET` | `/auth/me` | Protected | Retrieve authenticated user profile |
| `POST` | `/auth/google/token` | Public | Authenticate or register using Google OAuth ID token |

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
| `POST` | `/accounts/:id/deposit` | Protected | Atomically credit funds and create corresponding income record |

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

---

## 6. Loans, Goals & Protection

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/loans` | Protected | List active debt obligations and total outstanding balance |
| `POST` | `/loans` | Protected | Create loan record |
| `POST` | `/loans/calculate-emi` | Protected | Calculate standard reducing-balance monthly EMI |
| `POST` | `/loans/prepayment-simulate` | Protected | Simulate interest savings and tenure reduction on lump-sum prepayment |
| `GET` | `/goals` | Protected | List financial goals and progress |
| `POST` | `/goals` | Protected | Create new savings goal |
| `PATCH` | `/goals/:id/contribute` | Protected | Add funds to a goal |
| `GET` | `/insurance` | Protected | List active life/health/vehicle insurance policies |
| `POST` | `/insurance` | Protected | Create insurance policy |
| `GET` | `/subscriptions` | Protected | List active recurring subscriptions |
| `POST` | `/subscriptions` | Protected | Add recurring subscription |

---

## 7. AI Advisor, Intelligence & Simulations

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/ai/chat` | Protected | Chat with Gemini AI advisor with verified user financial context |
| `GET` | `/ai/history` | Protected | Retrieve persisted chat conversation history |
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

