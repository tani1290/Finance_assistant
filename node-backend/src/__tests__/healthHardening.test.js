/**
 * Phase 7 — Health-probe hardening regression tests.
 *
 * Guards two things that must never regress:
 *   1. The two ops probes (GET /api/v1/health/cloud-detailed and
 *      GET /api/v1/health/news) return a stable, generic failure and never
 *      echo a raw upstream error message to the caller. The real cause is
 *      written to the server log, sanitized of credentials, tokens and
 *      signed-URL query parameters.
 *   2. The storage layer reports whether it is durable, so production can never
 *      *look* like it has cloud storage while writing to an ephemeral disk.
 *
 * Deterministic and DB-free: the database and every network provider are
 * mocked; no real service is contacted and no credentials are required.
 */

jest.mock('../config/database', () => ({
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $queryRaw: jest.fn(),
  checkHealth: jest.fn(),
  getDatabaseTelemetry: jest.fn(() => ({ configured: true, isCloud: false })),
  user: { count: jest.fn() },
}));

const request = require('supertest');
const app = require('../app');
const prisma = require('../config/database');
const cloudHealthService = require('../services/cloudHealthService');
const newsService = require('../services/newsService');
const storageService = require('../services/storageService');
const { sanitizeErrorForLog } = require('../utils/logSanitizer');

const SECRET = 'abc123SECRET';
const LEAKY_DB_ERROR = `probe failed token=${SECRET} db=postgresql://admin:${SECRET}@db.internal:5432/prod`;
const LEAKY_HTTP_ERROR = `news fetch failed https://api.marketaux.com/v1/news?api_token=${SECRET}`;

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
};

const restoreEnv = (key, value) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

let errorSpy;
let warnSpy;

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  restoreEnv('NODE_ENV', ORIGINAL_ENV.NODE_ENV);
  restoreEnv('STORAGE_PROVIDER', ORIGINAL_ENV.STORAGE_PROVIDER);
});

const joinedCalls = (spy) => spy.mock.calls.map((args) => args.join(' ')).join('\n');

// ============================================================================
// 1. sanitizeErrorForLog — the mechanism the probes rely on
// ============================================================================
describe('sanitizeErrorForLog', () => {
  it('redacts credentials embedded in a connection URL', () => {
    const out = sanitizeErrorForLog(`cannot connect postgresql://admin:sup3rS3cret@db.internal:5432/prod`);
    expect(out).not.toContain('sup3rS3cret');
    expect(out).toContain('db.internal');
  });

  it('redacts sensitive query parameters (api_token, signed-URL params)', () => {
    const out = sanitizeErrorForLog(
      'GET https://api.marketaux.com/v1/news?api_token=abc123SECRET&symbols=TCS failed'
    );
    expect(out).not.toContain('abc123SECRET');
    expect(out).toContain('symbols=TCS');
  });

  it('redacts a bare key=value secret outside a URL', () => {
    const out = sanitizeErrorForLog('upstream error token=abc123SECRET done');
    expect(out).not.toContain('abc123SECRET');
    expect(out).toContain('token=***');
  });

  it('redacts AWS key ids, JWTs and bearer credentials by shape', () => {
    const out = sanitizeErrorForLog(
      'AKIAIOSFODNN7EXAMPLE eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop Bearer someLongToken12345'
    );
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('someLongToken12345');
  });

  it('collapses control characters so a message cannot forge extra log lines', () => {
    const out = sanitizeErrorForLog('line1\n[ERROR] forged line\nline2');
    expect(out).not.toContain('\n');
  });

  it('bounds extremely long messages', () => {
    const out = sanitizeErrorForLog('x'.repeat(5000), { maxLength: 300 });
    expect(out.length).toBeLessThanOrEqual(301);
  });

  it('never throws on null/undefined', () => {
    expect(sanitizeErrorForLog(null)).toBe('Unknown error');
    expect(sanitizeErrorForLog(undefined)).toBe('Unknown error');
  });
});

// ============================================================================
// 2. Probe endpoints — stable generic failure, sanitized server-side log
// ============================================================================
describe('GET /api/v1/health/cloud-detailed — failure is generic and logged sanitized', () => {
  it('returns a stable 500 and never echoes the upstream error', async () => {
    const leaky = new Error(LEAKY_DB_ERROR);
    leaky.code = 'P1001';
    jest.spyOn(cloudHealthService, 'checkAllSubsystems').mockRejectedValue(leaky);

    const res = await request(app).get('/api/v1/health/cloud-detailed');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.status).toBe('error');
    expect(res.body.code).toBe('HEALTH_PROBE_FAILED');
    expect(res.body.error).toBe('Health probe failed');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain('postgresql://');

    const logged = joinedCalls(errorSpy);
    expect(logged).toContain('cloud-detailed');
    expect(logged).not.toContain(SECRET);
  });
});

describe('GET /api/v1/health/news — failure is generic and logged sanitized', () => {
  it('returns a stable 500 and never echoes the upstream error', async () => {
    jest.spyOn(newsService, 'checkNewsHealth').mockRejectedValue(new Error(LEAKY_HTTP_ERROR));

    const res = await request(app).get('/api/v1/health/news');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toBe('News health probe failed');
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain('api_token');

    const logged = joinedCalls(errorSpy);
    expect(logged).toContain('news');
    expect(logged).not.toContain(SECRET);
  });
});

// ============================================================================
// 3. Storage durability — never silently ephemeral
// ============================================================================
describe('storage durability reporting', () => {
  const localHealthy = { available: true, status: 'available', provider: 'local', latencyMs: 1 };
  const cloudHealthy = { available: true, status: 'available', provider: 's3', latencyMs: 1 };
  const cloudDown = { available: false, status: 'error', provider: 's3', error: 'unreachable', latencyMs: 1 };

  it('reports local disk as available but NOT durable', async () => {
    process.env.STORAGE_PROVIDER = 'local';
    jest.spyOn(storageService.localProvider, 'checkHealth').mockResolvedValue(localHealthy);

    const health = await storageService.checkStorageHealth();

    expect(health.available).toBe(true);
    expect(health.durable).toBe(false);
    expect(health.ephemeral).toBe(true);
  });

  it('reports reachable S3 storage as durable', async () => {
    process.env.STORAGE_PROVIDER = 's3';
    jest.spyOn(storageService.cloudProvider, 'checkHealth').mockResolvedValue(cloudHealthy);

    const health = await storageService.checkStorageHealth();

    expect(health.available).toBe(true);
    expect(health.durable).toBe(true);
    expect(health.ephemeral).toBe(false);
  });

  it('reports a downed bucket serving the local fallback as NOT durable', async () => {
    process.env.STORAGE_PROVIDER = 's3';
    jest.spyOn(storageService.cloudProvider, 'checkHealth').mockResolvedValue(cloudDown);
    jest.spyOn(storageService.localProvider, 'checkHealth').mockResolvedValue(localHealthy);

    const health = await storageService.checkStorageHealth();

    expect(health.available).toBe(true);
    expect(health.cloudStatus).toBe('degraded');
    expect(health.durable).toBe(false);
    expect(health.ephemeral).toBe(true);
  });

  it('warns loudly in production when serving from ephemeral local disk', () => {
    process.env.NODE_ENV = 'production';
    process.env.STORAGE_PROVIDER = 'local';

    const emitted = storageService.warnIfEphemeralInProduction();

    expect(emitted).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning = joinedCalls(warnSpy);
    expect(warning).toContain('STORAGE_PROVIDER');
    expect(warning).toContain('S3_BUCKET');
  });

  it('stays quiet in production when storage is durable', () => {
    process.env.NODE_ENV = 'production';
    process.env.STORAGE_PROVIDER = 's3';

    expect(storageService.warnIfEphemeralInProduction()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays quiet outside production on local disk', () => {
    process.env.NODE_ENV = 'development';
    process.env.STORAGE_PROVIDER = 'local';

    expect(storageService.warnIfEphemeralInProduction()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 4. Primary health probe — durability is visible to an uptime reader
// ============================================================================
describe('GET /api/v1/health — exposes storage durability', () => {
  it('flags ephemeral local storage on the primary health probe', async () => {
    prisma.checkHealth.mockResolvedValue({
      healthy: true, status: 'connected', latencyMs: 1, isCloud: false,
    });
    process.env.STORAGE_PROVIDER = 'local';
    jest.spyOn(storageService.localProvider, 'checkHealth').mockResolvedValue({
      available: true, status: 'available', provider: 'local', latencyMs: 1,
    });

    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.storage).toBe('available');
    expect(res.body.storageDurable).toBe(false);
  });
});
