/**
 * Jinay Finance AI — Server Entry Point
 * Owner: Jinay Golecha (jinay_golecha)
 */

require('dotenv').config();
const app = require('./app');
const prisma = require('./config/database');

const PORT = parseInt(process.env.PORT) || 5001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Graceful shutdown handler
const shutdown = async (signal) => {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);
  await prisma.$disconnect();
  console.log('[Server] Database disconnected. Server stopped.');
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
        console.log('[Database] Connected to PostgreSQL (Cloud Supabase) ✓');
        break;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        console.warn(`[Database] Connection attempt failed (${err.message}). Retrying in 2s... (${retries} left)`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('\n╔════════════════════════════════════════════════════════╗');
      console.log('║     FinPro — Personal Finance & Decision Support Platform ║');
      console.log('║     Owner: Jinay Golecha (jinay_golecha)               ║');
      console.log('╚════════════════════════════════════════════════════════╝');
      console.log(`\n🚀 Server running at http://127.0.0.1:${PORT}`);
      console.log(`📋 Environment: ${NODE_ENV}`);
      console.log(`🔒 Auth: JWT + Google OAuth`);
      console.log(`🤖 AI: ${process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY' ? 'Gemini (configured)' : 'Rule-based (configure GEMINI_API_KEY)'}`);
      console.log(`📈 Market: ${process.env.FINNHUB_API_KEY !== 'YOUR_FINNHUB_API_KEY' ? 'Finnhub (live)' : 'Reference prices (configure FINNHUB_API_KEY)'}`);
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

  } catch (error) {
    console.error('[Server] Failed to start:', error.message);
    console.error('[Server] Check DATABASE_URL in .env and ensure PostgreSQL is running.');
    await prisma.$disconnect();
    process.exit(1);
  }
};

startServer();
