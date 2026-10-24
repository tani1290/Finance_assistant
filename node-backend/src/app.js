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
const metricsMiddleware = require('./middleware/metricsMiddleware');
const { securityHeaders, inputSanitizer, hppProtection } = require('./middleware/cybersecurity');
const realtimePublisher = require('./middleware/realtimePublisher');
const prisma = require('./config/database');
const cacheService = require('./services/cacheService');
const { HybridRateLimitStore } = require('./services/rateLimitStore');
const metrics = require('./services/metrics');
const { sanitizeErrorForLog } = require('./utils/logSanitizer');
const crypto = require('crypto');

const app = express();

// Disable technology fingerprinting
app.disable('x-powered-by');

// Trust proxy — must mirror the real deployment topology.
//   • Render puts exactly one reverse proxy in front of the service and appends
//     the client address to X-Forwarded-For. render.yaml therefore sets
//     TRUST_PROXY_HOPS=1 so req.ip (used for rate limiting and audit logs) is the
//     real client instead of the shared proxy address.
//   • Direct deployments (local dev, `docker compose`, which publish the port)
//     leave it unset, so a client-supplied X-Forwarded-For is never trusted.
// Only a finite hop count is safe: `true` lets anyone spoof their IP and evade
// IP-based rate limiting (express-rate-limit rejects it), while the previous
// unset default made every request behind the proxy share one rate-limit bucket.
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS, 10);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}

// ==================== SECURITY MIDDLEWARE ====================

app.use(securityHeaders);
app.use(requestLogger);
app.use(metricsMiddleware);

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'sameorigin' },
  hidePoweredBy: true,
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS — explicit allowlist only. `credentials: true` means echoing arbitrary
// origins (the literal "null" from file:// pages, or any *.vercel.app
// deployment) would let attacker-controlled sites read authenticated responses,
// so every entry here must be a known, first-party origin.
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://127.0.0.1:3000',
  'https://fin-pro-wheat.vercel.app',
  'https://finpro-finance-ai.vercel.app',
  'https://finpro-finance-ai.onrender.com',
  'http://127.0.0.1:5001',
  'http://localhost:5001',
  'http://127.0.0.1:5500',   // VS Code Live Server
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, callback) => {
    // Same-origin / non-browser requests carry no Origin header and are not
    // subject to CORS; they must keep working (health checks, server-to-server).
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== 'production') {
      // In development allow local loopback origins on any port.
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id', 'X-Client'],
}));

// Rate limiting (disabled in test mode)
if (process.env.NODE_ENV !== 'test') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    // Shared when Redis is configured; per-instance memory when it is not.
    store: new HybridRateLimitStore({ name: 'api' }),
    // Realtime traffic is long-lived / high-frequency by design (SSE keep-alive
    // + the polling fallback). It must never consume the general API budget.
    skip: (req) => req.originalUrl.startsWith('/api/v1/realtime'),
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    skipSuccessfulRequests: true,
    // A separate namespace keeps auth attempts from consuming the general API
    // budget (and vice versa) when both limiters share Redis.
    store: new HybridRateLimitStore({ name: 'auth' }),
    message: { success: false, error: { code: 'AUTH_RATE_LIMITED', message: 'Too many authentication attempts. Try again in 15 minutes.' } },
  });

  app.use('/api/', limiter);
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/register', authLimiter);
}

// ==================== REQUEST MIDDLEWARE ====================

// Never gzip the SSE stream — buffering would defeat realtime delivery.
app.use(compression({
  filter: (req, res) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/v1/realtime/stream')) return false;
    return compression.filter(req, res);
  },
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cybersecurity: Parameter pollution defense & input sanitization
app.use(hppProtection);
app.use(inputSanitizer);

// Realtime: emit a generic sync.changed event for every successful mutation.
app.use(realtimePublisher);

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
    // True only when objects are persisted durably (reachable S3-compatible
    // storage). A local-disk provider reports false so an uptime reader cannot
    // mistake "available" for "will survive a redeploy".
    storageDurable: storageHealth.durable === true,
    storageLatencyMs: storageHealth.latencyMs,
    timestamp: new Date().toISOString(),
    version: '1.1.0',
    owner: 'Jinay Golecha',
    project: 'FinPro — Personal Finance & Investment Decision Support Platform',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });
});

// Liveness: proves the process can answer HTTP. It deliberately does NOT touch
// the database, object storage or Redis, so a dependency outage does not make
// the platform restart a healthy process. Use /health/dependencies to gate on
// the required database only. /health/ready is a strict full-feature probe
// (database + storage) kept for backward compatibility, not a platform
// liveness or traffic-gating endpoint.
app.get('/api/v1/health/live', (req, res) => {
  res.json({
    live: true,
    status: 'alive',
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Dependency health. Only the database is required for the API to be useful;
// Redis and object storage are reported but must not declare the whole app
// unavailable. No secret, URL or credential is returned.
app.get('/api/v1/health/dependencies', async (req, res) => {
  const [dbResult, storageResult] = await Promise.allSettled([
    prisma.checkHealth(),
    storageService.checkStorageHealth(),
  ]);

  const db = dbResult.status === 'fulfilled' ? dbResult.value : { healthy: false, status: 'error', latencyMs: null };
  const storage = storageResult.status === 'fulfilled'
    ? storageResult.value
    : { available: false, status: 'error', provider: 'unknown', latencyMs: null };

  const cache = cacheService.getStatus();
  const requiredHealthy = db.healthy === true;

  res.status(requiredHealthy ? 200 : 503).json({
    ready: requiredHealthy,
    status: requiredHealthy ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    dependencies: {
      database: {
        required: true,
        healthy: db.healthy === true,
        status: db.status,
        latencyMs: db.latencyMs,
        tier: db.isCloud ? 'cloud' : 'local',
      },
      cache: {
        required: false,
        configured: cache.configured,
        status: cache.status,
        available: cache.available,
        circuitOpen: cache.circuitOpen,
        memoryEntries: cache.memoryEntries,
      },
      storage: {
        required: false,
        available: storage.available === true,
        durable: storage.durable === true,
        status: storage.status,
        provider: storage.provider,
        latencyMs: storage.latencyMs,
      },
    },
  });
});

// Prometheus/OpenMetrics scrape endpoint. In production it is closed unless
// METRICS_TOKEN is configured; the endpoint never contains secrets or user data.
app.get('/metrics', (req, res) => {
  const configuredToken = process.env.METRICS_TOKEN;
  if (configuredToken) {
    const provided = req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.get('x-metrics-token') || '';
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(configuredToken));
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!valid) {
      return res.status(401).json({ success: false, error: { code: 'METRICS_UNAUTHORIZED', message: 'Metrics token required.' } });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(metrics.render());
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
    // Expensive fan-out (12 probes). Cache the public result for a short window
    // so a loop of unauthenticated requests cannot amplify provider load.
    const cached = await cacheService.withCache(
      'health:cloud-detailed',
      30 * 1000,
      () => cloudHealthService.checkAllSubsystems(),
      { lockWaitMs: 250 }
    );
    res.json(cached.value);
  } catch (err) {
    console.error(`[Health] cloud-detailed probe failed: ${sanitizeErrorForLog(err)}`);
    res.status(500).json({
      success: false,
      status: 'error',
      code: 'HEALTH_PROBE_FAILED',
      error: 'Health probe failed',
    });
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

  // Authentication is only healthy when BOTH a usable secret is configured and
  // the database it issues tokens against is reachable. Reporting a hardcoded
  // 'healthy' hid a missing secret or a down database from the status page.
  const authentication = jwtConfigured && dbStatus === 'healthy' ? 'healthy' : 'degraded';

  res.json({
    success: true,
    authentication,
    database: dbStatus,
    jwt: jwtConfigured ? 'configured' : 'missing_secret',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/health/news', async (req, res) => {
  try {
    const newsService = require('./services/newsService');
    const health = await newsService.checkNewsHealth();
    res.json({ success: true, ...health });
  } catch (err) {
    console.error(`[Health] news probe failed: ${sanitizeErrorForLog(err)}`);
    res.status(500).json({ success: false, status: 'error', message: 'News health probe failed' });
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
  // Try to serve the specific HTML page, fallback to index.
  // The resolved path MUST stay inside the public directory: path.join collapses
  // "../" segments, so without this containment check a request such as
  // "/../../etc/hosts" would resolve outside the frontend and leak server files.
  const requestedPage = path.join(frontendPath, req.path);
  const withinFrontend = requestedPage === frontendPath || requestedPage.startsWith(frontendPath + path.sep);
  const fs = require('fs');
  if (withinFrontend && fs.existsSync(requestedPage) && fs.statSync(requestedPage).isFile()) {
    return res.sendFile(requestedPage);
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ==================== ERROR HANDLING ====================

app.use(errorHandler);

module.exports = app;
