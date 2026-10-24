/**
 * Jinay Finance AI — Server Entry Point
 * Owner: Jinay Golecha (jinay_golecha)
 */

require('dotenv').config();
const app = require('./app');
const prisma = require('./config/database');
const marketService = require('./services/marketService');
const storageService = require('./services/storageService');
const cacheService = require('./services/cacheService');
const { shutdownPushQueue } = require('./services/pushQueue');

const PORT = parseInt(process.env.PORT) || 5001;
const NODE_ENV = process.env.NODE_ENV || 'development';

let httpServer = null;
let shuttingDown = false;

// Graceful shutdown handler. Stops accepting new connections, lets in-flight
// requests finish for up to 10 s, closes the shared cache and the database.
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

  marketService.stopMarketBackgroundWorker();

  if (httpServer) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 10_000);
      if (timer.unref) timer.unref();
      httpServer.close(() => {
        clearTimeout(timer);
        resolve();
      });
      if (typeof httpServer.closeIdleConnections === 'function') {
        httpServer.closeIdleConnections();
      }
    });
  }

  // Push delivery is best-effort, but give queued/in-flight notifications a
  // bounded chance to finish before the process exits.
  await shutdownPushQueue(5_000);
  await cacheService.shutdown();
  await prisma.$disconnect();
  console.log('[Server] Push queue, cache and database disconnected. Server stopped.');
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled promise rejection:', reason);
});

// Start server
const startServer = async () => {
  try {
    // Verify database connection with retry for cloud latency
    let retries = 5;
    while (retries > 0) {
      try {
        await prisma.$connect();
        const dbTelemetry = prisma.getDatabaseTelemetry();
        console.log(`[Database] Connected to PostgreSQL (${dbTelemetry.isCloud ? 'managed cloud' : 'local'}) ✓`);
        break;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        console.warn(`[Database] Connection attempt failed (${err.message}). Retrying in 2s... (${retries} left)`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Optional shared cache. A missing or unreachable Redis never blocks boot:
    // init() has a bounded connect timeout and falls back to memory.
    const cacheStatus = await cacheService.init();
    if (cacheStatus.configured) {
      console.log(`[Cache] Shared cache: ${cacheStatus.status}${cacheStatus.available ? '' : ' (memory fallback active)'}`);
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      httpServer = server;
      // Surface the storage durability posture at boot: production must never
      // silently serve uploads from an ephemeral local disk. Non-blocking — it
      // only logs, and never requires credentials.
      storageService.warnIfEphemeralInProduction();
      console.log('\n╔════════════════════════════════════════════════════════╗');
      console.log('║     FinPro — Personal Finance & Decision Support Platform ║');
      console.log('║     Owner: Jinay Golecha (jinay_golecha)               ║');
      console.log('╚════════════════════════════════════════════════════════╝');
      console.log(`\n🚀 Server running at http://127.0.0.1:${PORT}`);
      console.log(`📋 Environment: ${NODE_ENV}`);
      console.log(`🔒 Auth: JWT (email + password)`);
      console.log(`🤖 AI: ${process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY' ? 'Gemini (configured)' : 'Rule-based (configure GEMINI_API_KEY)'}`);
      console.log(`📈 Market: ${process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY !== 'YOUR_FINNHUB_API_KEY' ? 'Finnhub (live)' : 'Reference prices (configure FINNHUB_API_KEY)'}`);
      console.log(`\n📡 API Endpoints:`);
      console.log(`   Health:    GET  http://127.0.0.1:${PORT}/api/v1/health`);
      console.log(`   Auth:      POST http://127.0.0.1:${PORT}/api/v1/auth/register`);
      console.log(`   Dashboard: GET  http://127.0.0.1:${PORT}/api/v1/dashboard`);
      console.log(`   Frontend:  http://127.0.0.1:${PORT}/\n`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PORT} is already in use. Kill the process or change PORT in .env`);
        process.exit(1);
      }
      throw err;
    });

    // Start the background market cache warmer (opt-in, skips during tests).
    // It reuses the market service's existing cache and is stopped on shutdown.
    if (NODE_ENV !== 'test' && process.env.MARKET_WORKER_ENABLED !== 'false') {
      marketService.startMarketBackgroundWorker();
    }

  } catch (error) {
    console.error('[Server] Failed to start:', error.message);
    console.error('[Server] Check DATABASE_URL in .env and ensure PostgreSQL is running.');
    await prisma.$disconnect();
    process.exit(1);
  }
};

startServer();
