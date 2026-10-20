# FinPro — Personal Finance & Investment Decision Support Platform

[![CI / Build & Test](https://github.com/tani1290/Finance_assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/tani1290/Finance_assistant/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/PostgreSQL-17-blue.svg)](https://www.postgresql.org/)
[![ORM](https://img.shields.io/badge/Prisma-5.22-darkblue.svg)](https://www.prisma.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **FinPro**  
> **Created by Students of VU**  
> **Project Lead:** Jinay Golecha  
> **Repository:** [tani1290/Finance_assistant](https://github.com/tani1290/Finance_assistant.git)  
> **Master Documentation:** For full system architecture, database schema, Mermaid ER diagrams, and deployment workflows, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 1. Problem Statement & Solution

### The Problem
Modern personal finance is fractured. Individuals navigate separate applications for bank accounting, equity investments, bullion tracking, loan amortization, credit card due dates, and insurance policies. Many platforms use generic or fabricated metrics, leaving users with disjointed financial visibility and delayed market information.

### The FinPro Solution
FinPro is an integrated, full-stack personal finance and investment decision support platform engineered specifically for the Indian financial ecosystem (INR / ₹ / `en-IN` / `Asia/Kolkata`). FinPro unifies:
- **Canonical Architecture:** A single Node.js/Express backend backed by PostgreSQL 17 via Prisma ORM.
- **Audited Market Data Engine:** Real-time stock quotes (NSE/BSE) and COMEX continuous precious metals (Gold 24K/22K & Silver) converted to INR at live interbank FX rates with zero fake or synthetic curves.
- **AI Decision Support:** Powered by Google Gemini 1.5 Flash grounded strictly in authenticated user database records (10-factor financial health score, 30/90-day cash flow projections, what-if simulators, and budget optimization).
- **Comprehensive Obligation Tracking:** Card management, loan prepayment simulators, insurance renewals, and financial to-do tasks.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐  ┌─────────────────────────────────────────────────────────────┐
│                    WEB CLIENT (SPA)                         │  │                  MOBILE CLIENT (FLUTTER)                    │
│   Vanilla JS (ES6 Modules) + CSS3 Design Tokens             │  │   Flutter 3.38+ / Dart 3.10+ / Material 3 Emerald           │
│   Served statically by Node.js Express at port 5001         │  │   Native Android BroadcastReceiver + MethodChannel          │
└──────────────────────────────▲──────────────────────────────┘  └──────────────────────────────▲──────────────────────────────┘
                               │                                                                │
                               └───────────────────────────────┬────────────────────────────────┘
                                                               │
                                                       HTTPS / REST / JSON
                                                               │
┌──────────────────────────────────────────────────────────────▼──────────────────────────────────────────────────────────────┐
│                                           CENTRAL API CLIENT & AUTHENTICATION                                               │
│   - Web: frontend/public/assets/js/api.js (JWT Bearer propagation & 401 refresh)                                            │
│   - Mobile: mobile/lib/core/api/api_client.dart (Dio Interceptors & FlutterSecureStorage)                                   │
└──────────────────────────────────────────────────────────────▲──────────────────────────────────────────────────────────────┘
                                                               │
┌──────────────────────────────────────────────────────────────▼──────────────────────────────────────────────────────────────┐
│                                                 NODE.JS / EXPRESS 4 BACKEND                                                 │
│   node-backend/src/server.js  |  node-backend/src/app.js                                                                    │
│   - Middleware: Helmet, CORS, Rate Limiters, Morgan                                                                         │
│   - JWT Auth (Email + Password) Identity Provider                                                                           │
│   - Controllers: Accounts, Tx, Budgets, Goals, AI, Market, SMS Detection, Mobile Sync                                       │
└──────────────────────────────▲──────────────────────────────────────────────────────────────▲───────────────────────────────┘
                               │                                                              │
┌──────────────────────────────▼──────────────┐                ┌──────────────────────────────▼───────────────────────────────┐
│        PRISMA ORM 5.22                      │                │                    EXTERNAL SERVICE LAYER                    │
│   postgresql://.../finance                  │                │  - Google Gemini 1.5 Flash                                   │
│   - 30 Persistent Models                    │                │  - Live Market Feed Engine (NSE/BSE/COMEX)                   │
│   - Multi-Tenant Isolation & Mobile Sync    │                │  - Marketaux Financial News                                  │
│   - Atomic Rollback Ledger Mutex            │                │  - On-Device SMS Parser & Tesseract OCR                      │
└─────────────────────────────────────────────┘                └──────────────────────────────────────────────────────────────┘
```

---

## 3. Core Features & Capabilities

### 🏦 Accounts & Transactions
- **Multi-Account Support:** Bank accounts, cash wallets, credit cards, savings, and investments.
- **Atomic Balance Synchronization:** Every transaction creation, modification, or deletion atomically updates the associated account balance.
- **Automated Anomaly Detection:** Flags unusual expenditures exceeding dynamic category baselines.

### 📈 Verified Market & Commodity Engine
- **Stocks:** Real-time quote and historical chart engine supporting NSE/BSE symbols (e.g. `RELIANCE.NS`, `TCS.NS`, `INFY.NS`).
- **Precious Metals:** Live COMEX continuous futures (`GC=F` Gold, `SI=F` Silver) converted to INR via interbank FX (`USDINR=X`). Clearly disclaimed against domestic MCX contracts and retail Indian bullion (6% import duty + 3% GST).
- **Silver Formulas:** Standardized conversion: `1 kg = 1000 grams exact; 1 troy oz = 31.1035 grams`.
- **Zero Fake Data Guarantee:** Provider status explicitly labeled: `LIVE`, `CACHED`, `STALE`, or `UNAVAILABLE`. Zero synthetic chart candles.

### 💳 Credit & Debit Card Management
- **Safe Card Tracking:** Stores card nickname, issuer, masked last 4 digits (`•••• •••• •••• 4321`), credit limit, outstanding balance, minimum due, and billing day.
- **Strict PCI Security:** Explicit rejection of full 16-digit PANs, CVV, CVC, and PIN codes.
- **Utilization Alerts:** Real-time credit utilization monitoring (`<30%` Healthy, `30-50%` Moderate, `>50%` High Risk).

### 🤖 Grounded AI Financial Advisor
- **Context-Aware Insights:** Gemini 1.5 Flash answers questions based on real database records (income, expenses, budgets, debts, and holdings).
- **10-Factor Health Score:** Comprehensive 0–100 score analyzing savings rate, debt-to-income, emergency fund adequacy, liquidity, and investment diversity with positive and attention reasons.
- **Educational Credit Assessment:** Transparent educational assessment (not fake bureau scores) derived from recorded credit utilization and DTI.

### 📋 Financial Tasks & Smart Reminders
- **Actionable To-Do:** Task management for EMI payments, credit card dues, SIP investments, and tax filing.
- **Completion Tracking:** Timestamps completed tasks to prevent repetitive alerts.

### 📰 Financial News Service
- **Marketaux Integration:** Real-time financial headlines, sentiment analysis, and search filters with 10-minute server-side caching.
- **Fallback Resilience:** Automatic fallback to Finnhub and curated Market Desk briefings.

### 🎙️ Voice Assistant & OCR
- **Voice Assistant:** Web Speech API integration with intent parsing. Strictly requires user confirmation before executing any financial mutation (`ADD_EXPENSE`, `ADD_INCOME`).
- **Receipt OCR:** Extracts merchant, amount, date, and category into a preview confirmation dialog prior to database commit.

---

## 4. Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend Runtime** | Node.js 22 LTS, Express 4.21 |
| **Database & ORM** | PostgreSQL 17, Prisma ORM 5.22 |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, CSS3 Custom Design System |
| **Security & Auth** | JWT (`jsonwebtoken`), `bcryptjs` (salt rounds 10) |
| **AI / Machine Learning**| Google Gemini 1.5 Flash (`@google/generative-ai`), custom ML regression/classification engine |
| **Market Data Feeds** | Live Market Feed Engine, Alpha Vantage, Finnhub, Marketaux |
| **Testing & CI/CD** | Supertest, Jest, GitHub Actions, Docker Compose |

---

## 5. Quick Start Guide

### Prerequisites
- **Node.js:** `>= 20.0.0` (Recommended: Node.js 22 LTS)
- **PostgreSQL:** `>= 15` (Running locally or via Docker on port 5432)
- **npm:** `>= 10.0.0`

### 1. Clone & Configure
```bash
git clone https://github.com/tani1290/Finance_assistant.git
cd Finance_assistant

# Copy environment template
cp .env.example .env
```

### 2. Configure Database in `.env`
Ensure your PostgreSQL credentials match in `.env`:
```env
DATABASE_URL="postgresql://postgres:your_password@127.0.0.1:5432/finance_jinay"
JWT_SECRET="your_secure_random_jwt_secret_key_min_32_chars"
```

### 3. One-Command Setup
```bash
npm run setup
```
*This installs all dependencies in `node-backend` and pushes the Prisma schema to your PostgreSQL database.*

### 4. Run Development Server
```bash
npm run dev
```
Open **http://127.0.0.1:5001** in your browser.

---

## 6. Docker Deployment

To launch FinPro and PostgreSQL inside isolated containers:
```bash
docker compose up --build
```
The application will be accessible at `http://localhost:5001`.

---

## 7. Verification & Testing

FinPro contains a comprehensive suite of automated backend acceptance tests, SMS & mobile sync tests, and Flutter client tests:

### Run Backend Integration & Mobile SMS Acceptance Tests
```bash
npm test
```
*Runs 171 backend assertion checks across the two `npm test` suites: `run-all-tests.js` (135 checks covering authentication, core finance, AI, loans, cards, tasks, news, and multi-tenant isolation) and `test-sms-mobile-suite.js` (36 checks covering Android SMS candidate parsing, deduplication, and atomic ledger confirmation). Across all four configured suites the repository verifies **217 assertion checks** (`npm test` 135 + 36, `npm run test:cloud` 29, `npm run test:failure` 17) with 0 failures.*

### Run Mobile Flutter Tests & Static Analysis
```bash
cd mobile
flutter test
flutter analyze
```
*Executes unit and widget tests covering on-device SMS parsing, INR formatting, date relative stamps, model serialization, and static lint analysis with 0 warnings.*

### Run Cloud Verification & Resiliency Suites
```bash
npm run test:cloud
npm run test:failure
```
*`test:cloud` verifies end-to-end data persistence across sessions (29 checks). `test:failure` verifies graceful degradation against database outages, storage failures, and path-traversal attempts (17 checks).*

---

## 8. Service Diagnostic Endpoints

The backend exposes authenticated and unauthenticated diagnostic endpoints:

| Endpoint | Purpose | Expected Status |
| :--- | :--- | :--- |
| `GET /api/v1/health` | System & DB connectivity | `status: 'ok', database: 'connected'` |
| `GET /api/v1/health/database` | Database query latency | `status: 'connected', latencyMs: <10` |
| `GET /api/v1/health/market` | Market feed provider status | `provider: 'Finnhub', status: 'live'` |
| `GET /api/v1/health/ai` | Gemini AI engine status | `provider: 'Google Gemini', status: 'configured'` |
| `GET /api/v1/health/news` | Marketaux news service status | `provider: 'Marketaux', status: 'healthy'` |

---

## 9. Security & Data Protection

1. **Authentication & Identity:** Bcrypt password hashing (10 salt rounds). JWT access tokens expire in 60 minutes; refresh tokens stored in DB with one-device rotation.
2. **User Data Isolation:** Every database operation strictly enforces tenant scoping via `req.user.id`. User B cannot read or modify User A's data.
3. **Financial Privacy:** Card security codes (CVV/PIN) and full card numbers are strictly prohibited and never accepted or stored.
4. **Environment Isolation:** Zero credentials, passwords, or secret keys committed to Git.

---

## 10. Contributors & Project Metadata

- **Project Name:** FinPro
- **Subtitle:** Personal Finance & Investment Decision Support Platform
- **Branding:** FinPro — Created by Students of VU
- **Project Lead:** Jinay Golecha
- **Academic Year:** 2025–2026

For contributing guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).  
For the full documentation set, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/API.md](docs/API.md), [docs/DATABASE.md](docs/DATABASE.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/MOBILE.md](docs/MOBILE.md), [docs/TESTING.md](docs/TESTING.md), and [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md).
