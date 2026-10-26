/**
 * FinPro — optional shared cache with a mandatory in-memory fallback.
 *
 * Design constraints:
 *  - Redis is an accelerator, never a hard dependency. Every read has a local
 *    memory path; every write updates memory before touching Redis.
 *  - Only public, non-personal data (market quotes, news) belongs in the shared
 *    cache. Authenticated financial payloads (balances, transactions, budgets,
 *    statements, receipts, AI context) must never be written here. There is no
 *    code path in this module that accepts user-scoped data implicitly; callers
 *    construct keys explicitly.
 *  - A Redis outage must add at most `REDIS_COMMAND_TIMEOUT_MS` of latency to a
 *    request, then degrade to memory. After `REDIS_FAILURE_THRESHOLD` consecutive
 *    failures the circuit opens for `REDIS_COOLDOWN_MS`, so a dead Redis cannot
 *    pin every request for the full timeout.
 *  - No key, value or credential is ever logged.
 *
 * Environment:
 *   REDIS_URL                     redis:// or rediss:// connection string
 *   CACHE_ENABLED=false           disable the shared cache entirely
 *   CACHE_KEY_PREFIX              namespace prefix (default finpro:<env>)
 *   REDIS_COMMAND_TIMEOUT_MS      per-command deadline (default 1000)
 *   REDIS_CONNECT_TIMEOUT_MS      initial connect deadline (default 2000)
 *   REDIS_FAILURE_THRESHOLD       failures before opening the circuit (default 3)
 *   REDIS_COOLDOWN_MS             circuit open duration (default 30000)
 *   CACHE_MEMORY_MAX_ENTRIES      local L1 capacity (default 500)
 *   CACHE_MAX_VALUE_BYTES         largest value written (default 256 KiB)
 */

const metrics = require('./metrics');

const DEFAULTS = {
  enabled: true,
  // Keep the optional cache on a short leash: a slow Redis must never add
  // meaningful latency to an API request. The circuit opens after repeated
  // failures and operations fall back to memory.
  commandTimeoutMs: 1000,
  connectTimeoutMs: 2000,
  failureThreshold: 3,
  cooldownMs: 30000,
  memoryMaxEntries: 500,
  maxValueBytes: 256 * 1024,
  defaultTtlMs: 60 * 1000,
};

const readInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const readConfig = () => ({
  enabled: process.env.CACHE_ENABLED !== 'false',
  url: process.env.REDIS_URL || '',
  keyPrefix:
    process.env.CACHE_KEY_PREFIX ||
    `finpro:${process.env.NODE_ENV || 'development'}`,
  commandTimeoutMs: readInt(process.env.REDIS_COMMAND_TIMEOUT_MS, DEFAULTS.commandTimeoutMs),
  connectTimeoutMs: readInt(process.env.REDIS_CONNECT_TIMEOUT_MS, DEFAULTS.connectTimeoutMs),
  failureThreshold: Math.max(1, readInt(process.env.REDIS_FAILURE_THRESHOLD, DEFAULTS.failureThreshold)),
  cooldownMs: readInt(process.env.REDIS_COOLDOWN_MS, DEFAULTS.cooldownMs),
  memoryMaxEntries: Math.max(1, readInt(process.env.CACHE_MEMORY_MAX_ENTRIES, DEFAULTS.memoryMaxEntries)),
  maxValueBytes: Math.max(1024, readInt(process.env.CACHE_MAX_VALUE_BYTES, DEFAULTS.maxValueBytes)),
  defaultTtlMs: readInt(process.env.CACHE_DEFAULT_TTL_MS, DEFAULTS.defaultTtlMs),
});

// ── Metrics (low cardinality; operation names are constants, never keys) ─────
metrics.defineCounter(
  'finpro_cache_operations_total',
  'Cache operations by operation and result.',
  ['operation', 'result']
);
metrics.defineCounter(
  'finpro_cache_errors_total',
  'Cache errors by operation.',
  ['operation']
);
metrics.defineCounter(
  'finpro_cache_singleflight_joins_total',
  'Concurrent cache misses that joined an in-flight loader.'
);
metrics.defineHistogram(
  'finpro_cache_command_duration_seconds',
  'Latency of shared-cache commands.',
  ['operation'],
  [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]
);
metrics.defineGauge('finpro_cache_redis_up', 'Whether the shared Redis cache is currently usable (1/0).');
metrics.defineGauge('finpro_cache_memory_entries', 'Number of live entries in the local cache.');

const state = {
  initialized: false,
  enabled: true,
  configured: false,
  status: 'disabled', // disabled | connecting | connected | degraded | closing | closed
  client: null,
  failures: 0,
  circuitOpenUntil: 0,
  lastError: null,
  memory: new Map(),
  inFlight: new Map(),
  stats: {
    memoryHits: 0,
    memoryMisses: 0,
    redisHits: 0,
    redisMisses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    timeouts: 0,
  },
};

const sanitizeError = (err) => {
  const raw = String(err?.message || err || 'unknown cache error');
  // Strip credentials if a driver ever includes the connection URI.
  return raw.replace(/(rediss?:\/\/)[^@\s]+@/gi, '$1[redacted]@').slice(0, 240);
};

const now = () => Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Cache ${label} timed out after ${ms}ms`);
      err.code = 'CACHE_TIMEOUT';
      reject(err);
    }, ms);
    if (timer.unref) timer.unref();
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });

const isRedisAvailable = () =>
  state.enabled &&
  state.status === 'connected' &&
  !!state.client &&
  state.circuitOpenUntil <= now();

const updateRedisGauge = () => {
  metrics.setGauge('finpro_cache_redis_up', {}, isRedisAvailable() ? 1 : 0);
};

const recordFailure = (operation, err) => {
  state.failures += 1;
  state.lastError = sanitizeError(err);
  state.stats.errors += 1;
  metrics.increment('finpro_cache_errors_total', { operation });
  metrics.increment('finpro_cache_operations_total', { operation, result: 'error' });
  if (err?.code === 'CACHE_TIMEOUT') state.stats.timeouts += 1;

  if (state.failures >= readConfig().failureThreshold) {
    state.circuitOpenUntil = now() + readConfig().cooldownMs;
    if (state.status === 'connected') state.status = 'degraded';
  }
  updateRedisGauge();
};

const recordSuccess = () => {
  if (state.failures > 0) state.failures = 0;
  state.circuitOpenUntil = 0;
  if (state.status === 'degraded') state.status = 'connected';
  updateRedisGauge();
};

const runRedis = async (operation, fn) => {
  if (!isRedisAvailable()) {
    metrics.increment('finpro_cache_operations_total', { operation, result: 'unavailable' });
    return { ok: false, reason: 'unavailable' };
  }

  const started = process.hrtime.bigint();
  try {
    const result = await withTimeout(fn(state.client), readConfig().commandTimeoutMs, operation);
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    metrics.observe('finpro_cache_command_duration_seconds', { operation }, seconds);
    metrics.increment('finpro_cache_operations_total', { operation, result: 'ok' });
    recordSuccess();
    return { ok: true, result };
  } catch (err) {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    metrics.observe('finpro_cache_command_duration_seconds', { operation }, seconds);
    recordFailure(operation, err);
    return { ok: false, reason: err?.code === 'CACHE_TIMEOUT' ? 'timeout' : 'error' };
  }
};

const namespaceKey = (key) => {
  const raw = String(key || '');
  if (!raw) throw new Error('Cache key is required.');
  const prefix = readConfig().keyPrefix;
  const namespaced = `${prefix}:${raw}`;
  if (namespaced.length <= 400) return namespaced;
  // Bound key length without pulling in a hash dependency.
  return `${prefix}:sha1:${require('crypto').createHash('sha1').update(raw).digest('hex')}`;
};

const lockKeyFor = (key) => `${namespaceKey(key)}:lock`;

const refreshMemoryGauge = () => {
  metrics.setGauge('finpro_cache_memory_entries', {}, state.memory.size);
};

const evictIfNeeded = () => {
  const max = readConfig().memoryMaxEntries;
  while (state.memory.size > max) {
    const oldest = state.memory.keys().next().value;
    if (oldest === undefined) break;
    state.memory.delete(oldest);
  }
};

const memoryGet = (key) => {
  const entry = state.memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    state.memory.delete(key);
    refreshMemoryGauge();
    return null;
  }
  return entry;
};

const memorySet = (key, value, ttlMs) => {
  const t = now();
  // Re-insert so a refreshed key moves to the newest position instead of being
  // evicted in its original insertion order.
  if (state.memory.has(key)) state.memory.delete(key);
  state.memory.set(key, {
    value,
    createdAt: t,
    expiresAt: t + Math.max(1, ttlMs),
  });
  evictIfNeeded();
  refreshMemoryGauge();
};

const memoryDelete = (key) => {
  const existed = state.memory.delete(key);
  refreshMemoryGauge();
  return existed;
};

const encode = (value, ttlMs) => {
  const t = now();
  const payload = JSON.stringify({ v: value, c: t, e: t + Math.max(1, ttlMs) });
  return { payload, createdAt: t, expiresAt: t + Math.max(1, ttlMs) };
};

const decode = (raw) => {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('v' in parsed)) return null;
    if (typeof parsed.e === 'number' && parsed.e <= now()) return null;
    return {
      value: parsed.v,
      createdAt: typeof parsed.c === 'number' ? parsed.c : now(),
      expiresAt: typeof parsed.e === 'number' ? parsed.e : now() + DEFAULTS.defaultTtlMs,
    };
  } catch {
    return null;
  }
};

const getEntry = async (key) => {
  if (!state.enabled) return null;

  const local = memoryGet(key);
  if (local) {
    state.stats.memoryHits += 1;
    metrics.increment('finpro_cache_operations_total', { operation: 'get', result: 'memory_hit' });
    return { ...local, source: 'memory' };
  }

  state.stats.memoryMisses += 1;
  metrics.increment('finpro_cache_operations_total', { operation: 'get', result: 'memory_miss' });

  const shared = await runRedis('get', (client) => client.get(namespaceKey(key)));
  if (shared.ok && shared.result) {
    const decoded = decode(shared.result);
    if (decoded) {
      const remaining = Math.max(1, decoded.expiresAt - now());
      memorySet(key, decoded.value, remaining);
      state.stats.redisHits += 1;
      metrics.increment('finpro_cache_operations_total', { operation: 'get', result: 'redis_hit' });
      return { ...decoded, source: 'redis' };
    }
  }

  state.stats.redisMisses += 1;
  metrics.increment('finpro_cache_operations_total', { operation: 'get', result: 'miss' });
  return null;
};

const get = async (key) => {
  const entry = await getEntry(key);
  return entry ? entry.value : null;
};

const set = async (key, value, options = {}) => {
  if (!state.enabled || value === undefined) return { stored: false, shared: false };
  const ttlMs = Math.max(1, options.ttlMs || readConfig().defaultTtlMs);
  const encoded = encode(value, ttlMs);

  if (Buffer.byteLength(encoded.payload, 'utf8') > readConfig().maxValueBytes) {
    metrics.increment('finpro_cache_operations_total', { operation: 'set', result: 'too_large' });
    return { stored: false, shared: false, reason: 'value_too_large' };
  }

  memorySet(key, value, ttlMs);
  state.stats.sets += 1;
  metrics.increment('finpro_cache_operations_total', { operation: 'set', result: 'memory' });

  if (options.skipShared) {
    return { stored: true, shared: false };
  }

  const shared = await runRedis('set', (client) =>
    client.set(namespaceKey(key), encoded.payload, { PX: ttlMs })
  );

  return { stored: true, shared: shared.ok };
};

const del = async (key) => {
  memoryDelete(key);
  state.stats.deletes += 1;
  metrics.increment('finpro_cache_operations_total', { operation: 'del', result: 'memory' });
  const shared = await runRedis('del', (client) => client.del(namespaceKey(key)));
  return { deleted: true, shared: shared.ok };
};

const INCR_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

/**
 * Atomic counter for distributed rate limiting. Returns `supported: false` when
 * Redis is not configured/unavailable so the caller can fall back to memory.
 */
const incr = async (key, ttlMs) => {
  if (!isRedisAvailable()) return { supported: false };
  const shared = await runRedis('incr', (client) =>
    client.eval(INCR_SCRIPT, {
      keys: [namespaceKey(key)],
      arguments: [String(Math.max(1, ttlMs))],
    })
  );
  if (!shared.ok) return { supported: false };
  const totalHits = Number(shared.result?.[0] ?? 0);
  const remainingTtl = Number(shared.result?.[1] ?? ttlMs);
  return { supported: true, totalHits, ttlMs: remainingTtl > 0 ? remainingTtl : ttlMs };
};

const DECR_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then
  current = redis.call('DECR', KEYS[1])
end
if current < 0 then
  redis.call('SET', KEYS[1], 0, 'PX', ARGV[1])
  current = 0
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

/**
 * Best-effort decrement for rate-limit stores (`skipSuccessfulRequests`).
 * Returns `supported: false` when no shared Redis is available; the caller
 * keeps its local counter instead.
 */
const decr = async (key, ttlMs) => {
  if (!isRedisAvailable()) return { supported: false };
  const shared = await runRedis('decr', (client) =>
    client.eval(DECR_SCRIPT, {
      keys: [namespaceKey(key)],
      arguments: [String(Math.max(1, ttlMs))],
    })
  );
  if (!shared.ok) return { supported: false };
  return {
    supported: true,
    totalHits: Math.max(0, Number(shared.result?.[0] ?? 0)),
    ttlMs: Math.max(1, Number(shared.result?.[1] ?? ttlMs)),
  };
};

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const acquireLock = async (key, ttlMs) => {
  if (!isRedisAvailable()) return { supported: false, acquired: false };
  const token = require('crypto').randomBytes(12).toString('hex');
  const shared = await runRedis('lock', (client) =>
    client.set(lockKeyFor(key), token, { NX: true, PX: Math.max(1000, ttlMs) })
  );
  if (!shared.ok) return { supported: false, acquired: false };
  return {
    supported: true,
    acquired: shared.result === 'OK',
    key: lockKeyFor(key),
    token,
  };
};

const releaseLock = async (lock) => {
  if (!lock?.acquired || !lock.key) return;
  await runRedis('unlock', (client) =>
    client.eval(RELEASE_LOCK_SCRIPT, { keys: [lock.key], arguments: [lock.token] })
  );
};

/**
 * Read-through cache with process-local singleflight and an optional Redis lock.
 *
 * The loader always runs when neither cache has a value. If another process
 * holds the shared lock, we wait a short bounded time for that process to
 * populate the cache, then run the loader anyway rather than block the request
 * on an unavailable peer.
 */
const withCache = async (key, ttlMs, loader, options = {}) => {
  if (typeof loader !== 'function') throw new TypeError('withCache requires a loader function.');

  const alreadyInFlight = state.inFlight.get(key);
  if (alreadyInFlight) {
    metrics.increment('finpro_cache_singleflight_joins_total');
    return alreadyInFlight;
  }

  const existing = await getEntry(key);
  if (existing) {
    return {
      value: existing.value,
      hit: true,
      cachedAt: existing.createdAt,
      source: existing.source,
      ageMs: Math.max(0, now() - existing.createdAt),
    };
  }

  // A concurrent caller may have started the loader while this call was
  // awaiting the cache lookup. Join it instead of issuing a duplicate request.
  const inFlight = state.inFlight.get(key);
  if (inFlight) {
    metrics.increment('finpro_cache_singleflight_joins_total');
    return inFlight;
  }

  const promise = (async () => {
    let lock = null;
    try {
      if (options.sharedLock !== false) {
        lock = await acquireLock(key, options.lockTtlMs || Math.min(ttlMs, 10000));
        if (lock.supported && !lock.acquired) {
          const deadline = now() + (options.lockWaitMs ?? 400);
          while (now() < deadline) {
            await sleep(50);
            const hydrated = await getEntry(key);
            if (hydrated) {
              return {
                value: hydrated.value,
                hit: true,
                cachedAt: hydrated.createdAt,
                source: 'peer',
                ageMs: Math.max(0, now() - hydrated.createdAt),
              };
            }
          }
        }
      }

      const value = await loader();
      if (value !== undefined && value !== null) {
        // Never block the caller on the shared-cache write. Memory holds the
        // value immediately; Redis catches up or fails without affecting the
        // response.
        void set(key, value, { ttlMs });
      }
      return { value, hit: false, cachedAt: now(), source: 'loader', ageMs: 0 };
    } finally {
      await releaseLock(lock);
      state.inFlight.delete(key);
    }
  })();

  state.inFlight.set(key, promise);
  return promise;
};

// ── Lifecycle ────────────────────────────────────────────────────────────────

const init = async () => {
  if (state.initialized) return getStatus();
  state.initialized = true;
  const config = readConfig();
  state.enabled = config.enabled;
  state.configured = !!config.url;

  if (!config.enabled) {
    state.status = 'disabled';
    updateRedisGauge();
    return getStatus();
  }

  if (!config.url) {
    state.status = 'disabled';
    updateRedisGauge();
    return getStatus();
  }

  let redis;
  try {
    redis = require('redis');
  } catch {
    state.status = 'degraded';
    state.lastError = 'redis package is not installed';
    updateRedisGauge();
    console.warn('[Cache] REDIS_URL is set but the redis package is unavailable; using memory only.');
    return getStatus();
  }

  try {
    const client = redis.createClient({
      url: config.url,
      socket: {
        connectTimeout: config.connectTimeoutMs,
        reconnectStrategy: (retries) => Math.min(1000 * 2 ** Math.min(retries, 5), 30000),
      },
    });
    state.client = client;
    state.status = 'connecting';

    client.on('error', (err) => {
      state.lastError = sanitizeError(err);
      if (state.status === 'connected') state.status = 'degraded';
      updateRedisGauge();
    });
    client.on('ready', () => {
      state.status = 'connected';
      state.failures = 0;
      state.circuitOpenUntil = 0;
      updateRedisGauge();
      console.log('[Cache] Shared Redis cache connected.');
    });
    client.on('end', () => {
      if (state.status !== 'closing' && state.status !== 'closed') state.status = 'degraded';
      updateRedisGauge();
    });
    client.on('reconnecting', () => {
      state.status = 'connecting';
      updateRedisGauge();
    });

    await withTimeout(client.connect(), config.connectTimeoutMs + 250, 'connect');
    state.status = 'connected';
    state.failures = 0;
    state.circuitOpenUntil = 0;
    updateRedisGauge();
    console.log('[Cache] Shared Redis cache ready.');
  } catch (err) {
    state.status = 'degraded';
    state.lastError = sanitizeError(err);
    updateRedisGauge();
    console.warn(`[Cache] Redis unavailable (${state.lastError}); using memory only.`);
  }

  return getStatus();
};

const shutdown = async () => {
  state.status = 'closing';
  if (state.client) {
    try {
      await withTimeout(state.client.quit(), 1500, 'quit');
    } catch {
      try {
        state.client.disconnect();
      } catch {
        // already closed
      }
    }
  }
  state.status = 'closed';
  updateRedisGauge();
};

const ping = async () => {
  if (!state.configured) return { configured: false, ok: false, status: 'disabled', latencyMs: null };
  const started = process.hrtime.bigint();
  const shared = await runRedis('ping', (client) => client.ping());
  const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    configured: true,
    ok: shared.ok && shared.result === 'PONG',
    status: state.status,
    latencyMs: Math.round(latencyMs * 100) / 100,
  };
};

const getStatus = () => ({
  enabled: state.enabled,
  configured: state.configured,
  status: state.status,
  available: isRedisAvailable(),
  circuitOpen: state.circuitOpenUntil > now(),
  circuitRetryInMs: Math.max(0, state.circuitOpenUntil - now()),
  consecutiveFailures: state.failures,
  memoryEntries: state.memory.size,
  lastError: state.lastError,
  stats: { ...state.stats },
});

// ── Test seams (never used by production code) ───────────────────────────────

const __setClientForTests = (client, options = {}) => {
  state.initialized = true;
  state.enabled = options.enabled !== false;
  state.configured = options.configured !== false;
  state.status = options.status || (client ? 'connected' : 'disabled');
  state.client = client || null;
  state.failures = 0;
  state.circuitOpenUntil = 0;
  state.lastError = null;
  updateRedisGauge();
};

const __resetForTests = () => {
  state.initialized = false;
  state.enabled = true;
  state.configured = false;
  state.status = 'disabled';
  state.client = null;
  state.failures = 0;
  state.circuitOpenUntil = 0;
  state.lastError = null;
  state.memory.clear();
  state.inFlight.clear();
  state.stats = {
    memoryHits: 0,
    memoryMisses: 0,
    redisHits: 0,
    redisMisses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    timeouts: 0,
  };
  refreshMemoryGauge();
  updateRedisGauge();
};

refreshMemoryGauge();
updateRedisGauge();

module.exports = {
  init,
  shutdown,
  get,
  set,
  del,
  incr,
  decr,
  withCache,
  ping,
  getStatus,
  isRedisAvailable,
  namespaceKey,
  __setClientForTests,
  __resetForTests,
};
