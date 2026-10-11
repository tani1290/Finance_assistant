# FinPro — Master Deployment, Cloud & Firebase Guide
**Project:** FinPro (AI-Powered Personal Finance & Investment Decision Support Platform)  
**Owner:** Jinay Golecha (`jinay_golecha`)  
**Target Environments:** Local Development | Docker Compose | Cloud (Render PaaS + Vercel CDN + Firebase BaaS + Supabase DB)

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
│   to Render        │  (Supabase / Neon│  Admin SDK on backend          │
└────────────────────┴──────────────────┴────────────────────────────────┘
                               │
                     ┌─────────┴─────────┐
                     │   Flutter Mobile   │
                     │   Firebase Auth    │
                     │   FCM Push Notif   │
                     │   Google Sign-In   │
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
```

### 2.3 Database Setup & Migrations
```bash
cd node-backend
npm install
npx prisma generate
npx prisma db push
```

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
1. In [Render Dashboard](https://render.com), create a **New Blueprint Instance**.
2. Connect this repository. Render automatically reads [`render.yaml`](../render.yaml) and configures the web service.
3. Supply required production environment variables:
   - `DATABASE_URL`: Supabase or Neon PostgreSQL connection URL.
   - `GEMINI_API_KEY`: Google Gemini API key.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: Single-line Firebase service account JSON.
   - `JWT_SECRET` & `JWT_REFRESH_SECRET`: Secure cryptographic strings.
   - `FRONTEND_URL`: URL of the deployed frontend on Vercel.

### 4.2 Frontend Deployment on Vercel (Edge CDN)
[`vercel.json`](../vercel.json) proxies all `/api/*` traffic automatically to the Render backend:
```bash
# Deploy via Vercel CLI
vercel --prod
```
Or import the repository directly in the [Vercel Dashboard](https://vercel.com).

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

---

## 6. Production Verification Probes

Verify the deployed system using the live health probes:

```bash
# Application liveliness
curl -f https://your-backend.onrender.com/api/v1/health

# Database connectivity & latency probe
curl -f https://your-backend.onrender.com/api/v1/health/database

# Readiness probe
curl -f https://your-backend.onrender.com/ready
```
