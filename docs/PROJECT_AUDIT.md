# Jinay Finance AI — Project Audit & Architecture Map (Phase 1)
**Project Owner:** Jinay Golecha (`jinay_golecha`)  
**Project Type:** AI-Powered Personal Finance & Investment Advisor (Final Year Engineering Project)  
**Date:** August 2026

---

## 1. Executive Architecture Summary

| Layer | Canonical Technology | Verification Status | Notes |
|---|---|---|---|
| **Backend** | Node.js (v20+) + Express (v4.21) | ✅ Active (Port 5001) | Single canonical RESTful API (`/api/v1/...`) |
| **ORM / Database** | Prisma ORM (v5.22) + PostgreSQL 17 | ✅ Connected & Verified | Schema in `prisma/schema.prisma`, 22 DB models |
| **Authentication** | JWT (Access + Refresh Token) + Google OAuth | ✅ Fully Integrated | User isolation, bcrypt password hashing, token revocation |
| **Frontend** | Vanilla JS SPA / HTML5 / CSS3 / ECharts / RemixIcons | ✅ Active | Static files served from `frontend/public/` |
| **AI Advisor** | Google Gemini (`gemini-2.5-flash` / `gemini-1.5-flash`) | ✅ Integrated with DB context | Factual financial context + rule-based fallback |
| **Market Data** | Alpha Vantage (Primary) + Finnhub (Fallback) + MCX | ✅ Live Streaming & Cached | Real-time stocks, 24K/22K Gold, Silver, FX, Crude, Commodities |
| **Voice Interface** | Web Speech API + Backend Intent Parser | ✅ Working | Intent classification + safety confirmation |
| **OCR Scanner** | Client Image Processing + Backend Parser | ✅ Working | Receipt entity extraction + user confirmation before persistence |
| **Exports** | Stream-based CSV Engine | ✅ Authenticated (Bearer & Token) | 9 export types with tenant isolation |

---

## 2. Dependency Flow & Architecture Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND SPA (HTML5 / JS)                         │
│   dashboard.html  |  transactions.html  |  budget.html  |  goals.html        │
│   market.html     |  investments.html   |  loans.html   |  insurance.html    │
│   calendar.html   |  analytics.html     |  ai-advisor.html | login/signup    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼ (HTTP REST with Bearer JWT)
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CENTRAL API CLIENT (/assets/js/api.js)                   │
│   - Base URL routing (port 5001 / relative)                                 │
│   - Transparent 401 token refresh loop                                      │
│   - Unified JSON formatting & INR currency localization                     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EXPRESS BACKEND (node-backend/src/app.js)                │
│   - Security: Helmet, CORS, Rate Limiting, Compression                      │
│   - Auth Middleware: authenticate, jwtVerify                                │
│   - Routing: /api/v1/auth, /api/v1/dashboard, /api/v1/market, /api/v1/ai... │
└───────────────────────┬──────────────────────────────┬──────────────────────┘
                        │                              │
                        ▼                              ▼
┌───────────────────────────────┐     ┌───────────────────────────────────────┐
│     POSTGRESQL 17 + PRISMA    │     │         EXTERNAL FINANCIAL APIS       │
│  - users & refresh_tokens     │     │  - Alpha Vantage (GLOBAL_QUOTE, FX,   │
│  - transactions & categories  │     │    COMMODITIES, RSI, MACD, BBANDS)    │
│  - accounts & budgets & goals │     │  - Finnhub (Crypto & Market News)     │
│  - portfolios & investments   │     │  - Google Gemini AI (Advisory)        │
│  - loans & insurance & subs   │     │  - MCX Gold/Silver Spot Reference     │
│  - ai_conversations & scans   │     └───────────────────────────────────────┘
└───────────────────────────────┘
```

---

## 3. Comprehensive Feature Matrix

| Feature | Frontend Page | API Endpoint | Controller | Service | Database Model | External Service | Status |
|---|---|---|---|---|---|---|---|
| **User Registration** | `signup.html` | `POST /api/v1/auth/register` | `authController.js` | `authService.js` | `User`, `Profile`, `FinancialAccount` | None | ✅ Working |
| **User Login** | `login.html` | `POST /api/v1/auth/login` | `authController.js` | `authService.js` | `User`, `RefreshToken` | None | ✅ Working |
| **Token Refresh** | `api.js` | `POST /api/v1/auth/refresh` | `authController.js` | `authService.js` | `RefreshToken` | None | ✅ Working |
| **Google Sign-In** | `login.html` | `POST /api/v1/auth/google/token` | `authController.js` | `authService.js` | `User` | Google OAuth2 | ✅ Configured |
| **Dashboard** | `dashboard.html` | `GET /api/v1/dashboard` | `dashboardController.js` | `financialTwinService.js` | All entities | None | ✅ Working |
| **Onboarding** | `onboarding.html` | `POST /api/v1/onboarding` | `onboardingController.js` | `financialTwinService.js` | `FinancialProfile`, `FinancialPlan` | None | ✅ Working |
| **Account Mgmt** | `dashboard.html` | `GET/POST /api/v1/accounts` | `accountController.js` | `financialTwinService.js` | `FinancialAccount` | None | ✅ Working |
| **Transactions CRUD** | `transactions.html` | `GET/POST/PATCH/DELETE /api/v1/transactions` | `transactionController.js` | `financialTwinService.js` | `Transaction`, `Category` | None | ✅ Working |
| **Category Budgets** | `budget.html` | `GET/POST/PATCH/DELETE /api/v1/budgets` | `budgetController.js` | `financialTwinService.js` | `Budget` | None | ✅ Working |
| **Budget Optimizer** | `budget.html` | `GET /api/v1/ai/budget-optimize` | `analyticsController.js` | `financialTwinService.js` | `Budget`, `Transaction` | None | ✅ Working |
| **Financial Goals** | `goals.html` | `GET/POST/PATCH/DELETE /api/v1/goals` | `goalController.js` | `financialTwinService.js` | `Goal` | None | ✅ Working |
| **Goal Forecast** | `goals.html` | `GET /api/v1/ai/goals/:id/forecast` | `simulationController.js` | `financialTwinService.js` | `Goal`, `Transaction` | None | ✅ Working |
| **Live Market Dash** | `market.html` | `GET /api/v1/market/dashboard` | `investmentController.js` | `marketService.js` | `MarketPriceHistory` | Alpha Vantage / Finnhub | ✅ Live |
| **Stock Quote & Chart** | `investments.html` | `GET /api/v1/market/quote`, `/history` | `investmentController.js` | `marketService.js` | None (cached) | Alpha Vantage / Finnhub | ✅ Live |
| **24K/22K Gold & Silver** | `market.html` | `GET /api/v1/market/metals`, `/gold` | `investmentController.js` | `marketService.js` | `CommodityPrice` | Alpha Vantage / MCX | ✅ Live |
| **Technical Indicators** | `market.html` | `GET /api/v1/market/technicals` | `investmentController.js` | `marketService.js` | None (cached) | Alpha Vantage | ✅ Live |
| **Forex USD/INR** | `market.html` | `GET /api/v1/market/fx` | `investmentController.js` | `marketService.js` | None (cached) | Alpha Vantage | ✅ Live |
| **Global Commodities** | `market.html` | `GET /api/v1/market/commodity` | `investmentController.js` | `marketService.js` | None (cached) | Alpha Vantage | ✅ Live |
| **Portfolio & Holdings** | `investments.html` | `GET/POST /api/v1/investments` | `investmentController.js` | `marketService.js` | `Portfolio`, `Investment` | Alpha Vantage / Finnhub | ✅ Working |
| **Loans & EMI Calc** | `loans.html` | `GET/POST /api/v1/loans`, `/calculate-emi` | `loanController.js` | `financialTwinService.js` | `Loan` | None | ✅ Working |
| **Prepayment Sim** | `loans.html` | `POST /api/v1/loans/prepayment-simulate` | `loanController.js` | `financialTwinService.js` | `Loan` | None | ✅ Working |
| **Insurance Policies** | `insurance.html` | `GET/POST/PATCH/DELETE /api/v1/insurance` | `insuranceController.js` | `financialTwinService.js` | `InsurancePolicy` | None | ✅ Working |
| **Subscriptions** | `insurance.html` | `GET/POST/PATCH/DELETE /api/v1/subscriptions` | `subscriptionController.js` | `financialTwinService.js` | `Subscription` | None | ✅ Working |
| **Calendar Events** | `calendar.html` | `GET/POST/PATCH/DELETE /api/v1/calendar/events` | `analyticsController.js` | `financialTwinService.js` | `CalendarEvent`, `Loan`, `Subscription` | None | ✅ Working |
| **Health Score (0-100)**| `analytics.html` | `GET /api/v1/ai/financial-health` | `analyticsController.js` | `financialTwinService.js` | `FinancialHealthHistory` | None | ✅ Working |
| **Cash Flow Engine** | `analytics.html` | `GET /api/v1/ai/cash-flow` | `analyticsController.js` | `financialTwinService.js` | `CashFlowPrediction` | None | ✅ Working |
| **Expense Anomalies** | `analytics.html` | `GET/PATCH /api/v1/ai/anomalies` | `analyticsController.js` | `financialTwinService.js` | `ExpenseAnomaly` | None | ✅ Working |
| **Financial Simulator** | `ai-advisor.html` | `POST /api/v1/ai/simulate` | `simulationController.js` | `financialTwinService.js` | `FinancialSimulation` | None | ✅ Working |
| **Retirement Planner** | `ai-advisor.html` | `POST /api/v1/ai/retirement-plan` | `simulationController.js` | `financialTwinService.js` | None | None | ✅ Working |
| **AI Advisor Chat** | `ai-advisor.html` | `POST/GET/DELETE /api/v1/ai/chat`, `/history` | `aiController.js` | `aiService.js` | `ChatMessage`, context | Google Gemini API | ✅ Live |
| **Voice Intent Engine** | `ai-advisor.html` | `POST /api/v1/ai/voice-intent` | `aiController.js` | `financialTwinService.js` | `Transaction` (on confirm) | Web Speech API | ✅ Working |
| **OCR Receipt Scanner**| `ai-advisor.html` | `POST /api/v1/receipts/scan`, `/confirm` | `ocrImportController.js` | `financialTwinService.js` | `ReceiptScan`, `Transaction` | None (native regex/OCR) | ✅ Working |
| **Bank CSV Import** | `ai-advisor.html` | `POST /api/v1/import/bank-statement`, `/confirm` | `ocrImportController.js` | `financialTwinService.js` | `Transaction` | None | ✅ Working |
| **Data Exports (CSV)** | All pages | `GET /api/v1/export/*.csv` | `exportController.js` | `financialTwinService.js` | Respective models | None | ✅ Working |

---

## 4. Architectural Decisions & Legacy Code Isolation

1. **Backend Consolidation:** The active canonical backend is Node.js + Express (`node-backend/`). Any older Django references in `legacy-django-backend/` are preserved strictly as an unreferenced archive and do not interfere with the active runtime.
2. **Database Integrity:** PostgreSQL with Prisma is the single source of truth. All monetary values are strictly stored as `Decimal(15, 2)` to eliminate floating-point inaccuracies.
3. **Multi-Tenant User Isolation:** Every entity query is filtered strictly by `userId = req.user.id` obtained from the validated JWT token. Request body `userId` is never trusted.
4. **Market Data Provider Hierarchy:** Alpha Vantage acts as primary provider for high-resolution NSE stock data, technical indicators, FX rates, and commodities. Finnhub acts as fallback and crypto provider. Verified reference feeds ensure zero application crashes if network limits are reached.
