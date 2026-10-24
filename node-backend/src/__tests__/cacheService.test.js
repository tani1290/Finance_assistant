/**
 * Cache layer — correctness and failure-mode tests.
 *
 * The shared cache must never be required for a request to succeed. These
 * tests exercise the memory path, TTL, singleflight, Redis hits, Redis outage
 * degradation, circuit opening and atomic counters without contacting a real
 * Redis server.
 */

const cacheService = require('../services/cacheService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createFakeRedis = () => {
  const store = new Map();
  const counters = new Map();
  const calls = { get: 0, set: 0, del: 0, ping: 0, eval: 0, quit: 0 };

  return {
    store,
    calls,
    async get(key) {
      calls.get += 1;
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, options = {}) {
      calls.set += 1;
      if (options.NX && store.has(key)) return null;
      const ttl = options.PX || options.px || 60000;
      store.set(key, { value, expiresAt: Date.now() + ttl });
      return 'OK';
    },
    async del(key) {
      calls.del += 1;
      return store.delete(key) ? 1 : 0;
    },
    async ping() {
      calls.ping += 1;
      return 'PONG';
    },
    async eval(_script, { keys = [], arguments: args = [] } = {}) {
      calls.eval += 1;
      const key = keys[0];
      // Release-lock script path.
      if (_script.includes('DEL') && store.has(key)) {
        const current = store.get(key);
        if (current.value === args[0]) {
          store.delete(key);
          return 1;
        }
        return 0;
      }
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);
      return [next, Number(args[0]) || 60000];
    },
    async quit() {
      calls.quit += 1;
      return 'OK';
    },
  };
};

afterEach(() => {
  cacheService.__resetForTests();
});

describe('memory cache', () => {
  test('stores, reads and deletes a value', async () => {
    await cacheService.set('quote:RELIANCE', { price: 100 }, { ttlMs: 1000 });
    expect(await cacheService.get('quote:RELIANCE')).toEqual({ price: 100 });

    const deleted = await cacheService.del('quote:RELIANCE');
    expect(deleted.deleted).toBe(true);
    expect(await cacheService.get('quote:RELIANCE')).toBeNull();
  });

  test('expires values after their TTL', async () => {
    await cacheService.set('ttl:key', 'value', { ttlMs: 20 });
    expect(await cacheService.get('ttl:key')).toBe('value');
    await sleep(35);
    expect(await cacheService.get('ttl:key')).toBeNull();
  });

  test('namespaces keys so environments cannot collide', () => {
    const previous = process.env.CACHE_KEY_PREFIX;
    process.env.CACHE_KEY_PREFIX = 'finpro:test';
    try {
      expect(cacheService.namespaceKey('news:foo')).toBe('finpro:test:news:foo');
    } finally {
      if (previous === undefined) delete process.env.CACHE_KEY_PREFIX;
      else process.env.CACHE_KEY_PREFIX = previous;
    }
  });
});

describe('read-through cache', () => {
  test('collapses concurrent misses into one loader call', async () => {
    const loader = jest.fn(async () => {
      await sleep(40);
      return { value: 42 };
    });

    const [a, b, c] = await Promise.all([
      cacheService.withCache('singleflight:key', 1000, loader),
      cacheService.withCache('singleflight:key', 1000, loader),
      cacheService.withCache('singleflight:key', 1000, loader),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(a.value).toEqual({ value: 42 });
    expect(b.value).toEqual({ value: 42 });
    expect(c.value).toEqual({ value: 42 });
  });

  test('serves a warm value without calling the loader', async () => {
    const loader = jest.fn(async () => 'fresh');
    await cacheService.set('warm:key', 'cached', { ttlMs: 1000 });

    const result = await cacheService.withCache('warm:key', 1000, loader);
    expect(result.hit).toBe(true);
    expect(result.value).toBe('cached');
    expect(loader).not.toHaveBeenCalled();
  });

  test('does not cache undefined loader results', async () => {
    const result = await cacheService.withCache('undefined:key', 1000, async () => undefined);
    expect(result.value).toBeUndefined();
    expect(await cacheService.get('undefined:key')).toBeNull();
  });
});

describe('Redis integration and failure handling', () => {
  test('reads a value written by another instance', async () => {
    const fake = createFakeRedis();
    cacheService.__setClientForTests(fake);

    await cacheService.set('shared:key', { price: 7 }, { ttlMs: 1000, skipShared: true });
    expect(await cacheService.get('shared:key')).toEqual({ price: 7 });

    // Simulate a cold local cache and a warm Redis key.
    cacheService.__resetForTests();
    cacheService.__setClientForTests(fake);
    await fake.set('finpro:test:shared:key', JSON.stringify({
      v: { price: 7 },
      c: Date.now(),
      e: Date.now() + 60000,
    }));
    expect(await cacheService.get('shared:key')).toEqual({ price: 7 });
  });

  test('falls back to memory when Redis rejects commands', async () => {
    const fake = createFakeRedis();
    fake.get = async () => {
      throw new Error('redis://user:secret@example.invalid:6379 connection refused');
    };
    fake.set = async () => {
      throw new Error('redis://user:secret@example.invalid:6379 connection refused');
    };
    cacheService.__setClientForTests(fake);

    await cacheService.set('outage:key', { safe: true }, { ttlMs: 1000, skipShared: true });
    expect(await cacheService.get('outage:key')).toEqual({ safe: true });

    // A failing shared write must not reject the caller.
    await expect(cacheService.set('outage:write', 1, { ttlMs: 1000 })).resolves.toMatchObject({
      stored: true,
      shared: false,
    });
    expect(cacheService.getStatus().lastError).not.toContain('secret');
  });

  test('opens the circuit after repeated failures and stops calling Redis', async () => {
    const previous = process.env.REDIS_FAILURE_THRESHOLD;
    process.env.REDIS_FAILURE_THRESHOLD = '2';
    try {
      const fake = createFakeRedis();
      fake.get = async () => {
        fake.calls.get += 1;
        throw new Error('connection lost');
      };
      cacheService.__setClientForTests(fake);

      await cacheService.get('a');
      await cacheService.get('b');
      const callsAfterOpen = fake.calls.get;
      await cacheService.get('c');
      await cacheService.get('d');

      expect(fake.calls.get).toBe(callsAfterOpen);
      expect(cacheService.getStatus().circuitOpen).toBe(true);
      expect(cacheService.isRedisAvailable()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.REDIS_FAILURE_THRESHOLD;
      else process.env.REDIS_FAILURE_THRESHOLD = previous;
    }
  });

  test('ping reports a latency instead of a placeholder', async () => {
    cacheService.__setClientForTests(createFakeRedis());
    const result = await cacheService.ping();
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('atomic increments use the shared Redis when available', async () => {
    cacheService.__setClientForTests(createFakeRedis());
    const first = await cacheService.incr('ratelimit:user', 60000);
    const second = await cacheService.incr('ratelimit:user', 60000);
    expect(first.supported).toBe(true);
    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
  });

  test('reports unsupported increments when Redis is unavailable', async () => {
    const result = await cacheService.incr('ratelimit:user', 60000);
    expect(result.supported).toBe(false);
  });
});
