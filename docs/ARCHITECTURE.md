# FinPro / Jinay Finance AI — System Architecture & Technology Stack
**Owner:** Jinay Golecha (`jinay_golecha`)  
**Project:** AI-Powered Personal Finance & Investment Decision Support Platform (Final Year Project)  
**Branding:** Created by Students of VU

---

## 1. System Overview

FinPro is a full-stack, enterprise-grade personal finance management and advisory platform engineered specifically for the Indian financial ecosystem (INR `₹`, `en-IN` formatting, `Asia/Kolkata` timezone semantics, NSE/BSE equities, MCX/COMEX precious metals, and dynamic 50/30/20 & Zero-Based budgeting).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER (WEB & MOBILE)                     │
│  - Web SPA: Vanilla JS (ES6+) + CSS3 Custom Design System + ECharts    │
│  - Mobile: Flutter 3.x (Dart) + Riverpod 2.x + Native Android SMS Ch.  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (HTTPS / Bearer JWT)
┌───────────────────────────────────▼────────────────────────────────────┐
│                         API GATEWAY & SECURITY                         │
│  - Node.js v20+ LTS / Express.js 4.21                                  │
│  - Helmet, CORS Origin Whitelist, Express-Rate-Limit, Compression      │
│  - JWT (HMAC-SHA256) & Google OAuth 2.0 / Firebase Auth Validator     │
└───────────────────────┬────────────────────────────┬───────────────────┘
                        │                            │
┌───────────────────────▼───────────┐ ┌──────────────▼───────────────────┐
│        BUSINESS SERVICES          │ │        EXTERNAL CLOUD SERVICES   │
│  - Financial Twin & Health Score  │ │  - Google Gemini 1.5/2.5 AI      │
│  - Cash Flow Predictor (30/90d)   │ │  - Firebase Admin SDK (FCM)      │
│  - Market Aggregator (Zero Fake)  │ │  - Alpha Vantage (Technicals)    │
│  - SMS Detection & Reconciliation │ │  - Finnhub API (Equities/Crypto) │
│  - Receipt OCR & Voice Intent     │ │  - Live Interbank FX Feed        │
└───────────────────────┬───────────┘ └──────────────────────────────────┘
                        │
┌───────────────────────▼───────────┐
│        DATA & PERSISTENCE         │
│  - Prisma ORM 5.22 (Type-safe)    │
│  - PostgreSQL 17 (ACID Relational)│
│  - Multi-tenant tenant isolation  │
└───────────────────────────────────┘
```

---

## 2. Complete Technology Stack

### 2.1 Backend Infrastructure
- **Runtime:** Node.js (v20+ LTS) — Event-driven, non-blocking I/O model for concurrent financial transactions.
- **Framework:** Express.js (v4.21) — Clean RESTful routing architecture with centralized error handling.
- **Security Middleware:**
  - `helmet`: Enforces HTTP security headers (CSP, HSTS, X-Frame-Options).
  - `cors`: Strict origin validation with credential support.
  - `express-rate-limit`: Tiered throttling (200 req/15min general, 20 req/15min auth endpoints).
  - `compression`: Gzip response compression for optimized low-latency payloads.

### 2.2 Database & Data Access Layer
- **Database Engine:** PostgreSQL 17 — Strict ACID guarantees, foreign key cascade rules, and compound index performance.
- **ORM:** Prisma 5.22 — Type-safe query builder, declarative schema modeling (`schema.prisma`), and versioned schema migrations.
- **Tenant Isolation:** Enforced on every database read/write query through required `{ userId: req.user.id }` constraints.

### 2.3 Frontend Web Architecture
- **Language & Paradigms:** Vanilla JavaScript (ES6+ Modules, Async/Await, Fetch API) — Zero heavy runtime frameworks (React/Angular) for ultra-fast, zero-overhead page loading.
- **Styling:** Bespoke CSS3 Design System with CSS Custom Properties, Glassmorphism backdrop-filters, CSS Grid & Flexbox.
- **Data Visualization:** Apache ECharts & Chart.js for high-performance financial charting.
- **Icons & Typography:** Remix Icon library & Google Fonts (Inter, Plus Jakarta Sans).

### 2.4 Mobile Application
- **Framework:** Flutter 3.x / Dart 3.x — Single cross-platform codebase compiling to native ARM64 Android binaries.
- **State Management:** Riverpod 2.x — Compile-safe, declarative reactivity without global mutable singletons.
- **Native Android Integration:** Kotlin platform channel (`FinProSmsReceiver`) for background transaction SMS parsing and notification triggers.
- **Offline Resilience:** SharedPreferences secure token caching and local sync states.

### 2.5 Cloud, Authentication & Notifications
- **Authentication:** Dual-token JWT (60m access token, 7d refresh token) + Bcrypt (10 salt rounds) + Google OAuth 2.0 / Firebase Auth token validation.
- **Push Notifications:** Firebase Cloud Messaging (FCM) via Firebase Admin SDK with graceful offline degradation.
- **AI Core:** Google Gemini (`@google/generative-ai`) grounded in real user records; deterministic rule fallbacks when offline.
- **OCR & Voice:** Tesseract.js receipt scanner & Web Speech API intent parser.
- **Containerization & Deployment:** Docker (Node.js Alpine non-root), Docker Compose, Render Blueprint, and Vercel edge deployment.

---

## 3. Directory Layout

```
Final-Year-Project/
├── docs/                     # Canonical architectural, QA, and deployment docs
│   ├── API.md                # Complete REST API Specification
│   ├── ARCHITECTURE.md       # Architecture & Tech Stack (This document)
│   ├── CLOUD_COMPUTING.md    # Cloud Computing, Resiliency & Telemetry Guide
│   ├── DATABASE.md           # Database Schema & Relational Specifications
│   ├── DEPLOYMENT.md         # Deployment Handbook (Local, Docker, Render, Vercel, Firebase)
│   ├── DESIGN_SYSTEM.md      # UI/UX Design System Tokens & Guidelines
│   ├── FINAL_QA_REPORT.md    # Master QA Test Results & Verification
│   ├── KNOWN_LIMITATIONS.md  # Limitations & Roadmap
│   ├── MARKET_DATA.md        # Live Market Pipeline & Zero-Fake Provenance
│   ├── MOBILE.md             # Flutter Mobile Architecture & SMS Engine
│   ├── PROJECT_AUDIT.md      # System Audit & Diagnostic Reports
│   ├── PROJECT_REPORT.md     # Academic Project Report
│   ├── PROJECT_SYNOPSIS.md   # Academic Synopsis
│   └── TESTING.md            # Testing Guide & Suite Directory
├── frontend/
│   └── public/               # Single Page Application HTML, CSS & JS
├── mobile/                   # Flutter Cross-Platform Mobile Application
├── node-backend/             # Canonical Node.js / Express API Backend
│   ├── prisma/               # Prisma schema & migrations
│   ├── src/                  # Controllers, services, routes, middleware
│   └── scripts/              # Secret scanner, linter, build scripts
├── deployment/               # Nginx configs & Systemd service templates
├── docker-compose.yml        # Multi-container orchestration
├── render.yaml               # Render Cloud Blueprint
└── vercel.json               # Vercel Frontend Reverse Proxy Config
```
