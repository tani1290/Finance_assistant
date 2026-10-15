# FinPro Hosting and Testing Guide

Last updated: 2026-10-12

This guide explains how to host FinPro publicly and test it after deployment.

FinPro has three deployable parts:

- **Node/Express backend** in `node-backend/`
- **Static web frontend** in `frontend/public/`
- **Flutter mobile app** in `mobile/`

The backend also needs a PostgreSQL database. Do not deploy the frontend alone unless the backend is already live.

## Recommended Hosting Path

Use:

- **Supabase or Neon** for PostgreSQL
- **Render** for the Node backend
- **Vercel** for the static frontend
- **Firebase** for mobile auth, notifications, analytics, and crash reporting

This matches the existing `render.yaml`, `vercel.json`, and `docs/DEPLOYMENT.md` files.

## 1. Pre-Deployment Checks

Run these locally before hosting:

```bash
npm run lint
npm run build
npm test
node node-backend/scripts/scan-secrets.js

cd mobile
flutter analyze
flutter test
```

Expected result:

- Backend lint passes.
- Backend build passes.
- Backend integration tests pass.
- Secret scan reports zero tracked secrets.
- Flutter analyze reports no issues.
- Flutter tests pass.

## 2. Create PostgreSQL Database

### Option A: Supabase

1. Create a Supabase project.
2. Go to **Project Settings** -> **Database** -> **Connection string**.
3. Use the pooled connection string if deploying on Render.
4. Ensure the URL includes SSL and schema parameters where needed.

Example shape:

```env
DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require&schema=public"
```

### Option B: Neon

1. Create a Neon project.
2. Copy the PostgreSQL connection string.
3. Use the pooled connection string for serverless/PaaS deployment.

## 3. Prepare Production Environment Variables

Create these values before deploying the backend:

```env
NODE_ENV=production
PORT=5000
DATABASE_URL="your_postgres_connection_url"

JWT_SECRET="generate_a_long_random_secret"
JWT_REFRESH_SECRET="generate_a_different_long_random_secret"
JWT_EXPIRES_IN=60m
JWT_REFRESH_EXPIRES_IN=7d

GEMINI_API_KEY="your_google_gemini_key"
AI_MODEL=gemini-2.5-flash

FINNHUB_API_KEY="your_finnhub_key"
ALPHA_VANTAGE_API_KEY="your_alpha_vantage_key"
MARKETAUX_API_KEY="your_marketaux_key"
MARKETAUX_BASE_URL=https://api.marketaux.com/v1

FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account", "...":"..."}'

FRONTEND_URL="https://your-vercel-domain.vercel.app"
CURRENCY=INR
LOCALE=en-IN
TIMEZONE=Asia/Kolkata
```

Generate secrets with:

```bash
openssl rand -base64 48
```

## 4. Deploy Backend on Render

The repo already includes `render.yaml`.

1. Push the repo to GitHub.
2. Open Render.
3. Create **New Blueprint Instance**.
4. Connect the GitHub repository.
5. Render will detect `render.yaml`.
6. Fill all `sync: false` environment variables:
   - `DATABASE_URL`
   - `GEMINI_API_KEY`
   - `FINNHUB_API_KEY`
   - `ALPHA_VANTAGE_API_KEY`
   - `MARKETAUX_API_KEY`
   - `FIREBASE_SERVICE_ACCOUNT_JSON`
7. Deploy.

Render uses:

```bash
npm --prefix node-backend install && npm --prefix node-backend run build
```

and starts with:

```bash
cd node-backend && node scripts/deploy-migrate.js && (node prisma/seed.js || true) && node src/server.js
```

`scripts/deploy-migrate.js` reconciles the schema before the server binds:

1. `prisma migrate deploy` — for a migration-managed database.
2. Falls back to an **additive** `prisma db push` (never `--accept-data-loss`) when
   the database has tables but no `_prisma_migrations` history (Prisma P3005) —
   which is how this project's Supabase instance was created.
3. Prints the real outcome. A failure is loud but never blocks the boot.

Prisma cannot run DDL through Supabase's **transaction** pooler (port 6543). If
migrations fail with a pooler error, set `DIRECT_URL` in the Render dashboard to
your Supabase **direct** connection (`db.<ref>.supabase.co:5432`) or **session**
pooler (`aws-0-<region>.pooler.supabase.com:5432`). When `DIRECT_URL` is unset the
script derives the session pooler from `DATABASE_URL` on its own.

After deployment, verify:

```bash
curl -f https://your-render-service.onrender.com/api/v1/health
curl -f https://your-render-service.onrender.com/api/v1/health/database
curl -f https://your-render-service.onrender.com/ready
```

## 5. Deploy Frontend on Vercel

The repo already includes `vercel.json`.

Before deploying, update the API proxy destination in `vercel.json`:

```json
{
  "src": "/api/(.*)",
  "dest": "https://your-render-service.onrender.com/api/$1"
}
```

Then deploy:

```bash
vercel --prod
```

Or import the repository in the Vercel dashboard.

Set:

- Framework: **Other**
- Build command: `echo 'Static frontend - no build step required'`
- Output directory: `frontend/public`

After Vercel gives a public URL, update Render's `FRONTEND_URL` environment variable to that URL and redeploy the backend.

## 6. Firebase Setup

1. Create a Firebase project.
2. Register Android app package:

```text
com.finpro.app.finpro_mobile
```

3. Download `google-services.json`.
4. Place it at:

```text
mobile/android/app/google-services.json
```

5. Enable Firebase Authentication providers:
   - Email/password
   - Google
6. Generate a service account JSON from Firebase project settings.
7. Put the minified single-line JSON into `FIREBASE_SERVICE_ACCOUNT_JSON` on Render.

## 7. Build Mobile APK

After the backend URL is final, ensure the mobile API client points to the hosted backend if needed.

Then build:

```bash
cd mobile
flutter pub get
flutter build apk --release
```

APK output:

```text
mobile/build/app/outputs/flutter-apk/app-release.apk
```

## 8. Production Smoke Test Checklist

Test these after deployment:

```bash
curl -f https://your-backend.onrender.com/api/v1/health
curl -f https://your-backend.onrender.com/api/v1/health/database
curl -f https://your-backend.onrender.com/api/v1/health/market
curl -f https://your-backend.onrender.com/api/v1/health/ai
curl -f https://your-backend.onrender.com/api/v1/health/news
```

Then in the browser:

1. Open the Vercel frontend URL.
2. Register a new user.
3. Complete onboarding.
4. Add an account.
5. Add income and expense transactions.
6. Confirm dashboard totals update.
7. Test AI advisor.
8. Test market page.
9. Test export/download.
10. Log out and log back in.

## 9. Self-Hosted Docker Alternative

For a VPS or Oracle Cloud VM:

```bash
docker compose up -d --build
```

This starts PostgreSQL and the app locally.

For production VM deployment with external managed PostgreSQL:

```bash
cd /opt/finpro
bash deployment/deploy.sh
```

Recommended VM setup:

- Ubuntu 22.04 or 24.04
- Docker and Docker Compose plugin
- Nginx reverse proxy
- Let's Encrypt SSL certificate
- Managed PostgreSQL instead of local database for easier backups

## 10. Can Codex Deploy It For You?

Yes, Codex can help deploy it from this machine if the required access is available.

Codex can do:

- Run pre-deployment checks.
- Update config files such as `vercel.json`.
- Push changes if GitHub access is configured locally.
- Use logged-in CLIs such as `vercel`, `render`, `supabase`, `firebase`, or `docker`.
- Deploy to a VPS over SSH if you provide host access.
- Verify public health endpoints after deployment.

Codex cannot independently access your private hosting accounts unless you connect them, log in locally, or provide scoped deployment tokens/secrets.

Recommended safe approach:

1. You create the Supabase/Neon database.
2. You create Render and Vercel projects or log in through their CLIs.
3. You provide only required production environment variables through the hosting dashboards.
4. Codex runs the deployment commands and verifies the live URLs.

Never paste long-term personal passwords into chat. Prefer dashboard environment variables, short-lived tokens, or logged-in CLIs.
