/**
 * FinPro — bounded in-process retry queue for non-critical push delivery.
 *
 * Push notifications are best-effort: a delayed or lost notification must never
 * block an HTTP response or fail a confirmed transaction. This queue keeps the
 * notification code out of the request path while adding bounded retries,
 * concurrency limits, duplicate suppression and observable outcomes.
 *
 * Durability limits (documented, not hidden):
 *  - Jobs live in this process's heap. A crash, deploy or OOM loses queued
 *    notifications. They are NOT transactionally durable.
 *  - The queue is capped (`PUSH_QUEUE_MAX`, default 200). When full, new jobs
 *    are dropped and counted, never buffered without bound.
 *  - This is not a replacement for a durable worker/queue. If push delivery
 *    becomes financially or legally critical, provision Redis + a worker and
 *    move this contract onto a durable queue.
 *
 * Retry policy:
 *  - Up to `PUSH_MAX_ATTEMPTS` total attempts with exponential backoff + jitter.
 *  - Invalid/expired FCM tokens and "not configured" are permanent: retrying
 *    cannot succeed, so they are dropped immediately.
 *  - Only the failed subset is retried, so already-delivered devices do not get
 *    duplicate notifications.
 */

const crypto = require('crypto');
const metrics = require('./metrics');
const fcmService = require('./fcmService');

const PERMANENT_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'INVALID_TOKEN',
]);

const pushEnqueued = metrics.defineCounter(
  'finpro_push_jobs_enqueued_total',
  'Push jobs accepted into the in-process queue.'
);
const pushCompleted = metrics.defineCounter(
  'finpro_push_jobs_completed_total',
  'Push jobs that reached a terminal outcome.',
  ['outcome']
);
const pushAttempts = metrics.defineCounter(
  'finpro_push_attempts_total',
  'Push delivery attempts, including retries.'
);
const pushRetries = metrics.defineCounter(
  'finpro_push_retries_total',
  'Push delivery attempts scheduled for retry.'
);
const pushInvalidTokens = metrics.defineCounter(
  'finpro_push_invalid_tokens_total',
  'FCM tokens rejected permanently and not retried.'
);
const pushQueueDepth = metrics.defineGauge(
  'finpro_push_queue_depth',
  'Push jobs waiting or in flight in this process.'
);
const pushSendDuration = metrics.defineHistogram(
  'finpro_push_send_duration_seconds',
  'Duration of a push delivery attempt.',
  [],
  [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
);

const jitter = (max) => Math.floor(Math.random() * Math.max(1, max));

const isPermanentFailure = (failure) => {
  const code = String(failure?.code || failure?.error || '');
  if (PERMANENT_CODES.has(code)) return true;
  return /not configured|invalid-registration-token|registration-token-not-registered|invalid token/i.test(
    code
  );
};

class PushQueue {
  constructor({
    send = (tokens, notification, data) =>
      fcmService.sendToMultiple(tokens, notification, data),
    maxSize = Number.parseInt(process.env.PUSH_QUEUE_MAX || '200', 10),
    concurrency = Number.parseInt(process.env.PUSH_CONCURRENCY || '2', 10),
    maxAttempts = Number.parseInt(process.env.PUSH_MAX_ATTEMPTS || '3', 10),
    baseDelayMs = Number.parseInt(process.env.PUSH_RETRY_BASE_MS || '500', 10),
    maxDelayMs = Number.parseInt(process.env.PUSH_RETRY_MAX_MS || '10000', 10),
    attemptTimeoutMs = Number.parseInt(process.env.PUSH_ATTEMPT_TIMEOUT_MS || '10000', 10),
    dedupeTtlMs = Number.parseInt(process.env.PUSH_DEDUPE_TTL_MS || '300000', 10),
    random = jitter,
    logger = console,
  } = {}) {
    this.send = send;
    this.maxSize = Math.max(1, maxSize);
    this.concurrency = Math.max(1, concurrency);
    this.maxAttempts = Math.max(1, maxAttempts);
    this.baseDelayMs = Math.max(1, baseDelayMs);
    this.maxDelayMs = Math.max(this.baseDelayMs, maxDelayMs);
    this.attemptTimeoutMs = Math.max(100, attemptTimeoutMs);
    this.dedupeTtlMs = Math.max(0, dedupeTtlMs);
    this.random = random;
    this.logger = logger;

    this.queue = [];
    this.active = 0;
    // `accepting` stops new work at shutdown; `stopped` is only set when the
    // drain deadline expires, so queued retries can still finish gracefully.
    this.accepting = true;
    this.stopped = false;
    this.timers = new Set();
    this.dedupe = new Map();
    this.idleWaiters = [];
    this.sequence = 0;
    this._refreshDepth();
  }

  _refreshDepth() {
    pushQueueDepth({}, this.queue.length + this.active);
  }

  _pruneDedupe(now = Date.now()) {
    for (const [key, expiresAt] of this.dedupe) {
      if (expiresAt <= now) this.dedupe.delete(key);
    }
  }

  _withTimeout(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('Push delivery attempt timed out.');
        err.code = 'PUSH_TIMEOUT';
        reject(err);
      }, this.attemptTimeoutMs);
      if (timer.unref) timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  _complete(job, outcome) {
    pushCompleted({ outcome });
    this._refreshDepth();
    this._notifyIdle();
  }

  _notifyIdle() {
    if (this.active === 0 && this.queue.length === 0 && this.timers.size === 0) {
      const waiters = this.idleWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  _scheduleRetry(job, reason) {
    if (this.stopped) {
      pushCompleted({ outcome: 'shutdown' });
      this._refreshDepth();
      this._notifyIdle();
      return;
    }
    if (job.attempts >= this.maxAttempts) {
      pushCompleted({ outcome: 'exhausted' });
      this.logger.warn(
        `[PushQueue] Dropping job ${job.id} after ${job.attempts} attempts (${reason}).`
      );
      this._refreshDepth();
      this._notifyIdle();
      return;
    }

    const exponential = this.baseDelayMs * 2 ** (job.attempts - 1);
    const delay = Math.min(this.maxDelayMs, exponential) + jitter(this.baseDelayMs);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.stopped) {
        pushCompleted({ outcome: 'shutdown' });
        this._refreshDepth();
        this._notifyIdle();
        return;
      }
      if (this.queue.length + this.active >= this.maxSize) {
        pushCompleted({ outcome: 'full' });
        this.logger.warn(`[PushQueue] Dropping retry for job ${job.id}: queue full.`);
        this._refreshDepth();
        this._notifyIdle();
        return;
      }
      this.queue.unshift(job);
      pushRetries({}, 1);
      this._refreshDepth();
      this._pump();
    }, delay);
    if (timer.unref) timer.unref();
    this.timers.add(timer);
  }

  async _run(job) {
    this.active += 1;
    job.attempts += 1;
    this._refreshDepth();

    const started = Date.now();
    let result;
    try {
      result = await this._withTimeout(this.send(job.tokens, job.notification, job.data));
    } catch (err) {
      result = {
        success: false,
        error: err.message,
        failures: job.tokens.map((token) => ({ token, code: err.code || 'TRANSPORT' })),
      };
    }
    pushAttempts({}, 1);
    pushSendDuration({}, (Date.now() - started) / 1000);

    if (result?.success === false) {
      if (isPermanentFailure(result)) {
        pushCompleted({ outcome: 'permanent' });
        this.logger.warn(`[PushQueue] Dropping job ${job.id}: ${result.error || 'permanent failure'}.`);
      } else {
        this._scheduleRetry(job, result.error || 'send failed');
      }
    } else {
      const failures = Array.isArray(result?.failures) ? result.failures : [];
      const retryable = [];
      let permanent = 0;
      for (const failure of failures) {
        if (isPermanentFailure(failure)) permanent += 1;
        else retryable.push(failure);
      }
      if (permanent > 0) pushInvalidTokens({}, permanent);

      if (retryable.length === 0) {
        pushCompleted({ outcome: permanent > 0 ? 'partial' : 'sent' });
      } else {
        // Retry only the failed devices. Successfully delivered tokens are never
        // sent a second copy of the same notification.
        job.tokens = retryable
          .map((failure) => failure.token)
          .filter((token) => typeof token === 'string' && token.length > 0);
        if (job.tokens.length === 0) {
          pushCompleted({ outcome: 'partial' });
        } else {
          this._scheduleRetry(job, 'partial delivery');
        }
      }
    }

    this.active -= 1;
    this._refreshDepth();
    this._pump();
    this._notifyIdle();
  }

  _pump() {
    while (!this.stopped && this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      this._refreshDepth();
      this._run(job).catch((err) => {
        this.logger.error(`[PushQueue] Unexpected job failure: ${err.message}`);
      });
    }
    this._notifyIdle();
  }

  /**
   * @returns {{queued: boolean, id?: string, reason?: string}}
   */
  enqueue({ tokens, notification, data = {}, dedupeKey = null } = {}) {
    if (!this.accepting) return { queued: false, reason: 'shutdown' };

    const uniqueTokens = [
      ...new Set((tokens || []).filter((token) => typeof token === 'string' && token.length > 0)),
    ];
    if (uniqueTokens.length === 0) return { queued: false, reason: 'no_tokens' };
    if (!notification || typeof notification !== 'object') {
      return { queued: false, reason: 'no_notification' };
    }

    const now = Date.now();
    this._pruneDedupe(now);
    if (dedupeKey) {
      const existing = this.dedupe.get(dedupeKey);
      if (existing && existing > now) {
        pushCompleted({ outcome: 'duplicate' });
        return { queued: false, reason: 'duplicate' };
      }
    }

    if (this.queue.length + this.active >= this.maxSize) {
      pushCompleted({ outcome: 'full' });
      return { queued: false, reason: 'full' };
    }

    // Record duplicate suppression only after the job is actually accepted, so
    // a full queue does not poison the key for later legitimate retries.
    if (dedupeKey) this.dedupe.set(dedupeKey, now + this.dedupeTtlMs);

    const id = `push_${++this.sequence}_${crypto.randomUUID()}`;
    this.queue.push({
      id,
      tokens: uniqueTokens,
      notification,
      data,
      attempts: 0,
      dedupeKey,
      enqueuedAt: now,
    });
    pushEnqueued({}, 1);
    this._refreshDepth();
    this._pump();
    return { queued: true, id };
  }

  async shutdown(timeoutMs = 5000) {
    this.accepting = false;
    if (this.active === 0 && this.queue.length === 0 && this.timers.size === 0) return;

    await Promise.race([
      new Promise((resolve) => this.idleWaiters.push(resolve)),
      new Promise((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, timeoutMs));
        if (timer.unref) timer.unref();
      }),
    ]);

    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const abandoned = this.queue.length;
    this.queue.length = 0;
    if (abandoned > 0) {
      pushCompleted({ outcome: 'shutdown' }, abandoned);
      this.logger.warn(`[PushQueue] Shutdown deadline reached; dropped ${abandoned} queued job(s).`);
    }
    this.dedupe.clear();
    this._refreshDepth();
  }

  status() {
    return {
      queued: this.queue.length,
      active: this.active,
      maxSize: this.maxSize,
      concurrency: this.concurrency,
      closed: !this.accepting || this.stopped,
      retryTimers: this.timers.size,
      dedupeEntries: this.dedupe.size,
    };
  }
}

const pushQueue = new PushQueue();

module.exports = {
  PushQueue,
  pushQueue,
  enqueuePush: (job) => pushQueue.enqueue(job),
  shutdownPushQueue: (timeoutMs) => pushQueue.shutdown(timeoutMs),
};
