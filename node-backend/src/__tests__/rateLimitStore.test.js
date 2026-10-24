/**
 * Hybrid rate-limit store — shared when Redis is healthy, local during an
 * outage, never a hard failure.
 */

const cacheService = require('../services/cacheService');
const { HybridRateLimitStore } = require('../services/rateLimitStore');

describe('HybridRateLimitStore', () => {
  let store;

  beforeEach(() => {
    store = new HybridRateLimitStore({ name: 'test' });
    store.init({ windowMs: 60000 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    store.shutdown();
  });

  test('uses the shared counter when Redis is available', async () => {
    const incr = jest.spyOn(cacheService, 'incr').mockResolvedValue({
      supported: true,
      totalHits: 7,
      ttlMs: 30000,
    });

    const result = await store.increment('127.0.0.1');
    expect(incr).toHaveBeenCalledWith('ratelimit:test:127.0.0.1', 60000);
    expect(result.totalHits).toBe(7);
    expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
  });

  test('falls back to the in-process store when Redis is unavailable', async () => {
    jest.spyOn(cacheService, 'incr').mockResolvedValue({ supported: false });

    const first = await store.increment('10.0.0.1');
    const second = await store.increment('10.0.0.1');
    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
  });

  test('decrements the shared counter, or the local one during an outage', async () => {
    const decr = jest.spyOn(cacheService, 'decr').mockResolvedValue({ supported: true });
    await store.decrement('10.0.0.1');
    expect(decr).toHaveBeenCalledWith('ratelimit:test:10.0.0.1', 60000);

    decr.mockResolvedValue({ supported: false });
    jest.spyOn(cacheService, 'incr').mockResolvedValue({ supported: false });
    await store.increment('10.0.0.2');
    await store.increment('10.0.0.2');
    await store.decrement('10.0.0.2');
    const afterDecrement = await store.increment('10.0.0.2');
    expect(afterDecrement.totalHits).toBe(2);
  });

  test('resetKey clears both tiers', async () => {
    const del = jest.spyOn(cacheService, 'del').mockResolvedValue({ deleted: true });
    const memoryReset = jest.spyOn(store.memory, 'resetKey');
    await store.resetKey('10.0.0.3');
    expect(del).toHaveBeenCalledWith('ratelimit:test:10.0.0.3');
    expect(memoryReset).toHaveBeenCalledWith('10.0.0.3');
  });

  test('separate limiter names do not share counters in Redis', async () => {
    const incr = jest.spyOn(cacheService, 'incr').mockResolvedValue({
      supported: true,
      totalHits: 1,
      ttlMs: 1000,
    });
    await store.increment('same-ip');
    expect(incr).toHaveBeenCalledWith('ratelimit:test:same-ip', 60000);
  });
});
