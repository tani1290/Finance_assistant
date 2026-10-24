/**
 * Upstream HTTP client — bounded failure behaviour.
 *
 * These tests use an injected transport, so no network is contacted. They pin
 * the contract that matters for financial correctness: idempotent retries only,
 * bounded backoff, no retry for aborts or oversized Retry-After, safe error
 * objects (no URL/query/API key), concurrency limits and a host circuit.
 */

const { createHttpClient, parseRetryAfterMs } = require('../services/httpClient');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const networkError = (code = 'ECONNRESET') => {
  const err = new Error(`connect ${code}`);
  err.code = code;
  return err;
};

const httpError = (status, headers = {}) => {
  const err = new Error(`HTTP ${status}`);
  err.response = { status, headers };
  err.code = `HTTP_${status}`;
  return err;
};

describe('parseRetryAfterMs', () => {
  test('parses seconds and HTTP dates', () => {
    expect(parseRetryAfterMs({ 'retry-after': '2' })).toBe(2000);
    const future = new Date(Date.now() + 5000).toUTCString();
    const parsed = parseRetryAfterMs({ 'retry-after': future });
    expect(parsed).toBeGreaterThan(3000);
    expect(parsed).toBeLessThanOrEqual(6000);
  });

  test('returns null for a missing or invalid header', () => {
    expect(parseRetryAfterMs({})).toBeNull();
    expect(parseRetryAfterMs({ 'retry-after': 'not-a-date' })).toBeNull();
  });
});

describe('retries', () => {
  test('retries an idempotent GET after a network error', async () => {
    const transport = jest.fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const client = createHttpClient({
      name: 'test-retry',
      retries: 1,
      baseDelayMs: 1,
      maxDelayMs: 2,
      transport,
    });

    const response = await client.get('https://provider.example/quote?apikey=SECRET');
    expect(response.data).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test('never retries a POST unless explicitly opted in', async () => {
    const transport = jest.fn().mockRejectedValue(networkError());
    const client = createHttpClient({ name: 'test-post', retries: 3, baseDelayMs: 1, transport });

    await expect(client.request({ method: 'POST', url: 'https://provider.example/order' }))
      .rejects.toMatchObject({ retryable: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test('retries a POST only when retryNonIdempotent is explicitly set', async () => {
    const transport = jest.fn()
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ status: 200 });

    const client = createHttpClient({ name: 'test-post-optin', retries: 1, baseDelayMs: 1, transport });
    await client.request({
      method: 'POST',
      url: 'https://provider.example/idempotent-write',
      retryNonIdempotent: true,
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test('honours Retry-After for a 429 response', async () => {
    const transport = jest.fn()
      .mockRejectedValueOnce(httpError(429, { 'retry-after': '0' }))
      .mockResolvedValueOnce({ status: 200 });

    const client = createHttpClient({ name: 'test-429', retries: 1, baseDelayMs: 1, transport });
    const response = await client.get('https://provider.example/data');
    expect(response.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test('does not wait when Retry-After exceeds the cap', async () => {
    const transport = jest.fn().mockRejectedValue(httpError(429, { 'retry-after': '120' }));
    const client = createHttpClient({
      name: 'test-429-cap',
      retries: 3,
      baseDelayMs: 1,
      maxRetryAfterMs: 10,
      transport,
    });

    await expect(client.get('https://provider.example/data')).rejects.toMatchObject({ status: 429 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test('does not retry an aborted request', async () => {
    const controller = new AbortController();
    const transport = jest.fn(async () => {
      controller.abort();
      const err = new Error('canceled');
      err.code = 'ERR_CANCELED';
      throw err;
    });
    const client = createHttpClient({ name: 'test-abort', retries: 2, baseDelayMs: 1, transport });

    await expect(client.get('https://provider.example/slow', { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('error safety', () => {
  test('does not leak the URL, query string or API key', async () => {
    const transport = jest.fn().mockRejectedValue(httpError(500));
    const client = createHttpClient({ name: 'test-safe-error', retries: 0, transport });

    try {
      await client.get('https://provider.example/quote?apikey=SUPER_SECRET&symbol=RELIANCE');
      throw new Error('expected rejection');
    } catch (err) {
      expect(err.message).not.toContain('SUPER_SECRET');
      expect(err.message).not.toContain('apikey');
      expect(JSON.stringify(err)).not.toContain('SUPER_SECRET');
      expect(err.response?.status).toBe(500);
    }
  });

  test('a routine 404 does not open the host circuit', async () => {
    const transport = jest.fn().mockRejectedValue(httpError(404));
    const client = createHttpClient({
      name: 'test-404',
      retries: 0,
      failureThreshold: 2,
      cooldownMs: 20,
      transport,
    });

    for (let i = 0; i < 4; i += 1) {
      await expect(client.get('https://provider.example/missing')).rejects.toMatchObject({ status: 404 });
    }
    expect(transport).toHaveBeenCalledTimes(4);
    expect(client.getStatus().circuits[0].state).toBe('closed');
  });
});

describe('circuit and concurrency', () => {
  test('opens after repeated availability failures and fails fast', async () => {
    const transport = jest.fn().mockRejectedValue(networkError('ECONNREFUSED'));
    const client = createHttpClient({
      name: 'test-circuit',
      retries: 0,
      failureThreshold: 2,
      cooldownMs: 5000,
      transport,
    });

    await expect(client.get('https://provider.example/a')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    await expect(client.get('https://provider.example/b')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    await expect(client.get('https://provider.example/c')).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test('caps concurrent requests and rejects queued work after the deadline', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const transport = jest.fn(async () => {
      await gate;
      return { status: 200 };
    });

    const client = createHttpClient({
      name: 'test-concurrency',
      retries: 0,
      maxConcurrent: 1,
      queueTimeoutMs: 20,
      transport,
    });

    const first = client.get('https://provider.example/one');
    await sleep(1);
    await expect(client.get('https://provider.example/two')).rejects.toMatchObject({
      code: 'UPSTREAM_QUEUE_TIMEOUT',
    });
    release();
    await expect(first).resolves.toMatchObject({ status: 200 });
    expect(client.getStatus().queued).toBe(0);
  });

  test('a definitive 4xx closes a half-open probe instead of pinning the circuit', async () => {
    const transport = jest.fn()
      .mockRejectedValueOnce(networkError('ECONNREFUSED'))
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce({ status: 200 });

    const client = createHttpClient({
      name: 'test-half-open',
      retries: 0,
      failureThreshold: 1,
      cooldownMs: 10,
      transport,
    });

    await expect(client.get('https://provider.example/a')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    await sleep(20);
    await expect(client.get('https://provider.example/b')).rejects.toMatchObject({ status: 404 });
    await expect(client.get('https://provider.example/c')).resolves.toMatchObject({ status: 200 });
    expect(client.getStatus().circuits[0].state).toBe('closed');
  });

  test('reset rejects queued callers instead of leaving them pending', async () => {
    const client = createHttpClient({
      name: 'test-reset',
      retries: 0,
      maxConcurrent: 1,
      queueTimeoutMs: 10000,
      transport: () => new Promise(() => {}),
    });

    void client.get('https://provider.example/hang');
    await sleep(1);
    const queued = client.get('https://provider.example/queued');
    client.reset();
    await expect(queued).rejects.toMatchObject({ code: 'UPSTREAM_QUEUE_RESET' });
  });

  test('reports host circuit state for diagnostics', async () => {
    const client = createHttpClient({
      name: 'test-status',
      retries: 0,
      transport: jest.fn().mockResolvedValue({ status: 200 }),
    });
    await client.get('https://provider.example/ok');
    const status = client.getStatus();
    expect(status.client).toBe('test-status');
    expect(status.circuits[0]).toMatchObject({ host: 'provider.example', state: 'closed', failures: 0 });
  });
});
