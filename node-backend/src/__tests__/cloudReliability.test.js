/**
 * Phase 4/5 — Cloud reliability regression tests.
 *
 * Guards the three fixes that stop the platform from silently lying about the
 * state of its cloud dependencies:
 *   1. S3 provider network calls are bounded by a configurable timeout.
 *   2. A silent cloud→local fallback is recorded and surfaced, never hidden.
 *   3. Configured-but-unverified AI / market integrations report DEGRADED
 *      (verified:false) instead of CONNECTED.
 *
 * Deterministic by construction: the database and every network provider are
 * mocked; no real service is contacted and no credentials are required.
 */

jest.mock('../config/database', () => ({
  $queryRaw: jest.fn(),
  getDatabaseTelemetry: jest.fn(() => ({ configured: true, isCloud: false })),
  user: { count: jest.fn() },
}));

const storageService = require('../services/storageService');
const cloudHealthService = require('../services/cloudHealthService');

const ORIGINAL_PROVIDERS = {
  cloud: storageService.cloudProvider,
  local: storageService.localProvider,
};

const ENV_KEYS = ['GEMINI_API_KEY', 'FINNHUB_API_KEY', 'STORAGE_PROVIDER', 'S3_TIMEOUT_MS', 'JWT_SECRET'];
const ORIGINAL_ENV = {};
ENV_KEYS.forEach((k) => { ORIGINAL_ENV[k] = process.env[k]; });

afterEach(() => {
  jest.restoreAllMocks();
  ENV_KEYS.forEach((k) => {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  });
  storageService.cloudProvider = ORIGINAL_PROVIDERS.cloud;
  storageService.localProvider = ORIGINAL_PROVIDERS.local;
});

describe('S3CloudProvider — bounded request timeouts', () => {
  const creds = { accessKeyId: 'test-key', secretAccessKey: 'test-secret' };

  it('defaults the request timeout to 15s', () => {
    const provider = new storageService.S3CloudProvider(creds);
    expect(provider.requestTimeoutMs).toBe(15000);
  });

  it('honours an explicit requestTimeoutMs override', () => {
    const provider = new storageService.S3CloudProvider({ ...creds, requestTimeoutMs: '2500' });
    expect(provider.requestTimeoutMs).toBe(2500);
  });

  it('falls back to the default on an invalid override', () => {
    const provider = new storageService.S3CloudProvider({ ...creds, requestTimeoutMs: 'not-a-number' });
    expect(provider.requestTimeoutMs).toBe(15000);
  });
});

describe('StorageService — cloud→local fallback is observable, never silent', () => {
  it('records fallback telemetry and still persists via local disk when the S3 upload fails', async () => {
    storageService.cloudProvider = {
      upload: jest.fn().mockRejectedValue(new Error('S3 upload timed out after 15000ms')),
    };
    storageService.localProvider = {
      upload: jest.fn().mockResolvedValue({ success: true, key: 'users/u1/x.png', provider: 'local' }),
    };
    process.env.STORAGE_PROVIDER = 's3';

    const result = await storageService.upload({ buffer: Buffer.from('x'), key: 'users/u1/x.png' });

    expect(result.provider).toBe('local');
    const fallback = storageService.getLastFallback();
    expect(fallback).not.toBeNull();
    expect(fallback.provider).toBe('s3');
    expect(fallback.fallbackProvider).toBe('local');
    expect(fallback.operation).toBe('upload');
  });

  it('reports the cloud as degraded while keeping the local fallback available', async () => {
    jest.spyOn(storageService.cloudProvider, 'checkHealth').mockResolvedValue({
      available: false, status: 'unreachable', provider: 's3', latencyMs: 5,
    });
    jest.spyOn(storageService.localProvider, 'checkHealth').mockResolvedValue({
      available: true, status: 'available', provider: 'local', latencyMs: 2,
    });
    process.env.STORAGE_PROVIDER = 's3';

    const health = await storageService.checkStorageHealth();

    // The platform can still persist documents...
    expect(health.available).toBe(true);
    // ...but the cloud bucket must NOT be presented as healthy.
    expect(health.cloudStatus).toBe('degraded');
    expect(health.cloudAvailable).toBe(false);
    expect(health.fallbackProvider).toBe('local');
  });
});

describe('CloudHealthService — truthfulness for unverified integrations', () => {
  it('marks a configured Gemini key as DEGRADED / unverified rather than CONNECTED', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyFakeKeyLongerThanTenChars';
    const health = await cloudHealthService.checkAI();
    expect(health.status).toBe('DEGRADED');
    expect(health.details.verified).toBe(false);
    expect(health.details.configurationStatus).toBe('configured_unverified');
  });

  it('marks an unconfigured Gemini key as NOT_CONFIGURED', async () => {
    delete process.env.GEMINI_API_KEY;
    const health = await cloudHealthService.checkAI();
    expect(health.status).toBe('NOT_CONFIGURED');
  });

  it('marks a configured Finnhub key as DEGRADED / unverified rather than CONNECTED', async () => {
    process.env.FINNHUB_API_KEY = 'fake-finnhub-key';
    const health = await cloudHealthService.checkMarket();
    expect(health.status).toBe('DEGRADED');
    expect(health.details.verified).toBe(false);
  });

  it('reports object storage DEGRADED when the bucket is unreachable but local fallback is up', async () => {
    jest.spyOn(storageService, 'checkStorageHealth').mockResolvedValue({
      available: true,
      status: 'available',
      provider: 's3',
      cloudStatus: 'degraded',
      cloudAvailable: false,
      fallbackProvider: 'local',
      latencyMs: 3,
    });

    const health = await cloudHealthService.checkS3Storage();
    expect(health.status).toBe('DEGRADED');
  });

  it('reports object storage CONNECTED when the bucket is genuinely reachable', async () => {
    jest.spyOn(storageService, 'checkStorageHealth').mockResolvedValue({
      available: true,
      status: 'available',
      provider: 's3',
      cloudAvailable: true,
      latencyMs: 3,
    });

    const health = await cloudHealthService.checkS3Storage();
    expect(health.status).toBe('CONNECTED');
  });
});

describe('CloudHealthService — overall status is never optimistic', () => {
  const connected = (subsystem) => ({ status: 'CONNECTED', subsystem, latencyMs: 1, details: {} });

  const stubAllSubsystems = (overrides = {}) => {
    const base = {
      checkApplication: connected('Application Core'),
      checkPostgres: connected('PostgreSQL Database'),
      checkPrisma: connected('Prisma ORM Engine'),
      checkDbPooler: connected('PostgreSQL Connection Pooler'),
      checkCloudStorage: connected('Cloud Object Storage Bucket'),
      checkS3Storage: connected('Object / Document Storage'),
      checkAI: connected('Cloud AI (Google Gemini)'),
      checkOCR: connected('OCR Subsystem'),
      checkMarket: connected('Live Market Data Feed'),
      checkNews: connected('Financial News Feed'),
      checkAuth: connected('Authentication & Security'),
      checkMLEngine: connected('ML Transaction Intelligence'),
    };
    Object.entries({ ...base, ...overrides }).forEach(([method, value]) => {
      jest.spyOn(cloudHealthService, method).mockResolvedValue(value);
    });
  };

  it('is OPERATIONAL only when every critical subsystem is genuinely CONNECTED', async () => {
    stubAllSubsystems();
    const result = await cloudHealthService.checkAllSubsystems();
    expect(result.overallStatus).toBe('OPERATIONAL');
  });

  it('downgrades to DEGRADED when a critical subsystem (cloud storage) is degraded', async () => {
    stubAllSubsystems({
      checkS3Storage: { status: 'DEGRADED', subsystem: 'Object / Document Storage', latencyMs: 3, details: { cloudStatus: 'degraded' } },
    });
    const result = await cloudHealthService.checkAllSubsystems();
    // The banner must NOT read "all systems operational" while a critical
    // dependency is degraded.
    expect(result.overallStatus).toBe('DEGRADED');
    expect(result.subsystems.s3Storage.status).toBe('DEGRADED');
  });

  it('downgrades to DEGRADED when the database is unavailable', async () => {
    stubAllSubsystems({
      checkPostgres: { status: 'UNAVAILABLE', subsystem: 'PostgreSQL Database', latencyMs: 3, details: {} },
    });
    const result = await cloudHealthService.checkAllSubsystems();
    expect(result.overallStatus).toBe('DEGRADED');
  });

  it('reports the real installed Prisma Client version, never a hardcoded string', async () => {
    const health = await cloudHealthService.checkPrisma();
    expect(health.status).toBe('CONNECTED');
    expect(health.details.ormVersion).not.toBe('6.6.0');
    expect(health.details.ormVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('CloudHealthService — auth is verified, not assumed from key presence', () => {
  it('reports CONNECTED only after a real sign→verify round-trip', async () => {
    process.env.JWT_SECRET = 'unit-test-secret-not-production';
    const health = await cloudHealthService.checkAuth();
    expect(health.status).toBe('CONNECTED');
    expect(health.details.tokenRoundTrip).toBe(true);
    expect(health.details.jwtAuth).toMatch(/verified/i);
  });

  it('never leaks the configured secret in the payload', async () => {
    process.env.JWT_SECRET = 'super-secret-value-that-must-not-appear';
    const health = await cloudHealthService.checkAuth();
    expect(JSON.stringify(health)).not.toContain('super-secret-value-that-must-not-appear');
  });

  it('reports DEGRADED when JWT_SECRET is absent instead of claiming CONNECTED', async () => {
    delete process.env.JWT_SECRET;
    const health = await cloudHealthService.checkAuth();
    expect(health.status).toBe('DEGRADED');
    expect(health.details.jwtAuth).toMatch(/Unconfigured/i);
  });

  it('reports DEGRADED when the configured secret cannot sign/verify', async () => {
    process.env.JWT_SECRET = 'x';
    const jwt = require('jsonwebtoken');
    jest.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('invalid signature'); });
    const health = await cloudHealthService.checkAuth();
    expect(health.status).toBe('DEGRADED');
    expect(health.details.jwtAuth).toMatch(/failed/i);
  });
});
