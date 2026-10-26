# FinPro — Master Deployment, Cloud & Firebase Guide
**Project:** FinPro (AI-Powered Personal Finance & Investment Decision Support Platform)  
**Owner:** Jinay Golecha (`jinay_golecha`)  
**Target Environments:** Local Development | Docker Compose | Cloud (Render PaaS + Vercel CDN + Firebase BaaS + Render PostgreSQL)

---

## 1. System Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FinPro Multi-Cloud Topology                     │
├────────────────────┬──────────────────┬────────────────────────────────┤
│   Vercel (CDN)     │  Render (PaaS)   │  Firebase (BaaS)               │
│   Frontend SPA     │  Node.js Backend │  Auth + FCM Push Notifications │
│   HTML5 / CSS3 / JS│  Express + Prisma│  Analytics + Crashlytics       │
│                    │                  │                                │
│   /api/* → proxy   │  PostgreSQL      │  google-services.json          │
│   to Render        │  (Render Postgres│  Admin SDK on backend          │
└────────────────────┴──────────────────┴────────────────────────────────┘
                               │
                     ┌─────────┴─────────┐
                     │   Flutter Mobile   │
                     │   Firebase Auth    │
                     │   FCM Push Notif   │
                     │   SMS Auto-Detect  │
                     └───────────────────┘
```

---

## 2. Local Development Setup

### 2.1 Prerequisites
- **Node.js:** v20.x or higher
- **npm:** v10.x or higher
- **PostgreSQL:** v15+ (v17 recommended)
- **Flutter SDK:** v3.22+ (for mobile app)

### 2.2 Environment Configuration
Copy `.env.example` to `.env` in both root and `node-backend/`:
```bash
cp .env.example .env
cp node-backend/.env.example node-backend/.env
```

Key environment variables in `node-backend/.env`:
```dotenv
PORT=5001
NODE_ENV=development
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/finance_jinay?schema=public"

JWT_SECRET="your_strong_jwt_secret"
JWT_REFRESH_SECRET="your_strong_refresh_jwt_secret"

GEMINI_API_KEY="your_gemini_api_key"
AI_MODEL="gemini-2.5-flash"

ALPHA_VANTAGE_API_KEY="your_alpha_vantage_key"
FINNHUB_API_KEY="your_finnhub_key"

CURRENCY=INR
TIMEZONE=Asia/Kolkata

# Firebase Admin SDK (Optional locally; FCM push degrades gracefully if empty)
FIREBASE_SERVICE_ACCOUNT_JSON=

# Optional resilience/observability (see OPERATIONS.md)
REDIS_URL=
METRICS_TOKEN=
```

Every variable in the optional block is safe to leave unset. Redis is an
accelerator, not a dependency: without it the app caches and rate-limits
per-process. `/metrics` is closed in production unless `METRICS_TOKEN` is set.

### 2.3 Database Setup & Migrations
```bash
cd node-backend
npm install
npx prisma generate
npx prisma db push
```

This project's database — local **and** production on Render PostgreSQL — is maintained with
`prisma db push`, so it has no `_prisma_migrations` history. Deployments therefore
run `npm run db:reconcile` (`scripts/deploy-migrate.js`), which attempts
`prisma migrate deploy` first and falls back to an additive `prisma db push` when the
schema is non-empty and unrecorded. See `render.yaml` for the full start command. The
optional `DIRECT_URL` migration connection is only needed when `DATABASE_URL` points at
a transaction-mode pooler; Render PostgreSQL's internal connection is used directly.

**AI confirmation schema gate.** Phase 3 adds the additive `AiActionProposal` model
(`prisma/migrations/20261021120000_ai_action_proposals`). Phase 4 adds the execution-state
columns to the same table (`prisma/migrations/20261021130000_ai_action_execution_state`:
`executionStartedAt`, `attempts`, `lastError`, `retryable`). The AI mutation path is
fail-closed and requires this table: deploy the schema **before or atomically with**
the backend that serves the new code. `db:reconcile` creates it via `db push` on this
repo's setup. After deploying, verify the table exists and smoke-test
`POST /ai/chat` → `POST /ai/actions/confirm` with a non-financial test user before
announcing the release. Never run `prisma migrate dev` against production.

**Exact migration procedure (staging).**

1. Take and verify a backup first: `npm run backup:db -- --encrypt --out-dir ./backups`
   and `npm run backup:verify` (local drill). The archive and its `.json` manifest must
   both be present; the manifest carries the SHA-256 that the restore path re-checks.
2. Apply the schema with the same command the deploy uses:
   `npm run db:reconcile` (additive `prisma db push` fallback) or, on a
   migration-managed database, `npx prisma migrate deploy`.
3. Confirm the result: the `ai_action_proposals` table must have `executionStartedAt`,
   `attempts`, `lastError` and `retryable`; `status` keeps its `PENDING` default.
   Verify with `psql -c '\d ai_action_proposals'`.
4. Verify the application agrees with the schema: `npm run build` regenerates the
   Prisma client and now **fails the build** if the generated client is missing any
   required model field. A stale client is a runtime 500, not a build error, so this
   check is mandatory before a release.
5. Smoke-test: `POST /ai/chat` (expect `pendingConfirmation: true`),
   `POST /ai/actions/confirm` (expect `executionState: "COMPLETED"`), then replay the
   same token (expect `409 ACTION_ALREADY_COMPLETED` or `ACTION_IN_PROGRESS`).

**Rollback limitations.**

- The Phase 3, Phase 4 and Phase 5 migrations are **additive only**: they create
  tables and add columns. No financial row is read, rewritten or deleted by
  them, so a rollback is a code rollback, not a data restore.
- Rolling the *code* back to a Phase 3 build is safe while the extra columns
  exist: the older code ignores them. The reverse (new code on an old schema)
  is **not** safe — the confirmation path would fail with "column does not
  exist". Deploy the schema first.
- If the columns must be removed, that is a destructive `ALTER TABLE ... DROP COLUMN`
  and it discards the execution audit trail (`attempts`, `lastError`). It is not
  required for a rollback and should not be done automatically.
- `prisma migrate deploy` cannot be undone automatically: there is no down-migration
  in this repository. On a db-push-managed database (this project's production setup)
  the schema is reconciled by `db push`, so a rollback of the code leaves the extra
  columns in place — which is the desired outcome.

**Phase 5 schema note — why the idempotency guarantee is a new table.**
The deposit idempotency guarantee is a primary key on the new
`idempotency_records` table, **not** a unique index on `transactions`. Adding a
unique constraint to an existing table makes `prisma db push` classify the
change as a possible data loss and refuse to run without
`--accept-data-loss`, which this project never passes. The consequence would
be that `db:reconcile` fails on the deploy-time reconciliation and the new
column never reaches the database. A new table with a primary key is a safe,
additive change for `db push` and is equally strong, because the second insert
of the same `(userId, scope, key)` fails with a primary-key violation. This
was verified by running `prisma db push` against a clone of a populated
database: it applied cleanly, with no data-loss warning, and every row was
preserved.

### 2.4 Running the Application
```bash
# Start backend (serves API on port 5001 and SPA at http://localhost:5001)
npm run dev

# Or from project root
npm run dev
```

---

## 3. Firebase Setup (Auth, FCM & Mobile)

### Step 1: Firebase Project
1. Navigate to [Firebase Console](https://console.firebase.google.com/).
2. Create project: **"FinPro"** (Enable Google Analytics).

### Step 2: Android App Registration
1. Add Android App with package name: `com.finpro.app.finpro_mobile`.
2. Download `google-services.json` and place it in:
   `mobile/android/app/google-services.json`

### Step 3: Enable Authentication
1. Go to **Authentication** → **Sign-in method**.
2. Enable **Email/Password** and **Google**.

### Step 4: Backend Service Account Key
1. Go to **Project Settings** → **Service Accounts**.
2. Click **Generate new private key** to download the JSON credentials.
3. Paste the entire JSON string into `FIREBASE_SERVICE_ACCOUNT_JSON` in `node-backend/.env` (or in Render environment variables):
   ```dotenv
   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"finpro-xxxxx",...}'
   ```

---

## 4. Cloud Production Deployment

### 4.1 Backend Deployment on Render (PaaS)

**Current production state (verified 2026-10-26):**

| Item | Value |
|---|---|
| Service | `finpro-finance-ai` (`srv-db5sb1vavr4c739td7d0`) |
| Runtime | **Docker** (repository Dockerfile), free plan, Oregon, **1 instance** |
| Branch | `main` |
| URL | `https://finpro-finance-ai.onrender.com` |
| Health check path | `/api/v1/health` |
| Deployed release | `f6cdf9f` — health probes exempted from the general rate limiter (Phase 9 P0 fix), on top of `020a49d` (`574337d` storage 404 passthrough + Phase 8 docs); deployed 2026-10-26 as `dep-dbfl1oq9lscs73ahr2hg` |
| Database | `finpro-db`, free plan — **expires 2026-11-11** ([BACKUP_DR.md](BACKUP_DR.md) §13.2) |
| Storage | local provider, **ephemeral** ([OPERATIONS.md](OPERATIONS.md) §7) |

**Branch note.** The Render service tracks `main`, but `origin/main` is behind the
release branch. Deploys are made for an exact SHA from
`finpro/pre-deployment-checkpoint` with `--commit`, so the deployed code is
newer than `origin/main`. Do not assume that pushing `main` ships the current
tree; check `render deploys list` for the live SHA.

**Deploy commands.** Render's `autoDeploy` did **not** fire for a push in
Phase 8 or Phase 9, so treat deployment as an explicit step rather than assuming
a push ships:

```bash
# 1. Fast-forward main (never force-push).
git push origin <sha>:refs/heads/main

# 2. Trigger the deploy for that exact commit and wait.
render deploys create srv-db5sb1vavr4c739td7d0 --commit <sha> --wait --confirm
```

Then confirm the deploy record reports the same SHA and probe the live host (§6).
A successful `git push` is not evidence that new code is serving traffic.

**Blueprint drift (known, not fixed).** `render.yaml` declares `runtime: node` and
`healthCheckPath: /api/v1/health/live`. The live service is Docker with
`healthCheckPath: /api/v1/health`. Do not re-apply the blueprint to "correct" it
without a planned migration: re-applying can recreate or reconfigure the service.
Both paths are safe liveness probes; `/api/v1/health/ready` is not.

For a first-time setup:

1. In [Render Dashboard](https://render.com), create a **New Blueprint Instance**.
2. Connect this repository. Render reads [`render.yaml`](../render.yaml) and configures the web service.
3. Supply required production environment variables:
   - `DATABASE_URL`: Render PostgreSQL connection URL (use the service's internal
     connection string when the app runs in the same Render region).
   - `GEMINI_API_KEY`: Google Gemini API key.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: Single-line Firebase service account JSON.
   - `JWT_SECRET` & `JWT_REFRESH_SECRET`: Secure cryptographic strings.
   - `FRONTEND_URL`: URL of the deployed frontend on Vercel.
4. Optional operational variables (none are required to boot):
   - `REDIS_URL`: shared cache/rate-limit store. Leave empty for memory-only.
   - `METRICS_TOKEN`: long random token for `/metrics`. Without it, production
     returns `404`.
   - `PUSH_QUEUE_MAX` / `PUSH_CONCURRENCY` / `PUSH_MAX_ATTEMPTS`: bounds for the
     best-effort push queue. Defaults are `200` / `2` / `3`.
   - `STORAGE_PROVIDER` and `S3_*`: durable object storage. Unset means local,
     ephemeral disk ([OPERATIONS.md](OPERATIONS.md) §7).
5. Set the platform health check to a **liveness** path. On the live Docker service
   that is `/api/v1/health`; on a blueprint service it is `/api/v1/health/live`. The
   strict `/api/v1/health/ready` checks object storage, so using it would restart a
   healthy process during a storage outage.

### 4.2 Frontend Deployment on Vercel (Edge CDN)

**Current production state:** project `fin-pro`, production URL
`https://fin-pro-wheat.vercel.app`. Deploys are **manual CLI**, not Git-integrated:
a push to `main` does not publish the frontend.

```bash
cd "tanishq version"
vercel --prod --yes
```

[`vercel.json`](../vercel.json) proxies `/api/*` to the Render backend and serves
`frontend/public` statically. After deploying, verify the live host directly:

```bash
for p in / /privacy.html /terms.html /delete-account.html /simulator.html; do
  curl -s -o /dev/null -w "$p %{http_code} %{size_download}\n" "https://fin-pro-wheat.vercel.app$p"
done
```

Note that `/privacy-policy`, `/account-deleted` and similar are **Flutter in-app
routes**, not web URLs; they return 404 on Vercel by design. The public web URLs are
the `.html` files above.

### 4.3 Containerized Deployment (Docker Compose)
```bash
# Build and run backend + PostgreSQL with health probes
docker-compose up -d --build
```

---

## 5. Mobile App Build & Distribution

```bash
cd mobile
flutter pub get
flutter build apk --release
# APK is generated at: mobile/build/app/outputs/flutter-apk/app-release.apk
```

A release build fails fast when `android/key.properties` and the keystore are
incomplete; it never falls back to the debug key. Before uploading to Play, read
[GOOGLE_PLAY_COMPLIANCE.md](GOOGLE_PLAY_COMPLIANCE.md): it records the required
public privacy policy and account-deletion URLs, the SMS disclosure/consent
behaviour, the merged-manifest permissions, Data Safety inputs, and the manual
console actions that code cannot perform.

---

## 6. Production Verification Probes

Verify the deployed system using the right probe for the right question. The host
below is the live Render service; replace it only if the service is recreated.

```bash
HOST=https://finpro-finance-ai.onrender.com

# 1. Liveness — no dependencies, always 200 while the process answers.
curl -f "$HOST/api/v1/health/live"

# 2. Summary health — the Render platform health check on the live Docker service.
curl -f "$HOST/api/v1/health"

# 3. Dependency gate — database is required; cache/storage are reported, not fatal.
curl -f "$HOST/api/v1/health/dependencies"

# 4. Readiness — database and storage must both be available.
#    Availability only: a non-durable local provider still reports ready.
curl -f "$HOST/api/v1/health/ready"

# 5. Database-only / storage-only probes
curl -f "$HOST/api/v1/health/database"
curl -f "$HOST/api/v1/health/storage"

# 6. Metrics — only if METRICS_TOKEN is configured; otherwise 404.
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" "$HOST/metrics" | head
```

**Results on 2026-10-26** (deployed `f6cdf9f`, re-probed after the health-probe fix):

| Probe | Status | Key fields |
|---|---|---|
| `/api/v1/health/live` | 200 | `live:true` |
| `/api/v1/health` | 200 | `database:"connected"`, `storageProvider:"local"`, `storageDurable:false`, `version:"1.1.0"` |
| `/api/v1/health/dependencies` | 200 | database healthy; cache `disabled` (optional); storage `available`, `durable:false` |
| `/api/v1/health/ready` | 200 | database healthy; storage `available` via local provider |
| `/api/v1/health/database` | 200 | `provider:"PostgreSQL"`, `isCloud:true`, `final_year_project_nwmc` |
| `/api/v1/health/storage` | 200 | `cloudAvailable:true`, `durable:false`, `ephemeral:true` |
| `/metrics` | 404 | expected — `METRICS_TOKEN` is not configured |
| `GET /api/v1/storage/file/users/<id>/documents/<missing>` (authenticated, disposable account) | 404 | `File not found in storage` — provider 404 is passed through, not masked as a 503 outage (`574337d`). Synthetic account deleted afterwards. |
| 24 consecutive `/api/v1/health` probes over 4+ minutes | 200 × 24 | No `429`, no `REQ-ERROR` in the logs. Probes are exempt from the general limiter (`f6cdf9f`). |

Read the storage fields, not just the status code. `ready:true` with
`durable:false` means uploads work **and will be lost on the next deploy**
([OPERATIONS.md](OPERATIONS.md) §7).

Do not use `/api/v1/health` or `/api/v1/health/ready` as the platform liveness
check: both fail when storage is unavailable. See
[OPERATIONS.md](OPERATIONS.md) §2 for the full endpoint contract.

---

## 7. Pre-Deploy Gate

Run these **in order** and do not deploy on a failure. Expected counts are the ones
verified on 2026-10-26 against `f6cdf9f`; a lower count means tests were skipped or a
suite silently aborted. A higher count is fine only if you know which test was added.

```bash
# 1. Whitespace / conflict-marker sanity
cd "tanishq version"
git diff --check

# 2. Backend lint (syntax + secret scan)
cd node-backend
node scripts/lint.js
node scripts/scan-secrets.js

# 3. Custom backend suites → expect 166 / 41 / 29 / 17, all 0 failures
node run-all-tests.js
node test-sms-mobile-suite.js
node test-cloud-verification.js
node test-cloud-failure.js

# 3b. Idempotency verifiers (need a local database)
node scripts/verify-transfer-idempotency.js   # expect 62 / 62
node scripts/verify-deposit-idempotency.js    # expect 32 / 32
node scripts/verify-ai-confirmation.js

# 4. Jest unit/security/failure suites → expect 572 passing, 35 suites
npm run test:unit

# 5. Backup/restore drill (local throwaway databases only). Covers plaintext,
#    encrypted, non-empty-target refusal and wrong-key rejection.
npm run backup:verify

# 5b. Off-host publishing dry run against a local encrypted archive:
npm run backup:publish -- --file /secure/finpro-backups/finpro-....dump.enc
#     No network call is made without --execute.

# 6. Mobile static analysis + widget tests → expect "No issues found" and 239 passing
cd ../mobile
flutter analyze --no-pub
flutter test --no-pub

# 7. Release build
flutter build apk --release
flutter build appbundle --release
```

The backup drill is not a production recovery. It proves the tooling, not that an
off-host production backup exists — see [BACKUP_DR.md](BACKUP_DR.md). A production
dump and isolated restore were executed once on 2026-10-26 (§13.1); that is
point-in-time evidence, not a schedule.

There is no automated gate for `frontend/public` (static files, no build step). Before shipping a web change, open the affected page, exercise the create/update/delete it touches, and confirm the request shape against `API.md` — in particular that date-only fields are `YYYY-MM-DD` and that money is never posted as a computed balance.

### Configuration checklist

- `DATABASE_URL` points at the intended database; migrations were applied with `npx prisma migrate deploy` (never `migrate dev` against production).
- `JWT_SECRET` / refresh secret are set and rotated per environment; they are never committed.
- `GEMINI_API_KEY` is set **or** the deployment accepts degraded assistant behaviour (deterministic engine + RAG still work; see `AI.md` §5). Never treat a missing key as a startup failure — the backend is designed to fall back.
- CORS origins list the deployed web origin.
- `NODE_ENV=production` so error details are not returned to clients.
- Render health check is a **liveness** path: `/api/v1/health` on the live Docker
  service, `/api/v1/health/live` on a blueprint service. Never `/api/v1/health/ready`.
- Health probes are exempt from the general API limiter, and the interactive budget
  is `1000`/15 min. The auth limiter is separate at `100`/15 min. Do not re-add
  health to the general limiter: platform probes run every few seconds and will
  exhaust a small budget, producing `429` → unhealthy → restart
  ([OPERATIONS.md](OPERATIONS.md) §2.1).
- `METRICS_TOKEN` is set if metrics are scraped; otherwise `/metrics` returns `404`
  in production.
- `REDIS_URL` is unset or reachable. A Redis outage degrades to memory; it is not a
  reason to roll back.
- Object storage is configured for durable uploads, or the local fallback and its
  non-durability are accepted. Current production is local/ephemeral — uploads are
  lost on redeploy ([OPERATIONS.md](OPERATIONS.md) §7).
- `BACKUP_ENCRYPTION_KEY` is set on the backup host and stored separately from the
  archives.
- A backup runs **outside** the web container and copies archives off-host. The
  daily job is `.github/workflows/backup.yml`; it requires the backup database URL,
  encryption key and object-storage credentials as repository secrets, plus
  `BACKUP_S3_BUCKET` and `BACKUP_ENABLED=true` as repository variables. See
  [BACKUP_DR.md](BACKUP_DR.md).

### Smoke checks after deploy

```bash
HOST=https://finpro-finance-ai.onrender.com
curl -f "$HOST/api/v1/health/live"
curl -f "$HOST/api/v1/health"
curl -f "$HOST/api/v1/health/dependencies"
curl -f "$HOST/api/v1/health/database"
```

Also confirm the deploy record's commit SHA matches the SHA you pushed, and check
`storageDurable` in `/api/v1/health`. A 200 from a previous build is not proof that
the new build is serving.

Then sign in on the web and on the APK and verify, in this order: dashboard totals → create a transaction → balance changed → budget/goal totals reflect it → calendar shows the EMI/renewal → assistant answers a read-only question and states a real number. A wrong number here means the contract changed; stop and compare against `API.md` §10.

### Rollback

Redeploy the previous build artifact. If a migration is implicated, stop writes and
follow the isolated-restore procedure in [BACKUP_DR.md](BACKUP_DR.md) — do not
restore over the live database, and do not attempt an ad-hoc down-migration. The
schema changes in this project are additive.
