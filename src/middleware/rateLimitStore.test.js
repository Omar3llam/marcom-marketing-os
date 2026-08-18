// ============================================================
// R11-E — the shared rate-limit store  (E2)
// ------------------------------------------------------------
// express-rate-limit defaults to per-process memory, so on N Render instances
// the effective ceiling was N times the configured limit and every deploy reset
// it. A limit that cannot be stated as a number is not a limit.
//
// Exercised against a fake client: the point is the Redis command sequence and
// the window arithmetic, neither of which needs a real server.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../queues/connection.js', () => ({ bullConnection: null, REDIS_DISABLED: true }));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { RedisRateLimitStore, makeRateLimitStore } from './rateLimitStore.js';

/** Minimal ioredis double covering the multi() pipeline the store uses. */
function fakeRedis() {
  const keys = new Map();          // key -> { count, expiresAt }
  const calls = [];
  const api = {
    keys,
    calls,
    multi() {
      const ops = [];
      const chain = {
        incr(k) { ops.push(['incr', k]); return chain; },
        pexpire(k, ms, mode) { ops.push(['pexpire', k, ms, mode]); return chain; },
        pttl(k) { ops.push(['pttl', k]); return chain; },
        async exec() {
          const out = [];
          for (const [op, k, ms, mode] of ops) {
            calls.push(op);
            if (op === 'incr') {
              const cur = keys.get(k) ?? { count: 0, expiresAt: null };
              cur.count += 1;
              keys.set(k, cur);
              out.push([null, cur.count]);
            } else if (op === 'pexpire') {
              const cur = keys.get(k);
              // NX: set the expiry only when there is not one already.
              if (cur && !(mode === 'NX' && cur.expiresAt !== null)) {
                cur.expiresAt = Date.now() + ms;
              }
              out.push([null, 1]);
            } else {
              const cur = keys.get(k);
              out.push([null, cur?.expiresAt ? cur.expiresAt - Date.now() : -1]);
            }
          }
          return out;
        },
      };
      return chain;
    },
    async decr(k) { const cur = keys.get(k); if (cur) cur.count -= 1; },
    async del(k) { keys.delete(k); },
  };
  return api;
}

let redis;
let store;
beforeEach(() => {
  redis = fakeRedis();
  store = new RedisRateLimitStore(redis, 'test:');
  store.init({ windowMs: 60_000 });
});

describe('RedisRateLimitStore', () => {
  it('counts hits across calls — the counter is shared, not per-process', async () => {
    expect((await store.increment('k')).totalHits).toBe(1);
    expect((await store.increment('k')).totalHits).toBe(2);
    expect((await store.increment('k')).totalHits).toBe(3);
  });

  it('keeps separate keys separate', async () => {
    await store.increment('a');
    await store.increment('a');
    expect((await store.increment('b')).totalHits).toBe(1);
  });

  it('sets the expiry ONLY when the key is new', async () => {
    // NX matters: re-arming the TTL on every hit would turn a 30/min cap into
    // "30 requests ever, as long as you keep knocking".
    await store.increment('k');
    const firstExpiry = redis.keys.get('test:k').expiresAt;

    await new Promise((r) => setTimeout(r, 5));
    await store.increment('k');

    expect(redis.keys.get('test:k').expiresAt).toBe(firstExpiry);
  });

  it('reports a resetTime inside the window', async () => {
    const { resetTime } = await store.increment('k');
    expect(resetTime.getTime()).toBeGreaterThan(Date.now());
    expect(resetTime.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('supports decrement and resetKey', async () => {
    await store.increment('k');
    await store.increment('k');
    await store.decrement('k');
    expect(redis.keys.get('test:k').count).toBe(1);

    await store.resetKey('k');
    expect(redis.keys.has('test:k')).toBe(false);
  });

  it('advertises that its counters are shared', () => {
    // express-rate-limit reads this to know the count is not process-local.
    expect(store.localKeys).toBe(false);
  });
});

describe('makeRateLimitStore degrades rather than failing closed', () => {
  it('returns undefined when Redis is unavailable, so the limiter falls back to memory', () => {
    // Per-instance counting is the right failure here: refusing every request
    // because a counter is unreachable turns a Redis blip into a total outage.
    expect(makeRateLimitStore('api')).toBeUndefined();
  });
});
