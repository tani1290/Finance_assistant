# Jinay Finance AI — PostgreSQL Database Specification
**Database Engine:** PostgreSQL 17  
**ORM:** Prisma Client v5.22  
**Database Name:** `finance_jinay`  
**Connection String:** `postgresql://postgres:postgres2905@127.0.0.1:5432/finance_jinay`

---

## 1. Schema Design Principles

1. **Exact Precision for Monetary Values:** All monetary and currency columns use `Decimal(15, 2)` or `Decimal(15, 6)` for fractional asset quantities (e.g. crypto/gold grams). Floating-point inaccuracies are strictly prevented.
2. **Strict Foreign Key Cascading:** Deleting a user safely cascades across profiles, accounts, transactions, budgets, goals, loans, insurance, and tokens.
3. **Compound Indexes for Query Performance:**
   - `transactions`: `@@index([userId])`, `@@index([userId, date])`, `@@index([userId, transactionType])`
   - `budgets`: `@@unique([userId, categoryName, month, year])`
   - `investments`: `@@unique([portfolioId, symbol])`
   - `market_watchlist`: `@@unique([userId, symbol])`
   - `calendar_events`: `@@index([userId, eventDate])`
   - `financial_health_history`: `@@index([userId, createdAt])`

---

## 2. Core Entities & Relationships

```
                                  ┌───────────────────────────┐
                                  │           User            │
                                  │ (id, email, username, ...)│
                                  └─────────────┬─────────────┘
                                                │
         ┌──────────────────┬───────────────────┼───────────────────┬──────────────────┐
         │ 1:1              │ 1:1               │ 1:N               │ 1:N              │ 1:1
         ▼                  ▼                   ▼                   ▼                  ▼
┌──────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│     Profile      │ │FinancialProfile│ │FinancialAccount│ │  Transaction   │ │   Portfolio    │
└──────────────────┘ └────────────────┘ └───────┬────────┘ └────────────────┘ └───────┬────────┘
                                                │ 1:N                                  │ 1:N
                                                ▼                                      ▼
                                       ┌────────────────┐                     ┌────────────────┐
                                       │  Transaction   │                     │   Investment   │
                                       └────────────────┘                     └────────────────┘
```

---

## 3. Core Table Inventory (23 of 41 Models)

> The table below covers the original finance/AI core. The schema now contains
> **41 models**; the additional tables cover FCM tokens, recommendation feedback,
> cash-flow/simulation history, category corrections, receipts, market/commodity
> prices, exports, audit logs, ML datasets/training/predictions, payment cards,
> financial tasks, mobile devices, pending SMS review and AI action proposals.
> `prisma/schema.prisma` is the source of truth.

| Table Name | Model | Purpose | Key Constraints |
|---|---|---|---|
| `users` | `User` | Core authentication & user state | `email UNIQUE`, `username UNIQUE`, `googleId UNIQUE` |
| `refresh_tokens` | `RefreshToken` | JWT refresh tokens & session management | `token UNIQUE`, `userId -> users.id (CASCADE)` |
| `profiles` | `Profile` | Extended bio and demographic information | `userId UNIQUE` |
| `financial_profiles` | `FinancialProfile` | Onboarding parameters (income, expenses, risk) | `userId UNIQUE` |
| `financial_plans` | `FinancialPlan` | Computed baseline 50/30/20 financial roadmap | `userId UNIQUE` |
| `financial_accounts` | `FinancialAccount` | Bank accounts, cash wallets, credit cards | `userId -> users.id` |
| `categories` | `Category` | Income & expense category taxonomies | `userId -> users.id (nullable for defaults)` |
| `transactions` | `Transaction` | Financial ledger records (incomes/expenses) | `accountId`, `categoryId`, `date INDEX` |
| `budgets` | `Budget` | Category monthly spending limits | `UNIQUE(userId, categoryName, month, year)` |
| `goals` | `Goal` | Target savings goals & milestone tracker | `userId -> users.id`, `targetDate` |
| `portfolios` | `Portfolio` | Aggregated investment account per user | `userId UNIQUE` |
| `investments` | `Investment` | Asset holdings (Stocks, Gold, Mutual Funds, Crypto)| `UNIQUE(portfolioId, symbol)` |
| `market_watchlist` | `MarketWatchlist` | User's tracked stocks & tickers | `UNIQUE(userId, symbol)` |
| `loans` | `Loan` | Debt obligations, interest rates & EMIs | `userId -> users.id`, `status` |
| `insurance_policies`| `InsurancePolicy`| Life, health, and asset insurance policies | `userId -> users.id`, `renewalDate` |
| `subscriptions` | `Subscription` | Recurring SaaS & utility charges | `userId -> users.id`, `nextBillingDate` |
| `calendar_events` | `CalendarEvent` | Due dates, bills, custom events | `userId -> users.id`, `eventDate INDEX` |
| `notifications` | `Notification` | Real-time in-app alerts and notifications | `userId -> users.id`, `isRead INDEX` |
| `chat_messages` | `ChatMessage` | Conversational history with Gemini AI | `userId -> users.id`, `createdAt` |
| `ai_recommendations`| `AIRecommendation` | Actionable intelligence cards | `userId -> users.id` |
| `ai_action_proposals` | `AiActionProposal` | One-time, hashed AI mutation confirmations (Phase 3) with an explicit execution state (Phase 4) | `tokenHash UNIQUE`, `(userId, status) INDEX`, `expiresAt INDEX`, `userId -> users.id (CASCADE)`; `status` ∈ `PENDING → EXECUTING → COMPLETED \| FAILED` plus `CANCELLED` / `EXPIRED`; audit columns `executionStartedAt`, `attempts`, `lastError`, `retryable` |
| `financial_health_history` | `FinancialHealthHistory` | Historical 10-factor score tracking | `userId -> users.id`, `createdAt INDEX` |
| `expense_anomalies` | `ExpenseAnomaly` | Outlier expense records detected by rules/ML | `userId -> users.id`, `userFeedback` |

---

## 4. Database Verification Commands

To verify database status and inspect tables via CLI:
```bash
# Check connectivity
node node-backend/test-db.js

# Generate Prisma Client
npx prisma generate

# Inspect tables via Prisma Studio
npx prisma studio
```

---

## 5. Schema Reconciliation on Deploy

Local development **and** the Render PostgreSQL production database are both maintained with
`prisma db push`. Neither has a `_prisma_migrations` history, so `prisma migrate
deploy` cannot adopt them on its own (Prisma P3005: *"The database schema is not
empty"*).

Deployments therefore run:

```bash
npm --prefix node-backend run db:reconcile      # = node scripts/deploy-migrate.js
```

The script:

1. Runs `prisma migrate deploy` — correct for a migration-managed database, and what
   a brand-new database gets (all three migrations in `prisma/migrations`).
2. If the schema is non-empty and unrecorded, falls back to an **additive**
   `prisma db push`. `--accept-data-loss` is never passed, so this step can create
   missing tables and indexes but can never drop a column or a table.
3. Logs the real outcome. A failing Prisma exit is reported loudly but does not stop
   the server from booting.

A missing table surfaces to clients as a bare HTTP 500 (`P2021 The table does not
exist`) or a feature-level `SYNC_ERROR`, so this script's output is the first place
to look when a cloud feature misbehaves.

**Connection caveat:** production uses **Render PostgreSQL** over Render's
internal network, which is a direct connection and can execute DDL, so
`DIRECT_URL` is not required there. The variable only matters if you point
`DATABASE_URL` at a *transaction-mode* pooler — the classic case is Supabase's
port 6543 / PgBouncer — because Prisma cannot run `CREATE`/`ALTER` through one.
For such setups, set `DIRECT_URL` to a direct (`db.<ref>.supabase.co:5432`) or
session-pooler (`aws-0-<region>.pooler.supabase.com:5432`) connection. When it
is absent, `deploy-migrate.js` derives the session pooler from `DATABASE_URL`.

Verify after a deploy:

```bash
cd node-backend
npm run db:reconcile:strict     # exits 1 if the schema could not be reconciled
```

---

## 5. PostgreSQL Lifecycle, Continuity & Disaster Recovery

### 5.1 Render Free-Tier Expiry Notice
Render free PostgreSQL instances are ephemeral and subjected to an expiration date (historically scheduled for November 11, 2026). Upon expiration, Render suspends the instance and deletes all database files after a 14-day grace period unless upgraded.

### 5.2 Backup Automation & Verification
To ensure business continuity and zero data loss:
1. **Automated Remote Backups:** GitHub Actions workflow `.github/workflows/backup.yml` is configured to run daily.
   - Required Repository Secrets: `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
   - Required Variables: `BACKUP_S3_BUCKET`, `BACKUP_ENABLED=true`.
2. **Local Encrypted Backups:**
   ```bash
   npm --prefix node-backend run backup:encrypted
   ```
   Uses AES-256-GCM encryption with SHA-256 integrity validation and stores a timestamped manifest alongside the encrypted payload.
3. **Isolated Test Restoration:**
   ```bash
   npm --prefix node-backend run verify:backup:restore
   ```
   Restores the latest backup into a temporary scratch database, verifies record counts and relationships, and cleanly tears down the scratch database without mutating production.

### 5.3 Database Migration / Cutover Plan
When migrating from Render free tier to a paid instance or alternate cloud provider (e.g., Supabase, Neon, or AWS RDS):
1. Create new PostgreSQL instance (PostgreSQL 16+).
2. Take a final consistent backup using `node scripts/backup-db.js --remote`.
3. Restore into the destination database using `TARGET_DATABASE_URL=<new_db_url> node scripts/restore-db.js --file <latest_backup>`.
4. Validate schema and constraints: `DATABASE_URL=<new_db_url> npm run db:reconcile:strict`.
5. Update `DATABASE_URL` in the Render Web Service environment settings and trigger a redeploy.
6. Verify service health at `/health` and verify transaction integrity.
