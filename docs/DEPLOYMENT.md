# Jinay Finance AI — Deployment & Setup Guide
**Project:** Jinay Finance AI  
**Owner:** Jinay Golecha (`jinay_golecha`)

---

## 1. Prerequisites

- **Node.js:** v20.x or later
- **npm:** v10.x or later
- **PostgreSQL:** v15+ (v17 recommended)
- **Git:** Installed on host machine

---

## 2. Step-by-Step Installation

### Step 1: Clone Repository
```bash
git clone <repository_url>
cd Final-Year-Project
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env` in both root and `node-backend/`:
```bash
cp .env.example .env
cp node-backend/.env.example node-backend/.env
```

Ensure the following variables are configured in `node-backend/.env`:
```env
# Server
PORT=5001
NODE_ENV=development

# Database
DATABASE_URL="postgresql://postgres:postgres2905@127.0.0.1:5432/finance_jinay?connection_limit=20&pool_timeout=15"

# Security
JWT_SECRET="your_strong_jwt_secret_key_here"
JWT_REFRESH_SECRET="your_strong_refresh_jwt_secret_key_here"
JWT_EXPIRES_IN=60m
JWT_REFRESH_EXPIRES_IN=7d

# Google OAuth2 (Optional for local development)
GOOGLE_CLIENT_ID="your_client_id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your_client_secret"
GOOGLE_REDIRECT_URI="http://127.0.0.1:5001/api/v1/auth/google/callback"

# AI Provider (Google Gemini)
GEMINI_API_KEY="your_gemini_api_key"
AI_MODEL="gemini-2.5-flash"

# Market Data Providers
ALPHA_VANTAGE_API_KEY="your_alpha_vantage_api_key"
FINNHUB_API_KEY="your_finnhub_api_key"

# App
CURRENCY=INR
TIMEZONE="Asia/Kolkata"
```

### Step 3: Install Dependencies & Run Database Migrations
```bash
cd node-backend
npm install
npx prisma generate
npx prisma db push
```

### Step 4: Start Backend Server
```bash
# In development mode (with auto-reload)
npm run dev

# Or in production mode
npm start
```
The server will bind to `http://127.0.0.1:5001` and automatically serve the frontend Single Page Application at `http://127.0.0.1:5001/`.

---

## 3. Production Hardening Checklist

- [x] **No Personal Hardcoded Paths:** All file operations use relative directory paths (`path.join(__dirname, ...)`).
- [x] **Secrets in Environment:** Zero hardcoded API keys or database passwords in source code.
- [x] **Rate Limiting:** Global rate limiters (200 req/15min) and strict auth limiters (20 req/15min) enabled.
- [x] **Database Indexes:** Compound indexes configured for all foreign keys and user relations.
- [x] **CORS Configuration:** Explicit origin whitelist with credential support.
- [x] **Graceful Fallbacks:** Guaranteed zero crashes if external AI or market APIs are unreachable.
