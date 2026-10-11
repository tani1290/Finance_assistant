# FinPro — Firebase + Deployment Integration Guide

## What Was Implemented

### 1. Firebase Auth (Google Sign-In)
- **Flutter**: `google_sign_in` + `firebase_auth` for native Google OAuth flow
- **Backend**: Existing `/api/v1/auth/google/token` endpoint validates Firebase ID tokens
- **Login Screen**: "Sign in with Google" button added below email/password form

### 2. Firebase Cloud Messaging (FCM)
- **Backend**: `fcmService.js` — Firebase Admin SDK sends push notifications
- **Backend**: `fcmController.js` + `notificationRoutes.js` — Token registration endpoints
- **Backend**: `smsController.js` — Auto-sends push when bank SMS transaction is confirmed
- **Flutter**: `firebase_service.dart` — Registers FCM token on login, handles foreground/background messages
- **Database**: New `fcm_tokens` table via Prisma schema

### 3. Firebase Analytics + Crashlytics
- **Flutter**: Analytics events on login/register (method: email/google)
- **Flutter**: Crashlytics error reporting (release builds only)
- **Flutter**: User ID set in both services on auth

### 4. Deployment Configs
- **`render.yaml`** — Updated with `FIREBASE_SERVICE_ACCOUNT_JSON` env var
- **`vercel.json`** — Created for frontend static deployment with API proxy
- **`.env.example`** — Documented Firebase env variable

---

## Setup Steps (You Must Do)

### Step 1: Create Firebase Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project → name it **"FinPro"**
3. Enable **Google Analytics** when prompted

### Step 2: Add Android App
1. In Firebase Console → **Add App** → Android
2. Package name: `com.finpro.app.finpro_mobile`
3. Download `google-services.json`
4. **Replace** the placeholder file at:
   ```
   mobile/android/app/google-services.json
   ```

### Step 3: Enable Firebase Auth
1. Firebase Console → **Authentication** → **Sign-in method**
2. Enable **Email/Password**
3. Enable **Google** (set your project support email)

### Step 4: Get Service Account Key (for Backend)
1. Firebase Console → **Project Settings** → **Service Accounts**
2. Click **"Generate new private key"**
3. Download the JSON file
4. For local development, add to `node-backend/.env`:
   ```
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"finpro-xxxxx",...}
   ```
   (Paste the entire JSON as a single line)

### Step 5: Deploy Backend to Render
1. Go to [render.com](https://render.com) → **New** → **Blueprint**
2. Connect your GitHub repo
3. Render will read `render.yaml` and auto-configure everything
4. In Render dashboard, set these environment variables:
   - `DATABASE_URL` → Your Supabase connection string
   - `GEMINI_API_KEY` → Your Gemini key
   - `FIREBASE_SERVICE_ACCOUNT_JSON` → Paste service account JSON
   - Any other API keys from `.env.example`

### Step 6: Deploy Frontend to Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# From project root
vercel --prod
```
Or connect your GitHub repo at [vercel.com](https://vercel.com) for auto-deploy.

### Step 7: Update CORS
After deploying, update `FRONTEND_URL` in Render to match your actual Vercel URL:
```
https://finpro-finance-ai.vercel.app
```

### Step 8: Build & Install APK
```bash
cd mobile
flutter build apk --debug
# Install on device
adb install build/app/outputs/flutter-apk/app-debug.apk
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        FinPro Architecture                       │
├────────────────────┬──────────────────┬─────────────────────────┤
│   Vercel (CDN)     │  Render (PaaS)   │  Firebase (BaaS)        │
│   Frontend SPA     │  Node.js Backend │  Auth + FCM + Analytics │
│   HTML/CSS/JS      │  Express + Prisma│  + Crashlytics          │
│                    │                  │                          │
│   /api/* → proxy   │  PostgreSQL      │  google-services.json   │
│   to Render        │  (Supabase)      │  Admin SDK on backend   │
└────────────────────┴──────────────────┴─────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Flutter Mobile   │
                    │   Firebase Auth    │
                    │   FCM Push Notif   │
                    │   Google Sign-In   │
                    │   SMS Detection    │
                    └───────────────────┘
```

## Cloud Computing Course Talking Points
- **IaaS**: Supabase PostgreSQL (managed cloud database)
- **PaaS**: Render (Node.js serverless web service)
- **BaaS**: Firebase (Auth, FCM, Analytics, Crashlytics)
- **CDN**: Vercel (static frontend edge network)
- **Multi-Cloud**: Combines Google Cloud (Firebase), AWS (Supabase), Render (Oregon)

---

## Files Changed/Created

| File | Action | Purpose |
|------|--------|---------|
| `node-backend/src/services/fcmService.js` | **Created** | Firebase Admin SDK push notification service |
| `node-backend/src/controllers/fcmController.js` | **Created** | FCM token registration endpoints |
| `node-backend/src/routes/notificationRoutes.js` | **Created** | Notification route definitions |
| `node-backend/src/routes/index.js` | **Modified** | Wired notification routes |
| `node-backend/src/controllers/smsController.js` | **Modified** | FCM push on transaction confirm |
| `node-backend/prisma/schema.prisma` | **Modified** | Added `FcmToken` model |
| `node-backend/package.json` | **Modified** | Added `firebase-admin` |
| `node-backend/.env.example` | **Modified** | Documented Firebase env var |
| `mobile/pubspec.yaml` | **Modified** | Added Firebase + Google Sign-In packages |
| `mobile/lib/main.dart` | **Modified** | Firebase init + Crashlytics |
| `mobile/lib/core/firebase/firebase_service.dart` | **Created** | Full Firebase service singleton |
| `mobile/lib/core/auth/auth_notifier.dart` | **Modified** | FCM token + Google Sign-In + Analytics |
| `mobile/lib/core/api/api_endpoints.dart` | **Modified** | Added googleToken + fcmToken endpoints |
| `mobile/lib/features/auth/login_screen.dart` | **Modified** | Google Sign-In button |
| `mobile/android/app/build.gradle.kts` | **Modified** | Google Services plugin |
| `mobile/android/settings.gradle.kts` | **Modified** | Google Services classpath |
| `mobile/android/app/google-services.json` | **Created** | Placeholder (replace with real) |
| `render.yaml` | **Modified** | Firebase env var + updated FRONTEND_URL |
| `vercel.json` | **Created** | Vercel deployment config |
