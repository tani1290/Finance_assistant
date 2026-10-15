# Jinay Finance AI — Known Limitations & External Service Notes
**Project:** Jinay Finance AI  
**Owner:** Jinay Golecha (`jinay_golecha`)

---

## 1. External API Quotas & Rate Limits

### 1.1 Alpha Vantage (Free Tier)
- **Rate Limit:** Standard free tier accounts are limited to **25 requests per day** and **5 requests per minute**.
- **Engine Mitigation:** The backend implements an intelligent in-memory TTL caching engine (`marketService.js`):
  - Live Quotes: Cached for 3 minutes.
  - Multi-Timeframe Charts: Cached for 15 minutes.
  - Company Overview & Fundamentals: Cached for 1 hour.
  - Commodities & Metals: Cached for 5 minutes.
- **Graceful Fallback:** If Alpha Vantage quota is reached, the service automatically falls back to Finnhub for stock quotes, and uses verified reference prices in INR with transparent source badges.

### 1.2 Google Gemini AI
- **Model Support:** Defaults to `gemini-2.5-flash` with automatic fallback cascade to `gemini-1.5-flash`, `gemini-1.5-pro`, and `gemini-pro`.
- **Offline / Unconfigured Mode:** If `GEMINI_API_KEY` is missing or quota is exhausted, the AI engine uses a built-in deterministic financial rule-based expert system that analyzes the user's actual database numbers (Net Worth, Emergency Fund, DTI ratio, 50/30/20 budget breakdown).
- **Key Rotation (Oct 2026):** The previous Gemini key was revoked and a new key has been provisioned for the `FinPro` project (`projects/636843722182`). The new key is stored **only** in local `.env` and `node-backend/.env` files — both of which are listed in `.gitignore` and are **never committed to version control**.
- **API Key Storage:** Set `GEMINI_API_KEY` in your local `.env` and `node-backend/.env`. Never hardcode or commit this value. See `.env.example` for the placeholder format.

### 1.3 Authentication Scope
- **Credentials Only:** Authentication is limited to first-party email + password credentials; third-party SSO providers (e.g. Google, Apple) are intentionally not supported.

---

## 2. Browser Environment Requirements

### 2.1 Voice Input (Web Speech API)
- **Supported Browsers:** Google Chrome, Microsoft Edge, Safari, Opera (browsers supporting `webkitSpeechRecognition` or `SpeechRecognition`).
- **Microphone Permissions:** Requires explicit microphone access permission from the browser. If denied, the UI displays a clean alert rather than failing silently.

### 2.2 OCR Receipt Scanning
- **Supported Formats:** Standard image files (`.png`, `.jpg`, `.jpeg`) and clear text photos.
- **Safety Gate:** Extracted amounts, dates, and merchants are presented in an editable confirmation modal prior to committing the transaction to PostgreSQL.

---

## 3. API Key Security & Secret Hygiene

> **IMPORTANT:** All API keys and secrets MUST only be stored in `.env` and `node-backend/.env`. These files are excluded from version control via `.gitignore` (patterns `.env`, `.env.*`).

### 3.1 Keys Stored in `.env` / `node-backend/.env` (Never Committed to Git)

| Key | Service | Status |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini AI | ✅ Rotated Oct 2026 — new key active in local `.env` |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage Market API | ✅ Active |
| `FINNHUB_API_KEY` | Finnhub Financial API | ✅ Active |
| `JWT_SECRET` | JWT Access Token Signing | ✅ Active |
| `JWT_REFRESH_SECRET` | JWT Refresh Token Signing | ✅ Active |
| `DATABASE_URL` | PostgreSQL Connection String | ✅ Local only |

### 3.2 Firebase Configuration Keys (Committed — Safe Public Config)

The following files contain Firebase **public** config identifiers (not secret keys). They are safe to commit because Firebase client-side API keys are intentionally public; access is controlled by Firebase Security Rules and domain/package restrictions in the Google Cloud Console, not by keeping the key secret.

- `mobile/lib/firebase_options.dart` — Flutter Firebase config (Android + iOS App IDs, Messaging Sender ID)
- `mobile/firebase.json` — Firebase CLI project config
- `mobile/ios/Runner/GoogleService-Info.plist` — iOS Firebase config plist

> **Note:** The actual Firebase secret is a **service account JSON** (`GOOGLE_APPLICATION_CREDENTIALS`), used only server-side. This file is never committed.

### 3.3 Git History Key Audit (Performed Oct 2026)

A full audit of git history was performed to verify no secrets were committed to `tani1290/Finance_assistant`:

- `.env`, `node-backend/.env`, `legacy-django-backend/.env` → **Never tracked by git** (verified with `git ls-files --error-unmatch`).
- `.env.example` files → Contain **only placeholder values** (e.g. `your_gemini_api_key_here`), no real credentials.
- Full `git log -p -G` search across all commits → **Zero raw API key values found** in any commit.

**Verdict: The repository is clean. No secret keys were ever pushed to GitHub.**

### 3.4 Procedure If a Key Is Ever Accidentally Committed

1. **Immediately revoke the key** at the issuing platform (Google AI Studio, Alpha Vantage dashboard, Finnhub, etc.).
2. **Generate a new replacement key.**
3. Remove the secret value from the file and either:
   - `git commit --amend` (if it was the last commit and not yet pushed), or
   - Use `git filter-repo --path <file> --invert-paths` to rewrite history.
4. Force-push: `git push origin main --force-with-lease`.
5. Update your local `.env` only with the new key value.
6. Notify any collaborators to re-clone or `git pull --rebase`.
