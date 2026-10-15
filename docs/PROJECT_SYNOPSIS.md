# Project Synopsis — Fin_AI Personal Financial Planner (FinPro / Jinay Finance AI)

---

## 1. Problem Statement

Keeping track of personal finances across multiple accounts, budgets, investments, loans,
credit cards, insurance policies and subscriptions is fragmented and manual. Existing tools either
lock users into foreign (non-INR) markets, show generic advice detached from the user's actual data,
or present fake/demo figures that mislead financial decisions.

This project builds a single, self-hosted **personal financial intelligence platform for the Indian
market (INR ₹)** that consolidates the user's entire financial life into one dashboard and pairs it
with a **grounded AI advisor** that reasons only over the user's real, verified records — never
hallucinated balances.

---

## 2. Objectives

1. Consolidate all personal finance domains into a single weekly/daily dashboard:
   accounts, transactions, budgets, goals, investments, loans, credit cards, insurance,
   subscriptions and financial-calendar events.
2. Deliver **real, live market data** for the Indian investor: NSE/BSE stocks, 24K/22K Gold,
   Silver, FX and Crude/Commodities — with an explicit **zero-fake-data** policy.
3. Provide an **AI financial advisor** grounded in the user's own database records, with a
   deterministic, rule-based expert fallback that works even when no AI key is configured.
4. Ensure **security and tenant isolation** (JWT access + refresh tokens, per-user data
   separation, rate limiting, auditable exports).
5. Pass a complete, repeatable QA gate (integration, security, and live market suites) and
   ship reproducible deployment (`.env`, Docker, docs).

---

## 3. Scope

### In Scope
- Full-stack web application: REST API + single-page application (SPA).
- PostgreSQL persistence with a structured 22-model schema.
- Live market feeds with caching and provider fallback (Alpha Vantage → Finnhub → MCX).
- AI advisor (Gemini) with offline deterministic fallback.
- Voice assistant input (Web Speech API) and OCR receipt parsing.
- CSV export engine with tenant isolation.
- Authentication: email/password (bcrypt) + refresh-token revocation.
- QA: master integration suite, auth/security suite, and live market verification suite.

### Out of Scope
- Payment processing / real bank/credit-card API integration (data is user-entered).
- Mobile apps (web SPA only).
- High-frequency trading or automated order execution.
- Legacy Django backend (quarantined, not part of the active system).

---

## 4. Target Users

- Indian students, salaried professionals and young earners managing INR finances.
- Users who want a single consolidated view and AI guidance grounded in their own numbers.
- Self-hosting users who care about data ownership and transparency of data sources.

---

## 5. Technology Stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js 20+ (v22 verified), Express 4.21 |
| Database | PostgreSQL 17 (`finance_jinay` at `127.0.0.1:5432`), Prisma ORM 5.22 |
| Data model | 22 structured Prisma models, `Decimal(15,2)` monetary / `Decimal(15,6)` fractional assets, compound indexes, cascade deletes |
| Frontend | Vanilla JS SPA (HTML5/CSS3), ECharts visualisations, RemixIcons |
| AI | Google Gemini — default `gemini-2.5-flash`, fallbacks `gemini-1.5-flash` → `gemini-1.5-pro` → `gemini-pro`; rule-based expert fallback when unconfigured |
| Market data | Alpha Vantage (primary) + Finnhub (fallback) + MCX; TTL-cached |
| Auth | JWT access + refresh, bcryptjs, token revocation |
| Voice | Web Speech API (Chrome, Edge, Safari) + backend intent parser |
| OCR | Client-side image processing + backend parser with user confirmation |
| API | REST under `/api/v1`, base `http://127.0.0.1:5001/api/v1`, Bearer auth, standard `{ success, data }` / `{ success, error:{code,message} }` envelope |

---

## 6. Architecture

```
Vanilla JS SPA (frontend/public)
      │  fetch → api.js (client) — Bearer token
      ▼
Node.js / Express backend (node-backend, port 5001)
  ├── routes/index.js ───────────► controllers (auth, investment, market, ...)
  ├── marketService.js ──────────► Alpha Vantage → Finnhub → MCX (TTL cache)
  ├── aiService / advisor ───────► Gemini cascade → deterministic rule engine (DB-grounded)
  ├── authController.register ───► atomic: User + Profile + FinancialProfile + Primary Account
  └── Prisma Client ─────────────► PostgreSQL 17 (finance_jinay, 22 models)
```

- DB context is injected into AI prompts; the advisor only answers from the user's real records.
- Market cards show transparent source + unit + status badge (`LIVE | CACHED | STALE | UNAVAILABLE`).
- The legacy Django prototype has been removed; `node-backend/` is the single active backend.

---

## 7. Core Features

1. **Consolidated dashboard** with health scores (`financial_health_history`), spending analytics and monthly summaries.
2. **Accounts & transactions** with categorization and compound-index queries by user/date/type.
3. **Budgets** keyed uniquely by `user + category + month + year`, with over-budget alerts.
4. **Goals & savings planning** with progress tracking.
5. **Investments** portfolios keyed uniquely by `portfolio + symbol`; live quotes, multi-timeframe charts.
6. **Loans, credit cards, insurance, subscriptions** and a **financial calendar** (`calendar_events`).
7. **AI financial advisor (FinPro)**: grounded in user DB records; Gemini cascade with deterministic rule-based fallback.
8. **Live market feeds**: NSE/BSE stocks (e.g. `RELIANCE.NS`), COMEX Gold/Silver futures converted to INR, FX, Crude & Commodities — zero fake data.
9. **What-if simulator**: scenario projections over the user's real numbers.
10. **Voice assistant** (Web Speech API + intent parser) and **OCR receipt capture** with user confirmation.
11. **Authenticated CSV exports**: stream-based, 9 export types, tenant-isolated.
12. **Messaging/notifications** on budgets, goals and health signals.

---

## 8. Market Data Engine & Zero-Fake-Data Policy

- **No `Math.random()`**, no hardcoded prices, no synthetic sine-curve historical charts, anywhere.
- Provider order: **Alpha Vantage (primary)** → **Finnhub (fallback)** → **MCX**, with INR reference pricing.
- TTL caching in `marketService.js`:
  - Live Quotes: 3 min
  - Multi-Timeframe Charts: 15 min
  - Company Overview / Fundamentals: 1 hour
  - Commodities & Metals: 5 min
- When a provider is unavailable, APIs return `{ points: [], data_status: 'UNAVAILABLE' }` instead of fabricated values.
- Every market card displays its **source badge** and **unit**, so the user always knows the provenance of a number.
- Alpha Vantage free-tier limits: **25 requests/day, 5 requests/minute** (documented in `KNOWN_LIMITATIONS.md`).

---

## 9. Security

- JWT **access + refresh** tokens, refresh-token **revocation** on logout.
- **bcrypt** password hashing for first-party email + password authentication.
- **Tenant isolation**: all queries scoped to the authenticated user; cross-user access returns 404.
- **Rate limits**: 200 req / 15 min global; 20 req / 15 min on auth routes.
- **Atomic registration**: one transaction creates User, Profile, FinancialProfile and Primary Account.
- Audit logging across critical actions.

---

## 10. QA & Verification Evidence

| Suite | Result |
| --- | --- |
| Master Integration & Acceptance Suite (`run-all-tests.js`) | **66 / 66 passed** |
| Auth & Security Audit Suite (`test-auth-comprehensive.js`) | **40 / 40 passed** |
| Live External Market Data Suite (`test-market-live.js`) | **6 / 6 subsystems verified** |
| Full QA run reported in `final-qa-report.md` (FinPro) | **122 passed / 0 failed** |

- `GET /api/v1/health` returns `database connected` with **~4 ms** latency.
- Registration edge cases verified: duplicate email → **409**, invalid password → **401**, tenant isolation → **404**.
- Run with: `cd node-backend && node run-all-tests.js` (details in `TESTING.md`).

---

## 11. Known Limitations

- **Alpha Vantage free tier**: 25 requests/day, 5 per minute — mitigated by TTL caching and Finnhub fallback.
- **Gemini**: no key configured = offline mode; advisor becomes a deterministic rule-based expert system over real DB numbers.
- **Third-party SSO**: not supported; authentication is limited to email + password.
- **Voice input**: Web Speech API supported on Chrome, Edge and Safari only.
- Market history for some instruments resolves to `UNAVAILABLE` rather than fabricated data by design.

---

## 12. Deployment

**Requirements:** Node.js 20+, npm 10+, PostgreSQL 15+ (17 recommended).

1. Clone the repository.
2. Copy `.env.example` to `.env` in the repo root **and** in `node-backend/`.
3. Configure `DATABASE_URL` (default `postgresql://postgres:postgres2905@127.0.0.1:5432/finance_jinay?connection_limit=20&pool_timeout=15`), `JWT_SECRET`, `JWT_REFRESH_SECRET`, `GEMINI_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY`, `CURRENCY=INR`, `TIMEZONE="Asia/Kolkata"`.
4. `npm install` in `node-backend/`, apply Prisma migrations, and start the API (port 5001).
5. Serve `frontend/public/` (SPA) — either through the backend or a static server.

Full steps: `DEPLOYMENT.md`. API reference: `API.md`. Database spec: `DATABASE.md`.

---

## 13. Development Snapshot (as of latest review)

- Git `HEAD`: `fba6652 — feat(release): master engineering stabilization, market verification and QA sign-off`.
- Backend live on port **5001**; PostgreSQL live on **5432** (`finance_jinay`).
- `.env` present in root and `node-backend/`; `node_modules` installed.
- Test suites and live-market verification scripts are present and runnable.