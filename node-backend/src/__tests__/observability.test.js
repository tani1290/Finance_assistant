/**
 * Observability endpoints — liveness vs readiness vs dependency health.
 *
 * The important contract: optional dependencies (Redis, object storage) must
 * never make the whole service look dead, while the database remains the only
 * hard readiness dependency. The metrics endpoint must not be world-readable in
 * production unless an operator configured a token.
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
const storageService = require('../services/storageService');
const { normalisePath } = require('../middleware/metricsMiddleware');

const healthyDb = { healthy: true, status: 'connected', latencyMs: 2, isCloud: false };
const healthyStorage = {
  available: true,
  durable: false,
  status: 'connected',
  provider: 'local',
  latencyMs: 1,
};

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  METRICS_TOKEN: process.env.METRICS_TOKEN,
};

const restoreEnv = (key, value) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(() => {
  prisma.checkHealth.mockResolvedValue(healthyDb);
  jest.spyOn(storageService, 'checkStorageHealth').mockResolvedValue(healthyStorage);
});

afterEach(() => {
  jest.restoreAllMocks();
  restoreEnv('NODE_ENV', ORIGINAL_ENV.NODE_ENV);
  restoreEnv('METRICS_TOKEN', ORIGINAL_ENV.METRICS_TOKEN);
});

describe('liveness', () => {
  test('stays alive when the database is down', async () => {
    prisma.checkHealth.mockResolvedValue({ healthy: false, status: 'error', latencyMs: null });
    const response = await request(app).get('/api/v1/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ live: true, status: 'alive' });
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('dependency health', () => {
  test('returns 503 when the required database is unavailable', async () => {
    prisma.checkHealth.mockResolvedValue({ healthy: false, status: 'error', latencyMs: null });
    const response = await request(app).get('/api/v1/health/dependencies');
    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
    expect(response.body.dependencies.database).toMatchObject({ required: true, healthy: false });
  });

  test('stays ready when only optional storage is unavailable', async () => {
    storageService.checkStorageHealth.mockResolvedValue({
      available: false,
      durable: false,
      status: 'unavailable',
      provider: 'local',
      latencyMs: null,
    });

    const response = await request(app).get('/api/v1/health/dependencies');
    expect(response.status).toBe(200);
    expect(response.body.ready).toBe(true);
    expect(response.body.dependencies.storage).toMatchObject({ required: false, available: false });
  });

  test('never exposes credentials or connection strings', async () => {
    const response = await request(app).get('/api/v1/health/dependencies');
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/redis:\/\//i);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//i);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toMatch(/password/i);
  });
});

describe('metrics endpoint', () => {
  test('is scrapeable outside production', async () => {
    process.env.NODE_ENV = 'test';
    const response = await request(app).get('/metrics');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('finpro_http_requests_total');
    expect(response.text).not.toContain('password');
  });

  test('requires a token when one is configured', async () => {
    process.env.NODE_ENV = 'test';
    process.env.METRICS_TOKEN = 'test-metrics-token';
    expect((await request(app).get('/metrics')).status).toBe(401);
    const authorized = await request(app)
      .get('/metrics')
      .set('Authorization', 'Bearer test-metrics-token');
    expect(authorized.status).toBe(200);
  });

  test('is hidden in production when no token is configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.METRICS_TOKEN;
    const response = await request(app).get('/metrics');
    expect(response.status).toBe(404);
  });
});

describe('route label normalisation', () => {
  test('collapses ids so scanners cannot explode metric cardinality', () => {
    expect(normalisePath('/api/v1/accounts/123/transactions')).toBe('/api/v1/accounts/:id/transactions');
    expect(normalisePath('/api/v1/accounts/550e8400-e29b-41d4-a716-446655440000')).toBe('/api/v1/accounts/:id');
    expect(normalisePath('/api/v1/health')).toBe('/api/v1/health');
  });
});
