# Jinay Finance AI — System Architecture
**Owner:** Jinay Golecha (`jinay_golecha`)  
**Project:** AI-Powered Personal Finance & Investment Advisor (Final Year Engineering Project)

---

## 1. System Overview

Jinay Finance AI is a full-stack, enterprise-grade personal finance management and advisory platform built specifically for the Indian financial ecosystem (INR, Lakhs/Crores, NSE/BSE, MCX Gold/Silver, 50/30/20 & Zero-Based budgeting).

```
┌────────────────────────────────────────────────────────┐
│                   Client Layer (SPA)                   │
│   Vanilla JS + HTML5 + CSS3 + ECharts + RemixIcons     │
└───────────────────────────┬────────────────────────────┘
                            │ (HTTPS / Bearer JWT)
┌───────────────────────────▼────────────────────────────┐
│                  API & Gateway Layer                   │
│   Node.js v20+ / Express v4.21                         │
│   Helmet, CORS, Rate Limiters, Compression, Morgan     │
└─────────────┬───────────────────────────┬──────────────┘
              │                           │
┌─────────────▼─────────────┐ ┌───────────▼──────────────┐
│     Business Services     │ │      External Providers  │
│  - Financial Twin Engine  │ │  - Alpha Vantage API     │
│  - Auth & Security Engine │ │  - Finnhub API           │
│  - Market Aggregator      │ │  - Google Gemini AI      │
│  - AI Prompt & Rules Eng. │ │  - Google OAuth2         │
│  - OCR & Voice Parsers    │ │  - MCX Spot Rates        │
└─────────────┬─────────────┘ └──────────────────────────┘
              │
┌─────────────▼─────────────┐
│    Data Layer (ORM/DB)    │
│  - Prisma Client ORM      │
│  - PostgreSQL 17 Engine   │
└───────────────────────────┘
```

---

## 2. Component Specifications

### 2.1 Backend (`node-backend/`)
- **Runtime:** Node.js (v20+ LTS recommended)
- **Framework:** Express.js 4.21
- **ORM:** Prisma 5.22
- **Database:** PostgreSQL 17 (`finance_jinay`)
- **Port:** `5001` (configurable via `PORT` environment variable)

### 2.2 Security & Authentication
- **Token Format:** JSON Web Token (JWT) with HMAC-SHA256 (`HS256`).
- **Token Expiry:** Access Token: 60 minutes (`JWT_EXPIRES_IN=60m`), Refresh Token: 7 days (`JWT_REFRESH_EXPIRES_IN=7d`).
- **Password Hashing:** `bcryptjs` with salt rounds = 10.
- **Tenant Isolation:** All database reads and writes enforce user ownership checks: `where: { id: entityId, userId: req.user.id }`.
- **Cross-Origin Resource Sharing (CORS):** Supports `http://127.0.0.1:3000`, `http://localhost:3000`, `http://127.0.0.1:5500`, and `null` (file:// protocol development).

### 2.3 Financial Intelligence Engine (`financialTwinService.js`)
- **10-Factor AI Health Score:** Evaluates savings rate, emergency runway, debt-to-income, investment allocation, goal milestones, insurance coverage, cash flow stability, subscription burden, credit utilization, and anomaly frequency (0–100 score).
- **Cash Flow Predictor:** Mathematical projection engine simulating daily account balance over 7, 30, and 90-day timeframes accounting for known recurring loans (EMIs), subscriptions, and historic daily expenditure velocity.
- **Budget Optimizer:** Real-time 50/30/20 and Zero-Based budget calculation from actual recorded monthly transactions.
- **Retirement Planning Engine:** Compound interest projection modeling conservative (8%), base (12%), and aggressive (15%) portfolio growth against desired retirement age, current corpus, and monthly SIP.

### 2.4 Real-Time Market Feed Architecture (`marketService.js`)
- **Primary Source:** Alpha Vantage REST API using dedicated access key (`ALPHA_VANTAGE_API_KEY`).
- **Secondary Source:** Finnhub REST API (`FINNHUB_API_KEY`).
- **Commodity & Metals Engine:** Real-time extraction of 24K and 22K Gold (converted from USD/troy oz to INR/gram), Silver, WTI Crude Oil, Natural Gas, Copper, and Brent.
- **Caching Layer:** In-memory `Map` cache with dynamic TTLs (3 min for live quotes, 15 min for charts, 1 hr for fundamentals) ensuring zero rate-limit exhaustion.
- **Reference Fallback:** In the event of network disconnection or external API downtime, transparent reference rates based on latest verified NSE/BSE closing prices are served with explicit source attribution.

---

## 3. Directory Layout

```
Final-Year-Project/
├── docs/                     # Production architectural & QA documentation
├── frontend/
│   └── public/               # Single Page Application HTML, CSS & JS files
│       ├── assets/
│       │   ├── css/app.css   # Unified dark-mode UI theme
│       │   └── js/
│       │       ├── api.js    # Centralized authenticated API client
│       │       ├── app.js    # Global utility & toast library
│       │       └── sidebar.js# Reusable responsive navigation component
│       ├── dashboard.html    # Consolidated real-time financial command center
│       ├── market.html       # Alpha Vantage live market, technicals & gold hub
│       ├── transactions.html # Transaction management & filtering
│       ├── budget.html       # Dynamic category budgeting & AI optimizer
│       ├── goals.html        # Financial goal tracker & forecasting
│       ├── investments.html  # Multi-asset portfolio valuation
│       ├── loans.html        # EMI calculator & prepayment simulator
│       ├── insurance.html    # Policy & subscription renewal tracking
│       ├── calendar.html     # Financial calendar & recurring event manager
│       ├── analytics.html    # Health scoring, cash flow & anomaly detection
│       ├── ai-advisor.html   # Gemini conversational advisor & what-if simulator
│       ├── login.html        # User login with JWT & Google OAuth
│       └── signup.html       # User registration
├── node-backend/             # Canonical Node.js / Express backend
│   ├── prisma/
│   │   └── schema.prisma     # Canonical PostgreSQL database schema
│   ├── src/
│   │   ├── config/           # Database & environment configurations
│   │   ├── controllers/      # 16 domain controllers
│   │   ├── middleware/       # JWT auth & error handling middleware
│   │   ├── routes/           # RESTful API route definitions
│   │   ├── services/         # Business logic & AI/market integrations
│   │   ├── utils/            # Financial math & formatting utilities
│   │   ├── app.js            # Express application setup
│   │   └── server.js         # HTTP server entry point
│   ├── run-all-tests.js      # 66-assertion master integration test suite
│   ├── test-auth-comprehensive.js # 40-assertion security & auth test suite
│   └── test-market-live.js   # Live external API validation suite
└── README.md                 # Master repository guide
```
