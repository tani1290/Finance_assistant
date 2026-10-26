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
│  - Web: static multi-page HTML + Vanilla JS + CSS3 design system + ECharts
│  - Mobile: Flutter 3.x (Dart) + Riverpod 2.x + Native Android SMS Ch.  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (HTTPS / Bearer JWT)
┌───────────────────────────────────▼────────────────────────────────────┐
│                         API GATEWAY & SECURITY                         │
│  - Node.js v20+ LTS / Express.js 4.21                                  │
│  - Helmet, CORS Origin Whitelist, Express-Rate-Limit, Compression      │
│  - JWT (HMAC-SHA256) & Firebase Auth Validator                        │
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
  - `express-rate-limit`: Tiered throttling (1000 req/15min general, 100 req/15min auth, 5/hour account deletion). Health and realtime paths are exempt so platform probes can never exhaust a user-facing budget — see [OPERATIONS.md](OPERATIONS.md) §2.1.
  - `compression`: Gzip response compression for optimized low-latency payloads.

### 2.2 Database & Data Access Layer
- **Database Engine:** PostgreSQL 17+ (production runs 18.6) — Strict ACID guarantees, foreign key cascade rules, and compound index performance.
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
- **Authentication:** Dual-token JWT (60m access token, 7d refresh token) with Bcrypt (10 salt rounds) password hashing; credentials are first-party email + password.
- **Push Notifications:** Firebase Cloud Messaging (FCM) via Firebase Admin SDK, fed by a bounded in-process retry queue. Push is best-effort and degrades to "not sent" without failing the request; queued jobs are not durable across restarts.
- **AI Core:** Google Gemini (`@google/generative-ai`) grounded in real user records; deterministic rule fallbacks when offline.
- **OCR & Voice:** Tesseract.js receipt scanner & Web Speech API intent parser.
- **Containerization & Deployment:** Docker (Node.js Alpine non-root), Docker Compose, Render Blueprint, and Vercel edge deployment.

### 2.6 Resilience, Observability & Operations
- **Optional shared cache:** in-process L1 plus optional Redis L2, namespaced keys, TTLs, singleflight and a Redis failure circuit. Redis is never required for a core request; public market/news data only.
- **Upstream client:** explicit timeouts, bounded idempotent-only retries with jitter, `Retry-After` handling, per-host circuit breakers, and a concurrency cap for market/news providers.
- **Health contract:** `/api/v1/health/live` touches nothing, `/api/v1/health/dependencies` gates on the required database, and `/api/v1/health/ready` remains the strict database+storage probe.
- **Metrics:** dependency-free Prometheus text endpoint at `/metrics`, token-gated in production, covering HTTP, cache, upstream and push-queue signals.
- **Backup/DR:** verified `pg_dump` backups with optional AES-256-GCM encryption, SHA-256 manifests, local-only restores into empty databases, checksum/key verification, retention, off-host publishing with download-back verification, and a repeatable recovery drill.
- **Scaling:** designed for one instance today; shared Redis is required before multi-instance rate limiting, cache or SSE fan-out becomes correct.

Operational procedures are in [OPERATIONS.md](OPERATIONS.md); recovery is in
[BACKUP_DR.md](BACKUP_DR.md).

---

## 3. Directory Layout

```
FinPro/
├── docs/                     # Canonical documentation set (see docs/README.md)
│   ├── README.md             # Index and reading order
│   ├── ARCHITECTURE.md       # Architecture & Tech Stack (This document)
│   ├── API.md                # REST API + financial data contract
│   ├── DATABASE.md           # Database Schema & Relational Specifications
│   ├── AI.md                 # Assistant pipeline, tools, guardrails
│   ├── PARITY.md             # Web ⇄ Mobile feature matrix & known defects
│   ├── DEPLOYMENT.md         # Deployment runbook
│   ├── OPERATIONS.md         # Health, cache, queue, metrics, scaling rules
│   ├── BACKUP_DR.md          # Backup, restore and recovery drill
│   ├── CLOUD_AUDIT.md        # Capability audit and post-change status
│   ├── DESIGN_SYSTEM.md      # UI/UX Design System Tokens & Guidelines
│   ├── MOBILE.md             # Flutter Mobile Architecture & SMS Engine
│   └── TESTING.md            # Testing Guide & Suite Directory
├── frontend/
│   └── public/               # Static HTML/CSS/JS app (no build step)
├── mobile/                   # Flutter Cross-Platform Mobile Application
├── node-backend/             # Canonical Node.js / Express API Backend
│   ├── prisma/               # Prisma schema & migrations
│   ├── src/                  # Controllers, services, routes, middleware
│   └── scripts/              # Secret scanner, linter, build scripts
├── docker-compose.yml        # Multi-container orchestration
├── render.yaml               # Render Cloud Blueprint
└── vercel.json               # Vercel Frontend Reverse Proxy Config
```

---

## 4. Client Surfaces

Both clients are first-class consumers of the same `/api/v1` contract. Neither has a private API.

| Surface | Stack | Build | Notes |
|---|---|---|---|
| **Web** | Static HTML pages in `frontend/public`, ES modules, one API layer (`assets/js/api.js`), SSE client (`assets/js/realtime.js`) | None — served as files | Every page authenticates with a Bearer JWT and shares the same error envelope handling. No bundler, no framework, no automated test harness. |
| **Mobile** | Flutter 3 / Dart, Riverpod-style providers, `dio` behind `ApiClient`, Material 3 | `flutter build` | Native Android SMS ingestion is mobile-only. Pull-to-refresh is the sync mechanism; there is no SSE client. |

Shared rules (money formatting, date-only fields, percentage scaling, error envelopes) are written down once in `PARITY.md` §6 rather than re-derived per screen.

### AI pipeline

`POST /ai/chat` is assistant-first and degrades safely: Gemini tool-calling → deterministic action engine → bounded RAG. The model can only act through the declared tool registry, and every tool is scoped to the authenticated user. Mutations are two-phase: a tool call or deterministic mutating intent returns a hashed, single-use proposal, and nothing is written until `POST /ai/actions/confirm`. Full detail is in `AI.md`.

---

## 5. Documentation Map

| Question | Document |
|---|---|
| What are the components and how do they fit? | `ARCHITECTURE.md` (this file) |
| What endpoints exist and what do they return? | `API.md` |
| What are the tables and relations? | `DATABASE.md` |
| Does the web do the same thing as mobile? | `PARITY.md` |
| How does the assistant work and what can it do? | `AI.md` |
| How do I run and test everything? | `TESTING.md` |
| How is it deployed, and what must pass first? | `DEPLOYMENT.md` |
| What are the UI tokens and layout rules? | `DESIGN_SYSTEM.md` |
| How does the Flutter app and SMS engine work? | `MOBILE.md` |
