/**
 * Push retry queue: bounded, non-blocking, no duplicate delivery on retry.
 */

const { PushQueue } = require('../services/pushQueue');

const makeQueue = (send, overrides = {}) =>
  new PushQueue({
    send,
    baseDelayMs: 1,
    maxDelayMs: 5,
    maxAttempts: 3,
    attemptTimeoutMs: 1000,
    dedupeTtlMs: 60000,
    logger: { warn: () => {}, error: () => {} },
    ...overrides,
  });

const notification = { title: 'Test', body: 'Body' };

describe('PushQueue', () => {
  test('rejects empty token lists and malformed notifications', async () => {
    const queue = makeQueue(jest.fn());
    expect(queue.enqueue({ tokens: [], notification })).toEqual({
      queued: false,
      reason: 'no_tokens',
    });
    expect(queue.enqueue({ tokens: ['t1'], notification: null })).toEqual({
      queued: false,
      reason: 'no_notification',
    });
    await queue.shutdown(0);
  });

  test('deduplicates by key until the TTL expires', async () => {
    const send = jest.fn().mockResolvedValue({ success: true, failures: [] });
    const queue = makeQueue(send, { dedupeTtlMs: 60000 });
    expect(queue.enqueue({ tokens: ['t1'], notification, dedupeKey: 'tx:1' }).queued).toBe(true);
    expect(queue.enqueue({ tokens: ['t1'], notification, dedupeKey: 'tx:1' })).toEqual({
      queued: false,
      reason: 'duplicate',
    });
    await queue.shutdown(1000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('drops new jobs when the queue is full', async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const queue = makeQueue(() => pending, { concurrency: 1, maxSize: 1 });
    expect(queue.enqueue({ tokens: ['t1'], notification }).queued).toBe(true);
    // First job occupies the single slot (shifted into active immediately).
    expect(queue.enqueue({ tokens: ['t2'], notification }).queued).toBe(false);
    release({ success: true, failures: [] });
    await queue.shutdown(1000);
  });

  test('a full queue does not poison a dedupe key for a later retry', async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const queue = makeQueue(() => pending, { concurrency: 1, maxSize: 1 });

    expect(queue.enqueue({ tokens: ['t1'], notification }).queued).toBe(true);
    expect(
      queue.enqueue({ tokens: ['t2'], notification, dedupeKey: 'tx:full' })
    ).toEqual({ queued: false, reason: 'full' });

    release({ success: true, failures: [] });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(
      queue.enqueue({ tokens: ['t2'], notification, dedupeKey: 'tx:full' }).queued
    ).toBe(true);
    await queue.shutdown(1000);
  });

  test('deduplicates tokens within one job', async () => {
    const send = jest.fn().mockResolvedValue({ success: true, failures: [] });
    const queue = makeQueue(send);
    queue.enqueue({ tokens: ['t1', 't1', 't2'], notification });
    await queue.shutdown(1000);
    expect(send).toHaveBeenCalledWith(['t1', 't2'], notification, {});
  });

  test('retries only failed devices, never the already-delivered ones', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        success: true,
        successCount: 1,
        failureCount: 1,
        failures: [{ token: 't2', code: 'messaging/internal-error' }],
      })
      .mockResolvedValueOnce({ success: true, successCount: 1, failureCount: 0, failures: [] });
    const queue = makeQueue(send, { maxAttempts: 3 });
    queue.enqueue({ tokens: ['t1', 't2'], notification });
    await queue.shutdown(2000);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toEqual(['t1', 't2']);
    expect(send.mock.calls[1][0]).toEqual(['t2']);
  });

  test('does not retry invalid or expired tokens', async () => {
    const send = jest.fn().mockResolvedValue({
      success: true,
      successCount: 0,
      failureCount: 1,
      failures: [{ token: 'dead', code: 'messaging/registration-token-not-registered' }],
    });
    const queue = makeQueue(send);
    queue.enqueue({ tokens: ['dead'], notification });
    await queue.shutdown(1000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('does not retry when Firebase is not configured', async () => {
    const send = jest.fn().mockResolvedValue({ success: false, error: 'FCM not configured' });
    const queue = makeQueue(send);
    queue.enqueue({ tokens: ['t1'], notification });
    await queue.shutdown(1000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('stops after the attempt budget is exhausted', async () => {
    const send = jest.fn().mockResolvedValue({
      success: true,
      failures: [{ token: 't1', code: 'messaging/server-unavailable' }],
    });
    const queue = makeQueue(send, { maxAttempts: 2 });
    queue.enqueue({ tokens: ['t1'], notification });
    await queue.shutdown(3000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('treats a hung provider call as a failed attempt', async () => {
    const send = jest.fn(() => new Promise(() => {}));
    const queue = makeQueue(send, { maxAttempts: 1, attemptTimeoutMs: 50 });
    queue.enqueue({ tokens: ['t1'], notification });
    await queue.shutdown(2000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('shutdown waits for in-flight work to finish', async () => {
    const send = jest.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, failures: [] }), 10);
        })
    );
    const queue = makeQueue(send, { concurrency: 1 });
    queue.enqueue({ tokens: ['t1'], notification });
    await queue.shutdown(1000);
    expect(queue.status()).toMatchObject({ closed: true, queued: 0, active: 0 });
  });

  test('shutdown drops queued work at the deadline and stops accepting work', async () => {
    let release;
    const send = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const queue = makeQueue(send, { concurrency: 1, maxSize: 10 });
    queue.enqueue({ tokens: ['t1'], notification });
    queue.enqueue({ tokens: ['t2'], notification });
    queue.enqueue({ tokens: ['t3'], notification });

    await queue.shutdown(50);
    expect(queue.status()).toMatchObject({ closed: true, queued: 0 });
    expect(queue.enqueue({ tokens: ['t4'], notification })).toEqual({
      queued: false,
      reason: 'shutdown',
    });
    // Let the one in-flight attempt settle so Jest has no pending handle.
    release({ success: true, failures: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  test('reports queue status without leaking tokens', async () => {
    const queue = makeQueue(jest.fn().mockResolvedValue({ success: true, failures: [] }));
    queue.enqueue({ tokens: ['secret-token'], notification });
    const status = queue.status();
    expect(status).not.toHaveProperty('tokens');
    expect(JSON.stringify(status)).not.toContain('secret-token');
    await queue.shutdown(1000);
  });
});
