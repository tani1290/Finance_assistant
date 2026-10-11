# FinPro — Personal Finance & Investment Decision Support Platform

## Project Report

> **Created by Students of VU** — Final Year Project
> Project Lead: Jinay Golecha | Report baseline: release commit `fba6652`

---

## 1. Introduction

Managing personal finances today is a fractured exercise. Users juggle a bank account, an equity portfolio, digital gold and physical bullion, a home or vehicle loan, several credit cards, and one or more insurance policies across separate applications and statements. None of those applications talk to each other, and few present a single, trustworthy picture of where a user stands financially.

This fragmentation produces three recurring problems:

1. **Generic, unaudited financial metrics.** Most tools report pre-computed scores and figures without a transparent source, so users cannot tell whether a number is a real valuation or a rough placeholder.
2. **Disjointed visibility.** Balances, liabilities, premiums, and market positions live in separate silos, so there is no consolidated view of net worth or cash flow.
3. **Delayed market information.** Manual lookups of stock prices, gold/silver rates, and currency conversions go stale quickly and are error-prone.

**FinPro** addresses these problems with an integrated, full-stack personal finance and investment decision-support platform designed specifically for the **Indian financial ecosystem** — operating in INR (₹), with `en-IN` locale formatting and `Asia/Kolkata` timezone semantics. FinPro unifies account, transaction, investment, budget, goal, loan, insurance, and calendar data into a single financial "twin", and layers a grounded AI advisor and a real-time market data engine on top of that consolidated picture.

The platform was engineered around three pillars validated against the actual codebase and documentation:

- **A canonical single backend** (Node.js/Express) with PostgreSQL 17 via Prisma as the single source of truth.
- **An audited market engine** producing live NSE/BSE stock quotes and continuous COMEX precious-metals prices (Gold 24K/22K, Silver) converted to INR at live interbank FX — with **zero fabricated or synthetic data**.
- **Grounded AI decision support** in which Gemini generates financial health scores, cash-flow projections, what-if simulations, and budget optimization strictly from authenticated database records.

## 2. Objectives

The project set out to deliver the following objectives:

1. **Build a consolidated financial "twin"** — a single normalized model of accounts, transactions, investments, budgets, goals, loans, insurance, and financial calendar events for the user.
2. **Expose live, audited market data** — real-time NSE/BSE stock quotes and COMEX gold/silver prices converted to INR at live interbank exchange rates, with transparent source attribution and graceful degradation when external quotas are exhausted.
3. **Provide grounded AI decision support** — a 10-factor financial health score, 30/90-day cash-flow projections, what-if simulators, and budget optimization, all generated strictly from authenticated user records (never from synthetic inputs).
4. **Track financial obligations automatically** — credit-card monitoring, loan prepayment simulators, insurance renewal tracking, and financial to-dos so no liability is missed.
5. **Support multimodal input** — voice interaction (Web Speech API with a backend intent parser) and receipt/statement OCR (client-side image processing with a backend parser) for low-friction data entry.
6. **Ship a production-grade, tested system** — secure authentication (JWT + Google OAuth 2.0), Docker-based deployment, automated test harnesses, and GitHub Actions CI/CD.

## 3. Scope

### 3.1 In scope

- Account and transaction management with atomic balance syncing and transaction reversals.
- Dashboard KPIs (net worth, income, expenses, savings) built from live data.
- Investment and portfolio tracking with live mark-to-market valuation.
- Budget management with category constraints and an AI budget optimizer.
- Goal planning with forecasting.
- Loan tracking with detailed amortization / EMI math and prepayment simulators.
- Insurance policy and renewal tracking.
- Financial calendar with recurring-event support and obligation reminders.
- Market watchlists, real-time quotes, and multi-timeframe charts.
- AI-generated financial health score, cash-flow projections, and what-if simulations.
- Voice commands and OCR-based expense/receipt capture.
- CSV export engine with **9 export types** and strict tenant isolation.
- JWT access/refresh token auth, Google OAuth 2.0 SSO, and role isolation.

### 3.2 Out of scope

- Brokerage order execution / live trading (the platform is decision support, not an execution venue).
- Custom fine-tuning of the Gemini model (the project uses a documented model fallback cascade, not bespoke training).
- Out-of-the-box Google OAuth without operator-supplied credentials (placeholder credentials surface a configuration modal).
- Multilingual UI (the interface and India-domain formatting target English/`en-IN`).
- Client-side data privacy encryption at rest beyond JWT-auth and server-side access control.

## 4. Methodology

The project followed a **documentation-driven, layered** approach: research first, then architecture, implementation, audit, and release. Each layer was validated before the next began.

### 4.1 Research and literature survey

A literature survey (`lit_Survey/Literature_Survey.md`, 55 KB) and a presentation deck documenting the AI-in-finance landscape preceded implementation. The survey informed the decision to favor auditable, rule-plus-model decision support over opaque black-box scoring.

### 4.2 Layered technology architecture

The system is organized into four layers, all behind a single canonical backend:

```
Client (Vanilla JS, HTML5/CSS3, ECharts, RemixIcons)
   │  SPA → HTTPS/REST/JSON → Bearer JWT (auto refresh)
   ▼
API / Gateway (Node v20+ / Express v4.21; Helmet, CORS, rate limiters, compression, Morgan)
   │
   ├── Business Services
   │    ├── Financial Twin Engine (accounts, transactions, budgets, goals, loans, insurance)
   │    ├── Auth & Security Engine (bcrypt 10-round salt, JWT pairs, Google OAuth 2.0)
   │    ├── Market Aggregator (Alpha Vantage primary, Finnhub fallback, MCX spot, live FX)
   │    ├── AI Prompt & Rules Engines (Gemini + deterministic rule-based fallback)
   │    └── OCR & Voice Parsers
   │
   └── External Providers
        ├── Alpha Vantage ─ NSE/BSE stock quotes & charts
        ├── Finnhub ─ fallback quotes
        ├── Gemini AI ─ advice, health score, cash-flow, what-if, budget optimizer
        ├── Google OAuth 2.0 ─ SSO
        ├── Marketaux ─ finance news & sentiment
        ├── Exchange Rates ─ live USD→INR interbank FX
        └── MCX Spot Rates ─ gold/silver reference
   ▼
Data (Prisma ORM → PostgreSQL 17, database `finance_jinay`)
```

The client is a Vanilla JavaScript (ES6+) single-page application served statically by the Node backend at port **5001**. All data flows through `frontend/public/assets/js/api.js`, which centralizes Bearer JWT propagation and refresh, and unified handling of 401/403/404/422/500 responses, before reaching `node-backend/src/server.js` and `node-backend/src/app`.

### 4.3 Data model

- **PostgreSQL 17** via **Prisma 5.22** with **22 models** in `prisma/schema.prisma`.
- Monetary columns use `Decimal(15,2)`; fractional assets (e.g., gold in grams) use `Decimal(15,6)`.
- Cascading deletes keep the financial twin consistent; every child record is owned by a `User` root.
- Performance indexing: compound indexes on `transactions` (`[userId]`, `[userId,date]`, `[userId,transactionType]`), a unique constraint on `budgets` (`[userId,categoryName,month,year]`), unique `[portfolioId,symbol]` on `investments`, unique `[userId,symbol]` on `market_watchlist`, `[userId,eventDate]` on `calendar_events`, and `[userId,createdAt]` on `financial_health_history`.

### 4.4 AI integration strategy

AI is deliberately **context-grounded**: Gemini receives only authenticated, database-backed user records. This produces:

- A **10-factor financial health score** computed from live user data.
- **30/90-day cash-flow projections** extrapolated from real transaction history.
- **What-if simulators** (e.g., increase income, reduce category spending, accelerate loan payment).
- **Budget optimization** that reallocates category limits to stay within the budget envelope.

Default model is `gemini-2.5-flash` with a fallback cascade of `gemini-1.5-flash → gemini-1.5-pro → gemini-pro` for resilience. When the AI is offline or unconfigured, the system degrades to a **deterministic rule-based expert engine** (Net Worth, Emergency Fund adequacy, Debt-to-Income ratio, 50/30/20 budget breakdown) so the core experience never blocks on model availability.

### 4.5 Market data strategy

- **Primary source:** Alpha Vantage for NSE/BSE quotes and multi-timeframe charts.
- **Fallback:** Finnhub for stock quotes; verified INR reference prices for commodities/metals.
- **FX:** live interbank USD→INR conversion for gold/silver, which are sourced from COMEX (Gold 24K/22K, Silver) and normalized into INR (₹, `Asia/Kolkata`).
- **Tiering ultimate guarantee:** the engine produces **zero fake or synthetic curves** — every displayed value carries a transparent source badge.
- **Caching (in-memory TTL in `marketService.js`):** live quotes 3 min, multi-timeframe charts 15 min, company overview/fundamentals 1 hr, commodities/metals 5 min.
- **Known quota reality:** Alpha Vantage free tier allows ~25 requests/day and 5/min; when limits are hit, the engine switches to Finnhub or cached reference prices rather than inventing data.

### 4.6 Testing and QA

Four automated harnesses underpin the release:

| Harness | Coverage |
|---|---|
| `run-all-tests.js` | 66 assertions — core APIs and DB |
| `test-auth-comprehensive.js` | 40 assertions — auth flows and tenant isolation |
| `test-market-live.js` | 6 subsystems — live external APIs |
| `src/__tests__/api.test.js` (Jest) | integration tests |

Together they cover health/diagnostics, authentication, onboarding, atomic deposits and balance sync, dashboard KPIs, transaction CRUD and reversals, budgets and the AI optimizer, goals and forecasting, live stock/gold/silver quotes, portfolio valuation, and EMI math. QA sign-off is documented in `docs/FINAL_QA_REPORT.md`, `docs/PROJECT_AUDIT.md`, `docs/MARKET_DATA.md`, and `docs/CLOUD_COMPUTING.md`.

### 4.7 Development lifecycle and release

The project was delivered in three release milestones:

- `ad499c2` — authentication and market engine foundations.
- `4ff224c` — market data engine hardening and live-data verification.
- `fba6652` — **release**: engineering stabilization, market data verification, and QA sign-off.

The final state runs under Docker (root `Dockerfile` + `docker-compose.yml`) with GitHub Actions CI/CD.

## 5. Module Descriptions

### 5.1 Authentication & Security Engine

JWT-based session management with short-lived **access tokens** (`JWT_EXPIRES_IN=60m`) and long-lived **refresh tokens** (`JWT_REFRESH_EXPIRES_IN=7d`) issued with `jsonwebtoken`. Passwords are hashed with bcrypt (10-round salt). Google OAuth 2.0 provides SSO with a `/auth/google/callback` redirect. The `api.js` client layer transparently refreshes expired access tokens and translates HTTP 401/403/404/422/500 into consistent user-facing errors.

### 5.2 Financial Twin Engine

The core domain model: accounts (with atomic deposits and balance syncing), transactions (CRUD, categories, and reversals), budgets (unique per category/month/year), goals (with forecasting), loans (with full amortization and EMI math), insurance policies, and financial calendar events. All children cascade from a single `User` root, keeping the "twin" internally consistent.

### 5.3 Dashboard & Reporting

Live KPIs — net worth, income, expenses, savings — computed from database records, visualized with Apache ECharts and RemixIcons. A streaming CSV export engine produces **9 export types** with strict tenant isolation so each user only ever exports their own scoped data.

### 5.4 Market Data Engine

Live NSE/BSE quotes and charts (Alpha Vantage, Finnhub fallback), COMEX gold/silver converted to INR at live interbank FX, MCX spot references, and market watchlists with per-user uniqueness. Transparent source badges on every value; TTL caching to respect external quotas; verified reference prices as the last-resort fallback — never synthetic curves.

### 5.5 AI Advisor

Gemini, grounded strictly in authenticated DB records, drives the 10-factor financial health score, 30/90-day cash-flow projections, what-if simulators, and category budget optimization. A deterministic rule-based engine (Net Worth, Emergency Fund, Debt-to-Income, 50/30/20 breakdown) keeps the advisor functional when the model is offline or unconfigured.

### 5.6 Obligation Tracking

Credit-card monitoring, loan prepayment simulators, insurance renewal tracking, and financial to-dos with calendar reminders — ensuring recurring liabilities and expiring coverage are never missed.

### 5.7 Voice & OCR Input

Voice commands via the Web Speech API (Chrome/Edge/Safari) parsed by a backend intent parser; expense/receipt capture via client-side image processing (Tesseract OCR) with a backend extraction parser. Both reduce friction in capturing financial events.

### 5.8 Deployment & CI/CD

Docker and Docker Compose packaging, environment-driven configuration, and GitHub Actions CI/CD. Network-hardening middleware (Helmet, CORS, rate limiters, compression, Morgan) ships in the API gateway layer.

## 6. Known Limitations

1. **External API quotas:** Alpha Vantage's free tier (~25 req/day, 5 req/min) constrains live-data volume; mitigated by caching, Finnhub fallback, and verified reference prices.
2. **Cached rather than tick-level data:** in-memory TTL caching (3 min quotes, 15 min charts, 1 hr fundamentals) is intentionally not real-time streaming.
3. **AI availability:** advice and scoring depend on Gemini availability; offline/unconfigured setups run in deterministic rule-based mode.
4. **Browser requirements:** Web Speech API voice input requires Chrome, Edge, or Safari.

Full details: `docs/KNOWN_LIMITATIONS.md`.

## 7. Conclusion

FinPro consolidates the fragmented pieces of personal finance — bank balances, equity, bullion, loans, credit cards, and insurance — into a single, trustworthy financial picture tailored to the Indian ecosystem. By grounding both market data and AI advice in audited sources (live NSE/BSE/COMEX data with transparent attribution, and Gemini-generated insights strictly from the user's own records), the platform resolves the "generic metrics" and "delayed information" failures common to consumer finance tools.

The release (`fba6652`) demonstrates the full engineering lifecycle: a canonical Node/Express + PostgreSQL 17 architecture, a 22-model normalized schema, live market-data verification, grounded AI decision support, multimodal input, an obligation tracker, four automated test harnesses, Docker deployment, and CI/CD. The result is a tested, production-shaped decision-support platform that delivers a consolidated, real-time, evidence-based view of a user's finances and obligations.

---

*Report compiled from repository documentation (`README.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/DEPLOYMENT.md`, `docs/TESTING.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/PROJECT_AUDIT.md`, `docs/MARKET_DATA.md`, `docs/CLOUD_COMPUTING.md`) and the audited codebase at the `fba6652` release baseline.*