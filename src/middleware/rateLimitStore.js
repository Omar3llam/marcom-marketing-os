// ============================================================
// MARCOM — Redis-backed rate-limit store  (R11 · E2)
// ============================================================
// express-rate-limit defaults to an in-memory store: each Node process keeps
// its own counters. On Render that means the effective ceiling is N instances
// times the configured limit, and every deploy resets it. A limit that cannot
// be stated as a number is not a limit.
//
// This implements express-rate-limit's Store interface directly against the
// ioredis connection the queue subsystem already owns, rather than adding a
// `rate-limit-redis` dependency. The interface is four small methods and the
// atomicity comes from Redis itself (INCR + PEXPIRE in one pipeline), so the
// dependency would buy nothing but supply-chain surface — and R11 is in the
// business of reducing that.
//
// When Redis is unavailable (REDIS_DISABLED — dev without REDIS_URL, or a
// production misconfiguration that the queue subsystem already reports loudly)
// this returns null and the caller falls back to the in-memory default.
// Degrading to per-instance counting is the right failure here: the alternative
// is refusing every request because a counter is unavailable, which turns a
// Redis blip into a total outage.
// ============================================================
import { bullConnection, REDIS_DISABLED } from '../queues/connection.js';
import { logger } from '../utils/logger.js';

const PREFIX = process.env.RATE_LIMIT_REDIS_PREFIX || 'lumi:rl:';

class RedisRateLimitStore {
  constructor(redis, prefix) {
    this.redis = redis;
    this.prefix = prefix;
    this.windowMs = 60_000;
    // Reported to express-rate-limit so it knows counters are shared.
    this.localKeys = false;
  }

  /** express-rate-limit calls this once with the limiter's resolved options. */
  init(options) {
    this.windowMs = options.windowMs;
  }

  key(key) {
    return `${this.prefix}${key}`;
  }

  async increment(key) {
    const redisKey = this.key(key);
    // INCR then PEXPIRE NX in one round trip: the expiry is set only when the
    // key is new, so a burst inside a window cannot keep pushing the window
    // out (which would turn a 30/min limit into "30 requests ever, eventually").
    const [[, totalHits], , [, pttl]] = await this.redis
      .multi()
      .incr(redisKey)
      .pexpire(redisKey, this.windowMs, 'NX')
      .pttl(redisKey)
      .exec();

    return {
      totalHits,
      resetTime: new Date(Date.now() + (pttl > 0 ? pttl : this.windowMs)),
    };
  }

  async decrement(key) {
    await this.redis.decr(this.key(key));
  }

  async resetKey(key) {
    await this.redis.del(this.key(key));
  }
}

/**
 * The shared store, or null when Redis is unavailable.
 * Built once — express-rate-limit requires a distinct store per limiter, so
 * each limiter gets its own instance over the same connection, namespaced by
 * the limiter's name so two limiters never share a counter.
 */
export function makeRateLimitStore(name) {
  // Unit tests exercise limiter SEMANTICS (does 6 requests trip a cap of 5),
  // not the store, and must not reach across the network to answer that. The
  // store's own behaviour is covered directly in rateLimitStore.test.js against
  // a fake client.
  if (process.env.NODE_ENV === 'test') return undefined;

  // REDIS_DISABLED is computed for prod and dev specifically, so requiring an
  // explicit REDIS_URL as well makes the condition read "Redis is actually
  // configured", which is the question being asked.
  if (REDIS_DISABLED || !bullConnection || !process.env.REDIS_URL) return undefined;
  try {
    return new RedisRateLimitStore(bullConnection, `${PREFIX}${name}:`);
  } catch (err) {
    logger.warn({ err: err.message, limiter: name }, '[rateLimit] Redis store unavailable — falling back to per-instance counting');
    return undefined;
  }
}

export { RedisRateLimitStore };
