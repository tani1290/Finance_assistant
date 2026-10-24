/**
 * FinPro — hybrid rate-limit store.
 *
 * A single Render instance can use the default in-process MemoryStore, but the
 * moment a second instance exists, per-IP limits must be shared or an attacker
 * gets N times the budget. This store uses the optional Redis cache when it is
 * available and transparently falls back to the built-in MemoryStore when it is
 * not. A Redis outage therefore degrades limits to per-instance, it never turns
 * into a 500 or an unlimited endpoint.
 *
 * The fallback is deliberately not a distributed lock: correctness under a
 * partial outage is "best effort per instance", which is the safe failure mode
 * for availability protection.
 */

const { MemoryStore } = require('express-rate-limit');
const cacheService = require('./cacheService');

class HybridRateLimitStore {
  constructor({ name = 'api', memoryStore } = {}) {
    this.name = name;
    this.memory = memoryStore || new MemoryStore();
    this.windowMs = 15 * 60 * 1000;
    // Keys are shared when Redis is usable. The flag is informational for
    // express-rate-limit's validation; the hybrid fallback is documented.
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options?.windowMs || this.windowMs;
    this.memory.init(options);
  }

  async increment(key) {
    const shared = await cacheService.incr(`ratelimit:${this.name}:${key}`, this.windowMs);
    if (shared.supported) {
      return {
        totalHits: shared.totalHits,
        resetTime: new Date(Date.now() + shared.ttlMs),
      };
    }
    // MemoryStore returns its mutable client object; copy it so a later hit
    // cannot rewrite the response of an earlier request.
    const local = await this.memory.increment(key);
    return { totalHits: local.totalHits, resetTime: local.resetTime };
  }

  async decrement(key) {
    const shared = await cacheService.decr(`ratelimit:${this.name}:${key}`, this.windowMs);
    if (!shared.supported) await this.memory.decrement(key);
  }

  async resetKey(key) {
    await cacheService.del(`ratelimit:${this.name}:${key}`);
    await this.memory.resetKey(key);
  }

  async resetAll() {
    // Never SCAN/FLUSH the shared Redis from request code. Local reset is enough
    // for tests and admin tooling.
    await this.memory.resetAll();
  }

  shutdown() {
    this.memory.shutdown();
  }
}

module.exports = { HybridRateLimitStore };
