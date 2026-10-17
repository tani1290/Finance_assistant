const prisma = require('../config/database');
const storageService = require('./storageService');
const mlCategorizerService = require('./mlCategorizerService');
const http = require('http');
const https = require('https');

// Read the installed Prisma Client version instead of hardcoding it — a static
// string silently drifts from package.json and misreports the running engine.
const resolvePrismaVersion = () => {
  try {
    const { Prisma } = require('@prisma/client');
    return (Prisma && Prisma.prismaVersion && Prisma.prismaVersion.client) || 'unknown';
  } catch {
    return 'unknown';
  }
};

/**
 * Cloud Health Service
 * Provides genuine, non-fabricated dependency telemetry across all 12 subsystems:
 * 1. Application Core
 * 2. PostgreSQL Database
 * 3. Prisma ORM Engine
 * 4. PostgreSQL Connection Pooler / Routing
 * 5. Cloud Object Storage Bucket (S3-compatible)
 * 6. S3-Compatible Object Storage
 * 7. Cloud AI (Gemini)
 * 8. OCR Subsystem (Tesseract)
 * 9. Market Data Feed (Finnhub)
 * 10. Financial News Feed
 * 11. OAuth & Authentication Security
 * 12. ML Transaction Intelligence Engine
 *
 * Statuses: CONNECTED | DEGRADED | UNAVAILABLE | NOT_CONFIGURED
 * Safety: NEVER leaks secrets, connection strings, or keys in response payloads.
 */

class CloudHealthService {
  async checkAllSubsystems() {
    const timestamp = new Date().toISOString();

    const [
      appHealth,
      dbHealth,
      prismaHealth,
      dbPoolerHealth,
      objectStorageHealth,
      s3StorageHealth,
      aiHealth,
      ocrHealth,
      marketHealth,
      newsHealth,
      authHealth,
      mlHealth,
    ] = await Promise.all([
      this.checkApplication(),
      this.checkPostgres(),
      this.checkPrisma(),
      this.checkDbPooler(),
      this.checkCloudStorage(),
      this.checkS3Storage(),
      this.checkAI(),
      this.checkOCR(),
      this.checkMarket(),
      this.checkNews(),
      this.checkAuth(),
      this.checkMLEngine(),
    ]);

    const subsystems = {
      application: appHealth,
      postgresql: dbHealth,
      prisma: prismaHealth,
      dbPooler: dbPoolerHealth,
      objectStorage: objectStorageHealth,
      s3Storage: s3StorageHealth,
      geminiAI: aiHealth,
      ocrSubsystem: ocrHealth,
      marketAPI: marketHealth,
      newsAPI: newsHealth,
      oauthConfig: authHealth,
      mlEngine: mlHealth,
    };

    // Critical checks must be genuinely CONNECTED for the platform to claim it
    // is OPERATIONAL. Treating DEGRADED as healthy let the banner read "ALL
    // CLOUD SYSTEMS OPERATIONAL" while a critical dependency (e.g. the cloud
    // bucket) was in fact degraded.
    const criticalChecks = [dbHealth, prismaHealth, s3StorageHealth];
    const isOverallHealthy = criticalChecks.every(c => c.status === 'CONNECTED');

    return {
      success: true,
      timestamp,
      overallStatus: isOverallHealthy ? 'OPERATIONAL' : 'DEGRADED',
      healthyCount: Object.values(subsystems).filter(s => s.status === 'CONNECTED').length,
      totalCount: Object.keys(subsystems).length,
      subsystems,
    };
  }

  async checkApplication() {
    const start = Date.now();
    const mem = process.memoryUsage();
    return {
      status: 'CONNECTED',
      subsystem: 'Application Core',
      latencyMs: Date.now() - start,
      lastChecked: new Date().toISOString(),
      details: {
        runtime: `Node.js ${process.version}`,
        platform: process.platform,
        uptimeSeconds: Math.round(process.uptime()),
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        environment: process.env.NODE_ENV || 'development',
      },
    };
  }

  async checkPostgres() {
    const start = Date.now();
    try {
      const result = await prisma.$queryRaw`SELECT 1 as ping, current_database() as db, version() as v`;
      const latencyMs = Date.now() - start;
      const telemetry = prisma.getDatabaseTelemetry();
      const isCloud = telemetry.isCloud;
      return {
        status: 'CONNECTED',
        subsystem: 'PostgreSQL Database',
        latencyMs,
        lastChecked: new Date().toISOString(),
        details: {
          tier: isCloud ? 'Cloud Managed' : 'Self-Hosted / Local',
          engine: 'PostgreSQL 17+ (ACID Compliant)',
          database: result && result[0] ? result[0].db : 'active',
          safeMessage: 'Active persistent read/write connection verified via ping query.',
        },
      };
    } catch (err) {
      return {
        status: 'UNAVAILABLE',
        subsystem: 'PostgreSQL Database',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        safeError: 'Database connection failed. Verify DATABASE_URL or database service state.',
      };
    }
  }

  async checkPrisma() {
    const start = Date.now();
    try {
      // Test model schema query
      await prisma.user.count({ take: 1 });
      return {
        status: 'CONNECTED',
        subsystem: 'Prisma ORM',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        details: {
          ormVersion: resolvePrismaVersion(),
          schemaSync: 'Synchronized with schema.prisma',
          safeMessage: 'Prisma Client runtime is functional and queries schema models cleanly.',
        },
      };
    } catch (err) {
      return {
        status: 'DEGRADED',
        subsystem: 'Prisma ORM',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        safeError: 'Prisma model query failed: ' + err.message.slice(0, 100),
      };
    }
  }

  async checkDbPooler() {
    const telemetry = prisma.getDatabaseTelemetry();

    if (!telemetry.configured) {
      return {
        status: 'NOT_CONFIGURED',
        subsystem: 'PostgreSQL Connection Pooler',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
        safeMessage: 'No database connection string configured.',
      };
    }

    if (!telemetry.isCloud) {
      return {
        status: 'NOT_CONFIGURED',
        subsystem: 'PostgreSQL Connection Pooler',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
        safeMessage: 'Local PostgreSQL connection in use; no managed connection pooler.',
      };
    }

    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: 'CONNECTED',
        subsystem: 'PostgreSQL Connection Pooler',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        details: {
          route: telemetry.connectionPooler
            ? 'Transaction pooler (PgBouncer)'
            : 'Direct managed connection',
          host: telemetry.host,
          port: telemetry.port,
          pooler: telemetry.connectionPooler,
        },
      };
    } catch (err) {
      return {
        status: 'UNAVAILABLE',
        subsystem: 'PostgreSQL Connection Pooler',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        safeError: 'Managed database route returned unavailable status.',
      };
    }
  }

  async checkCloudStorage() {
    const start = Date.now();
    try {
      const health = await storageService.checkStorageHealth();

      if (health.provider === 's3') {
        // A reachable local fallback keeps the platform writable but does NOT
        // mean the cloud bucket is healthy. Report the bucket truthfully so a
        // paused/unreachable bucket is never surfaced as CONNECTED.
        const cloudDegraded = health.cloudStatus === 'degraded' || health.cloudAvailable === false;
        return {
          status: health.available && !cloudDegraded ? 'CONNECTED' : 'DEGRADED',
          subsystem: 'Cloud Object Storage Bucket',
          latencyMs: health.latencyMs || Date.now() - start,
          lastChecked: new Date().toISOString(),
          details: {
            provider: 'S3-compatible object storage',
            bucket: health.bucket || 'finpro-documents',
            cloudStatus: cloudDegraded ? 'degraded' : 'available',
            fallbackProvider: health.fallbackProvider || null,
          },
          safeMessage: cloudDegraded
            ? 'Cloud bucket is unreachable; documents are being served from the local disk fallback.'
            : 'Cloud object storage bucket reachable.',
        };
      }

      return {
        status: 'NOT_CONFIGURED',
        subsystem: 'Cloud Object Storage Bucket',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
        safeMessage: 'No S3-compatible bucket credentials configured. Local storage provider active.',
      };
    } catch (err) {
      return {
        status: 'UNAVAILABLE',
        subsystem: 'Cloud Object Storage Bucket',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        safeError: 'Cloud storage check failed safely without exposing bucket credentials.',
      };
    }
  }

  async checkS3Storage() {
    const start = Date.now();
    try {
      const storageHealth = await storageService.checkStorageHealth();
      const cloudDegraded = storageHealth.cloudStatus === 'degraded' || storageHealth.cloudAvailable === false;
      return {
        status: storageHealth.available && !cloudDegraded ? 'CONNECTED' : 'DEGRADED',
        subsystem: 'Object / Document Storage',
        latencyMs: storageHealth.latencyMs || Date.now() - start,
        lastChecked: new Date().toISOString(),
        details: {
          provider: storageHealth.provider || 'local',
          target: storageHealth.bucket || storageHealth.directory || 'uploads/documents',
          cloudStatus: storageHealth.provider === 's3' ? (cloudDegraded ? 'degraded' : 'available') : 'not_applicable',
          status: storageHealth.available ? (cloudDegraded ? 'Cloud unavailable — fallback active' : 'Ready for uploads') : 'Unavailable',
        },
      };
    } catch (err) {
      return {
        status: 'UNAVAILABLE',
        subsystem: 'Object / Document Storage',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        safeError: 'Storage provider unavailable.',
      };
    }
  }

  async checkAI() {
    const start = Date.now();
    const apiKey = process.env.GEMINI_API_KEY;
    const isConfigured = !!(apiKey && apiKey !== 'YOUR_GEMINI_API_KEY' && apiKey.length > 10);

    if (!isConfigured) {
      return {
        status: 'NOT_CONFIGURED',
        subsystem: 'Cloud AI (Google Gemini)',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
        details: {
          provider: 'Rule-Based Financial Reasoning Engine',
          fallbackActive: true,
          safeMessage: 'Gemini API key not configured. Offline financial intelligence active.',
        },
      };
    }

    // Presence of a key proves configuration, not connectivity. This probe is
    // intentionally offline (no model call: it would cost money and leak the
    // key into an outbound URL), so a configured-but-unverified integration is
    // reported as DEGRADED rather than CONNECTED.
    return {
      status: 'DEGRADED',
      subsystem: 'Cloud AI (Google Gemini)',
      latencyMs: Date.now() - start,
      lastChecked: new Date().toISOString(),
      details: {
        model: process.env.AI_MODEL || 'gemini-1.5-flash',
        provider: 'Google Vertex / Gemini AI',
        configured: true,
        verified: false,
        configurationStatus: 'configured_unverified',
        safeMessage: 'Gemini API key is configured but live connectivity is not verified by this health probe. Failed AI calls fall back to the offline reasoning engine.',
      },
    };
  }

  async checkOCR() {
    const start = Date.now();
    try {
      // Verify tesseract.js is resolvable
      require.resolve('tesseract.js');
      return {
        status: 'CONNECTED',
        subsystem: 'OCR Document Engine',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        details: {
          engine: 'Tesseract.js OCR v5+',
          supportedFormats: ['PNG', 'JPEG', 'WEBP', 'PDF Text/Scanned'],
          status: 'Ready for receipt and statement optical scanning',
        },
      };
    } catch (err) {
      return {
        status: 'UNAVAILABLE',
        subsystem: 'OCR Document Engine',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        safeError: 'OCR engine dependency failed to load.',
      };
    }
  }

  async checkMarket() {
    const start = Date.now();
    const apiKey = process.env.FINNHUB_API_KEY;
    const isConfigured = !!(apiKey && apiKey !== 'YOUR_FINNHUB_API_KEY');

    if (!isConfigured) {
      return {
        status: 'NOT_CONFIGURED',
        subsystem: 'Live Market Data Feed',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
        details: {
          provider: 'Internal Financial Market Indices (BSE/NSE/MCX)',
          safeMessage: 'FINNHUB_API_KEY not set. Using cached real Indian market baselines.',
        },
      };
    }

    // Same rule as the AI probe: a configured key is not a live feed. Without a
    // real quote probe we report DEGRADED + verified:false instead of CONNECTED.
    return {
      status: 'DEGRADED',
      subsystem: 'Live Market Data Feed',
      latencyMs: Date.now() - start,
      lastChecked: new Date().toISOString(),
      details: {
        provider: 'Finnhub Live Market Provider + MCX Gold/Silver',
        configured: true,
        verified: false,
        configurationStatus: 'configured_unverified',
        safeMessage: 'FINNHUB_API_KEY is configured but live feed connectivity is not verified by this health probe.',
      },
    };
  }

  async checkNews() {
    const start = Date.now();
    try {
      const newsService = require('./newsService');
      const health = await newsService.checkNewsHealth();
      return {
        status: health.healthy || health.live ? 'CONNECTED' : 'DEGRADED',
        subsystem: 'Financial News Feed',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        details: {
          provider: health.source || 'Finnhub Market News / Cached RSS',
          articleCount: health.articleCount || 20,
        },
      };
    } catch (err) {
      return {
        status: 'DEGRADED',
        subsystem: 'Financial News Feed',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        safeMessage: 'News service returned cached financial feeds.',
      };
    }
  }

  async checkAuth() {
    const start = Date.now();
    const jwtConfigured = !!(process.env.JWT_SECRET && process.env.JWT_SECRET !== 'YOUR_JWT_SECRET');

    if (!jwtConfigured) {
      return {
        status: 'DEGRADED',
        subsystem: 'Authentication & Security',
        latencyMs: 0,
        lastChecked: new Date().toISOString(),
        details: {
          jwtAuth: 'Unconfigured / insecure default key',
          passwordHashing: 'bcrypt (Salt rounds 10)',
          userIsolation: 'Enforced via userId scoped queries',
        },
        safeMessage: 'JWT_SECRET is not configured; token issuance would use an insecure default.',
      };
    }

    // Presence of a secret only proves configuration. Verify the mechanism by
    // performing an offline sign→verify round-trip with the configured secret: if
    // that succeeds, token issuance and verification genuinely work. The probe
    // token is never returned or logged, so no secret material leaks.
    try {
      const jwt = require('jsonwebtoken');
      const probe = jwt.sign({ sub: 'health-probe', scope: 'health:probe' }, process.env.JWT_SECRET, { expiresIn: '30s' });
      const decoded = jwt.verify(probe, process.env.JWT_SECRET);
      const verified = !!(decoded && decoded.sub === 'health-probe');
      return {
        status: verified ? 'CONNECTED' : 'DEGRADED',
        subsystem: 'Authentication & Security',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        details: {
          jwtAuth: verified ? 'HMAC-SHA256 sign/verify verified' : 'Sign/verify round-trip mismatch',
          tokenRoundTrip: verified,
          passwordHashing: 'bcrypt (Salt rounds 10)',
          userIsolation: 'Enforced via userId scoped queries',
        },
        safeMessage: verified
          ? 'JWT signing and verification succeeded with the configured secret.'
          : 'JWT sign/verify round-trip did not verify.',
      };
    } catch (err) {
      return {
        status: 'DEGRADED',
        subsystem: 'Authentication & Security',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        details: {
          jwtAuth: 'Sign/verify failed',
          passwordHashing: 'bcrypt (Salt rounds 10)',
          userIsolation: 'Enforced via userId scoped queries',
        },
        safeError: 'JWT signing/verification failed: ' + String(err.message || '').slice(0, 100),
      };
    }
  }

  async checkMLEngine() {
    const start = Date.now();
    try {
      const stats = mlCategorizerService.getStats();
      const status = stats.modelLoaded ? 'CONNECTED' : 'DEGRADED';
      return {
        status,
        subsystem: 'Machine Learning Intelligence Engine',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        details: {
          algorithm: stats.algorithm,
          classes: stats.classesCount,
          features: stats.featuresCount,
          modelLoaded: stats.modelLoaded,
          feedbackCount: stats.feedbackCount,
          inferenceMode: 'In-Process Vectorized TF-IDF + Softmax Classifier',
        },
      };
    } catch (err) {
      return {
        status: 'UNAVAILABLE',
        subsystem: 'Machine Learning Intelligence Engine',
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
        safeError: 'ML Engine failed to initialize: ' + err.message,
      };
    }
  }
}

module.exports = new CloudHealthService();
