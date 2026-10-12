/**
 * Jinay Finance AI — Express Application
 * Owner: Jinay Golecha (jinay_golecha)
 * Node.js + Express + Prisma + PostgreSQL
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const apiRoutes = require('./routes/index');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const prisma = require('./config/database');

const app = express();

// ==================== SECURITY MIDDLEWARE ====================

app.use(requestLogger);

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

// CORS — allow frontend origin
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://127.0.0.1:3000',
  'http://127.0.0.1:5001',
  'http://localhost:5001',
  'http://127.0.0.1:5500',   // VS Code Live Server
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'null', // File:// protocol for direct HTML opening
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'test') {
      callback(null, true);
    } else if (process.env.NODE_ENV !== 'production') {
      // In development allow local loopback origins
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    } else {
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
}));

// Rate limiting (disabled in test mode)
if (process.env.NODE_ENV !== 'test') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    skipSuccessfulRequests: true,
    message: { success: false, error: { code: 'AUTH_RATE_LIMITED', message: 'Too many authentication attempts. Try again in 15 minutes.' } },
  });

  app.use('/api/', limiter);
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/register', authLimiter);
}

// ==================== REQUEST MIDDLEWARE ====================

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ==================== STATIC FRONTEND ====================

// Serve the frontend SPA from frontend/public
const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'public');
app.use(express.static(frontendPath));

const storageService = require('./services/storageService');
const cloudHealthService = require('./services/cloudHealthService');

// ==================== HEALTH ENDPOINTS ====================

app.get('/api/v1/health', async (req, res) => {
  const [dbHealth, storageHealth] = await Promise.all([
    prisma.checkHealth(),
    storageService.checkStorageHealth(),
  ]);

  const isHealthy = dbHealth.healthy && storageHealth.available;
  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? 'healthy' : 'degraded',
    application: 'online',
    environment: process.env.NODE_ENV || 'development',
    database: dbHealth.status,
    databaseLatencyMs: dbHealth.latencyMs,
    databaseTier: dbHealth.isCloud ? 'cloud' : 'local',
    storage: storageHealth.available ? 'available' : 'unavailable',
    storageProvider: storageHealth.provider,
    storageLatencyMs: storageHealth.latencyMs,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    owner: 'Jinay Golecha',
    project: 'FinPro — Personal Finance & Investment Decision Support Platform',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });
});

app.get('/api/v1/health/database', async (req, res) => {
  const dbHealth = await prisma.checkHealth();
  const statusCode = dbHealth.healthy ? 200 : 503;
  res.status(statusCode).json({
    success: dbHealth.healthy,
    ...dbHealth,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/health/storage', async (req, res) => {
  const storageHealth = await storageService.checkStorageHealth();
  const statusCode = storageHealth.available ? 200 : 503;
  res.status(statusCode).json({
    success: storageHealth.available,
    ...storageHealth,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/health/ready', async (req, res) => {
  const [dbHealth, storageHealth] = await Promise.all([
    prisma.checkHealth(),
    storageService.checkStorageHealth(),
  ]);

  const isReady = dbHealth.healthy && storageHealth.available;
  const statusCode = isReady ? 200 : 503;
  res.status(statusCode).json({
    ready: isReady,
    status: isReady ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    checks: {
      database: {
        healthy: dbHealth.healthy,
        status: dbHealth.status,
        latencyMs: dbHealth.latencyMs,
        tier: dbHealth.isCloud ? 'cloud' : 'local',
        host: dbHealth.host,
      },
      storage: {
        available: storageHealth.available,
        status: storageHealth.status,
        provider: storageHealth.provider,
        latencyMs: storageHealth.latencyMs,
      },
    },
  });
});

app.get('/api/v1/health/cloud-detailed', async (req, res) => {
  try {
    const health = await cloudHealthService.checkAllSubsystems();
    res.json(health);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Health probe failed: ' + err.message });
  }
});

app.get('/api/v1/health/market', (req, res) => {
  const apiKey = process.env.FINNHUB_API_KEY;
  const configured = !!(apiKey && apiKey !== 'YOUR_FINNHUB_API_KEY');
  res.json({
    success: true,
    status: configured ? 'configured' : 'not_configured',
    provider: 'Finnhub',
    note: configured ? 'Live market data available.' : 'Set FINNHUB_API_KEY in .env for live NSE/BSE data. Fallback active.',
  });
});

app.get('/api/v1/health/ai', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const configured = !!(apiKey && apiKey !== 'YOUR_GEMINI_API_KEY');
  res.json({
    success: true,
    status: configured ? 'configured' : 'fallback',
    provider: 'Google Gemini',
    model: process.env.AI_MODEL || 'gemini-1.5-flash',
    note: configured ? 'AI advisor using Gemini.' : 'Using built-in rule-based AI. Set GEMINI_API_KEY for full AI features.',
  });
});

app.get('/api/v1/health/auth', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'healthy';
  } catch {
    dbStatus = 'error';
  }

  const jwtConfigured = !!(process.env.JWT_SECRET && process.env.JWT_SECRET !== 'YOUR_JWT_SECRET');
  const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com');

  res.json({
    success: true,
    authentication: 'healthy',
    database: dbStatus,
    jwt: jwtConfigured ? 'configured' : 'missing_secret',
    googleOAuth: googleConfigured ? 'configured' : 'not_configured',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/health/news', async (req, res) => {
  try {
    const newsService = require('./services/newsService');
    const health = await newsService.checkNewsHealth();
    res.json({ success: true, ...health });
  } catch (err) {
    res.status(500).json({ success: false, status: 'error', message: err.message });
  }
});

// ==================== API ROUTES ====================

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', apiRoutes);

// ==================== FRONTEND SPA FALLBACK ====================

// For any non-API route, serve the frontend's index.html (SPA routing)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return notFoundHandler(req, res);
  }
  // Try to serve the specific HTML page, fallback to index
  const requestedPage = path.join(frontendPath, req.path);
  const fs = require('fs');
  if (fs.existsSync(requestedPage) && fs.statSync(requestedPage).isFile()) {
    return res.sendFile(requestedPage);
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ==================== ERROR HANDLING ====================

app.use(errorHandler);

module.exports = app;
