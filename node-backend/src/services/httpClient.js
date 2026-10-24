/**
 * FinPro — bounded upstream HTTP client.
 *
 * Every outbound provider call gets:
 *  - an explicit timeout (caller override or client default);
 *  - bounded retries with exponential backoff + jitter, for idempotent methods
 *    only (GET/HEAD/OPTIONS) on network errors, 408, 429 and 5xx;
 *  - `Retry-After` support, capped so one provider cannot park a worker;
 *  - a per-host circuit breaker (closed → open → half-open probe);
 *  - a concurrency cap with a bounded queue;
 *  - metrics and sanitised errors (no URL, query string, API key or body).
 *
 * The client never retries POST/PATCH/PUT/DELETE by default: financial writes
 * are handled by the controllers' explicit idempotency/transaction rules.
 */

const axios = require('axios');
const metrics = require('./metrics');

metrics.defineCounter(
  'finpro_upstream_requests_total',
  'Outbound upstream requests by client, method, status and outcome.',
  ['client', 'method', 'status', 'outcome']
);
metrics.defineCounter(
  'finpro_upstream_retries_total',
  'Outbound upstream retries by client and reason.',
  ['client', 'reason']
);
metrics.defineHistogram(
  'finpro_upstream_request_duration_seconds',
  'Outbound upstream request latency per attempt.',
  ['client', 'method'],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20]
);
metrics.defineGauge(
  'finpro_upstream_circuit_state',
  'Circuit state per upstream host (0 closed, 1 half-open, 2 open).',
  ['client', 'host']
);

const DEFAULTS = {
  timeoutMs: 8000,
  retries: 2,
  baseDelayMs: 300,
  maxDelayMs: 3000,
  failureThreshold: 5,
  cooldownMs: 30000,
  maxConcurrent: 8,
  queueTimeoutMs: 8000,
  maxRetryAfterMs: 3000,
};

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ERR_NETWORK',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readInt = (value, fallback, min = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

const parseRetryAfterMs = (headers) => {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(String(raw));
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
};

const circuitError = (name, host) => {
  const err = new Error(`${name} circuit open for ${host}; failing fast.`);
  err.name = 'UpstreamCircuitOpenError';
  err.code = 'CIRCUIT_OPEN';
  err.status = undefined;
  err.retryable = false;
  err.circuitOpen = true;
  return err;
};

const sanitizedError = ({ method, host, status, code, retryable, cause }) => {
  const suffix = status ? ` (HTTP ${status})` : code ? ` (${code})` : '';
  const err = new Error(`${method} ${host} failed${suffix}`);
  err.name = 'UpstreamError';
  err.code = code || (status ? `HTTP_${status}` : 'UPSTREAM_ERROR');
  err.status = status;
  err.host = host;
  err.retryable = !!retryable;
  err.isAxiosError = true;
  if (status) {
    // Callers only need the status/retry hint. Deliberately omit config, URL,
    // query string, request body and response body.
    err.response = {
      status,
      headers: cause?.response?.headers
        ? { 'retry-after': cause.response.headers['retry-after'] }
        : {},
    };
  }
  return err;
};

const disabled = {
  get: async () => {
    throw new Error('HTTP client is disabled.');
  },
  request: async () => {
    throw new Error('HTTP client is disabled.');
  },
  getStatus: () => ({ disabled: true, circuits: [] }),
  reset: () => {},
};

const createHttpClient = (options = {}) => {
  if (options.disabled) return disabled;

  const name = options.name || 'upstream';
  const timeoutMs = readInt(options.timeoutMs, DEFAULTS.timeoutMs, 1);
  const retries = readInt(options.retries, DEFAULTS.retries, 0);
  const baseDelayMs = readInt(options.baseDelayMs, DEFAULTS.baseDelayMs, 0);
  const maxDelayMs = readInt(options.maxDelayMs, DEFAULTS.maxDelayMs, 0);
  const failureThreshold = Math.max(1, readInt(options.failureThreshold, DEFAULTS.failureThreshold, 1));
  const cooldownMs = readInt(options.cooldownMs, DEFAULTS.cooldownMs, 1);
  const maxConcurrent = Math.max(1, readInt(options.maxConcurrent, DEFAULTS.maxConcurrent, 1));
  const queueTimeoutMs = readInt(options.queueTimeoutMs, DEFAULTS.queueTimeoutMs, 1);
  const maxRetryAfterMs = readInt(options.maxRetryAfterMs, DEFAULTS.maxRetryAfterMs, 0);
  const transport = options.transport || ((config) => {
    // Using axios.get/request directly (not a private instance) keeps the
    // repository's existing Jest transport mocks working unchanged.
    if (String(config.method).toUpperCase() === 'GET') return axios.get(config.url, config);
    return axios.request(config);
  });

  const circuits = new Map();
  let active = 0;
  const queue = [];

  const circuitFor = (host) => {
    if (!circuits.has(host)) {
      circuits.set(host, { failures: 0, openUntil: 0, halfOpen: false });
    }
    return circuits.get(host);
  };

  const gaugeFor = (host) => {
    const circuit = circuitFor(host);
    const now = Date.now();
    const value = circuit.openUntil > now ? 2 : circuit.halfOpen ? 1 : 0;
    metrics.setGauge('finpro_upstream_circuit_state', { client: name, host }, value);
  };

  const checkCircuit = (host) => {
    const circuit = circuitFor(host);
    const now = Date.now();
    if (circuit.openUntil > now) {
      gaugeFor(host);
      throw circuitError(name, host);
    }
    if (circuit.openUntil !== 0 && circuit.openUntil <= now) {
      if (circuit.halfOpen) {
        gaugeFor(host);
        throw circuitError(name, host);
      }
      circuit.halfOpen = true;
    }
    gaugeFor(host);
  };

  const recordSuccess = (host) => {
    const circuit = circuitFor(host);
    circuit.failures = 0;
    circuit.openUntil = 0;
    circuit.halfOpen = false;
    gaugeFor(host);
  };

  const recordFailure = (host) => {
    const circuit = circuitFor(host);
    circuit.failures += 1;
    if (circuit.failures >= failureThreshold) {
      circuit.openUntil = Date.now() + cooldownMs;
      circuit.halfOpen = false;
    }
    gaugeFor(host);
  };

  const acquire = () => {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        const err = new Error(`${name} upstream queue timed out.`);
        err.name = 'UpstreamQueueTimeoutError';
        err.code = 'UPSTREAM_QUEUE_TIMEOUT';
        err.retryable = false;
        reject(err);
      }, queueTimeoutMs);
      if (entry.timer.unref) entry.timer.unref();
      queue.push(entry);
    });
  };

  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) {
      clearTimeout(next.timer);
      active += 1;
      next.resolve();
    }
  };

  const backoffMs = (attempt, retryAfterMs) => {
    if (retryAfterMs !== null) return Math.min(retryAfterMs, maxRetryAfterMs);
    const exponential = baseDelayMs * 2 ** attempt;
    const jitter = baseDelayMs > 0 ? Math.floor(Math.random() * baseDelayMs) : 0;
    return Math.min(maxDelayMs, exponential + jitter);
  };

  const request = async (config = {}) => {
    const method = String(config.method || 'GET').toUpperCase();
    const url = config.url;
    if (!url) throw new Error('HTTP client requires a url.');

    let host;
    try {
      host = new URL(url, 'http://localhost').host || 'unknown';
    } catch {
      host = 'invalid-url';
    }

    const idempotent = IDEMPOTENT_METHODS.has(method) || config.retryNonIdempotent === true;
    const maxAttempts = idempotent ? retries + 1 : 1;

    checkCircuit(host);
    await acquire();

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const started = process.hrtime.bigint();
        try {
          const response = await transport({
            ...config,
            method,
            url,
            timeout: config.timeout ?? timeoutMs,
          });
          const status = response?.status ?? 200;
          const seconds = Number(process.hrtime.bigint() - started) / 1e9;
          metrics.observe('finpro_upstream_request_duration_seconds', { client: name, method }, seconds);
          metrics.increment('finpro_upstream_requests_total', {
            client: name,
            method,
            status: String(status),
            outcome: 'success',
          });
          recordSuccess(host);
          return response;
        } catch (err) {
          const status = err.response?.status;
          const code = err.code;
          const aborted =
            code === 'ERR_CANCELED' ||
            err.name === 'CanceledError' ||
            config.signal?.aborted === true;
          const networkFailure = !status && NETWORK_CODES.has(String(code));
          const retryable =
            !aborted &&
            (networkFailure || status === 408 || status === 429 || (status >= 500 && status <= 599));

          const seconds = Number(process.hrtime.bigint() - started) / 1e9;
          metrics.observe('finpro_upstream_request_duration_seconds', { client: name, method }, seconds);

          if (retryable && attempt + 1 < maxAttempts) {
            const retryAfterMs = status === 429 || status === 503 ? parseRetryAfterMs(err.response?.headers) : null;
            if (retryAfterMs === null || retryAfterMs <= maxRetryAfterMs) {
              metrics.increment('finpro_upstream_retries_total', {
                client: name,
                reason: status ? `http_${status}` : String(code || 'network'),
              });
              await sleep(backoffMs(attempt, retryAfterMs));
              continue;
            }
          }

          metrics.increment('finpro_upstream_requests_total', {
            client: name,
            method,
            status: status ? String(status) : String(code || 'error'),
            outcome: aborted ? 'aborted' : 'error',
          });

          // Release a half-open probe on any definitive HTTP answer. A 4xx
          // proves the host is reachable; leaving `halfOpen` set would reject
          // every later request forever because no probe could ever complete.
          const circuit = circuitFor(host);
          if (aborted) {
            if (circuit.halfOpen) circuit.halfOpen = false;
          } else if (circuit.halfOpen) {
            if (status && status < 500) recordSuccess(host);
            else recordFailure(host);
          } else if (retryable || networkFailure || (status >= 500 && status <= 599)) {
            // Only unavailability signals may open the host circuit. A routine
            // 4xx from one endpoint must not black out every other call to the
            // same provider (market and news share hosts).
            recordFailure(host);
          }
          throw sanitizedError({
            method,
            host,
            status,
            code: aborted ? 'ABORTED' : code,
            retryable,
            cause: err,
          });
        }
      }

      // Unreachable: the loop either returns or throws.
      throw sanitizedError({ method, host, code: 'UPSTREAM_LOOP_EXHAUSTED', retryable: false });
    } finally {
      release();
    }
  };

  return {
    request,
    get: (url, config = {}) => request({ ...config, method: 'GET', url }),
    head: (url, config = {}) => request({ ...config, method: 'HEAD', url }),
    getStatus: () => ({
      client: name,
      circuits: [...circuits.entries()].map(([host, circuit]) => ({
        host,
        state: circuit.openUntil > Date.now() ? 'open' : circuit.halfOpen ? 'half-open' : 'closed',
        failures: circuit.failures,
        retryInMs: Math.max(0, circuit.openUntil - Date.now()),
      })),
      active,
      queued: queue.length,
    }),
    reset: () => {
      circuits.clear();
      active = 0;
      while (queue.length) {
        const entry = queue.shift();
        clearTimeout(entry.timer);
        // Never leave a queued caller pending after a reset.
        const err = new Error(`${name} upstream queue was reset.`);
        err.code = 'UPSTREAM_QUEUE_RESET';
        err.retryable = false;
        entry.reject(err);
      }
    },
  };
};

module.exports = {
  createHttpClient,
  parseRetryAfterMs,
  sanitizedError,
  NETWORK_CODES,
  IDEMPOTENT_METHODS,
};
