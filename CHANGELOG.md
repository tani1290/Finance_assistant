# 📋 Changelog — Jinay Finance AI

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-10-16

### Added
- **Real-time cross-device sync**: server-side event bus (SSE with a watermark fallback) pushing live updates to both the web and Flutter mobile clients.
- **Full tool-calling AI assistant**: the Gemini advisor executes create/update/delete actions across accounts, transactions, budgets, goals, loans, investments, insurance, subscriptions, and categories from natural conversation.
- **Categories resource**: complete REST CRUD surface for user-owned categories plus shared read-only system categories, wired into the realtime sync client.
- **Android SMS capture (Flutter)**: on-device SMS detection and atomic batch ingest with a pending-review queue.
- **Live market intelligence**: technical indicators computed from real price history alongside gold/silver spot rates and financial news.
- **Android distribution**: release-signed APK served from the landing page.
- **Security hardening**: defense-in-depth security headers, request sanitisation, an HTTP Parameter Pollution guard, and an automated repository secret scanner wired into the lint gate.

### Changed
- **Authentication**: email/password only — Google Sign-In and all associated OAuth client code removed.
- **Deployment**: the database schema is reconciled at deploy time (`prisma migrate deploy` with a non-destructive `db push` fallback) that reports real outcomes instead of masking failures.

### Fixed
- Duplicate SMS recording is now impossible, enforced by a unique `(userId, rawMessageHash)` constraint.
- The mobile dashboard now reports true net worth and returns real AI replies.

### Removed
- **Demo mode**: the seeded demo account, `/auth/seed-demo` endpoints, boot-time auto-seed, and the landing-page "Explore Demo" flow.
- Legacy Django backend, self-host deployment configs, and scratch test scripts.

## [1.0.0] - 2026-08-15

### Added
- **Core Architecture**: Node.js v22 + Express.js backend with Prisma ORM and PostgreSQL 17 database.
- **Authentication**: JWT authentication with access/refresh tokens, bcrypt password hashing, and user profile management.
- **Financial Onboarding**: 3-step dynamic onboarding calculating baseline expenses, debt-to-income ratio, and Financial Health Score (0-100).
- **Accounts & Deposits**: Multi-account management with atomic database balance updates on deposits.
- **Transactions & Anomaly Detection**: Income/expense logging, automatic balance reversal upon transaction deletion, and statistical high-value anomaly detection.
- **Voice Entry Parser**: Web Speech API integration with natural language processing for hands-free expense entry.
- **Budgeting Engine**: 50/30/20 budget framework with category limits, spending tracking, and threshold alerts.
- **Savings Goals**: Goal management with milestone tracking, progress percentages, and direct deposit allocations.
- **Investment & Precious Metals Hub**: Multi-asset holdings (Equities, Mutual Funds, SIP, Crypto) alongside live MCX 24K/22K Gold and Silver spot rates in INR.
- **Loans & EMI Simulator**: Standard reducing-balance EMI calculations and prepayment tenure/interest reduction simulations.
- **Insurance & Subscriptions**: Policy management (Life, Health, Motor, Home), renewal alerts, and recurring subscription expense tracking.
- **AI Financial Advisor**: Context-aware advisory engine powered by Google Gemini with rule-based fallback, investment allocation analysis, and insurance gap reviews.
- **Data Export Suite**: Authenticated CSV export engine for Transactions, Accounts, Budgets, Goals, Investments, Loans, Insurance, Subscriptions, and Comprehensive Financial Summary.
- **Developer Experience & Containerization**: Multi-platform setup scripts (`setup-windows.ps1`, `setup-windows.bat`, `setup-unix.sh`), Docker & Docker Compose configuration, and comprehensive 47-assertion end-to-end test suite.
- **Multi-Tenant Data Isolation**: Strict user-ownership enforcement across all domain layers.
