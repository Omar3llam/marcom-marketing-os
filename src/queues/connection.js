// ============================================================
// MARCOM / Lumi — Shared Redis connection for BullMQ
// ------------------------------------------------------------
// Resilience policy:
//   - In production, refuse to fall back to localhost. If
//     REDIS_URL is missing or points at localhost, mark the
//     queue subsystem DISABLED and export a sentinel `null`
//     connection. Routes that need Redis return a 503 instead
//     of letting BullMQ spam reconnect errors every 2 s.
//   - In development, ALSO disable Redis if not explicitly
//     configured. This allows Phase 1 AI/Meta endpoints to
//     work without spamming ECONNREFUSED errors. Devs can
//     set REDIS_URL to enable queues when needed.
//   - Always cap reconnect attempts at 5 so a misconfig can't
//     fill the log stream.
// ============================================================
import IORedis  from 'ioredis';
import { logger } from '../utils/logger.js';

const isProd  = process.env.NODE_ENV === 'production';
const isDev   = process.env.NODE_ENV === 'development';
const rawUrl  = process.env.REDIS_URL;
const isLocal = !rawUrl || /^redis:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/i.test(rawUrl);

// Disable Redis if:
// 1. Production + no valid REDIS_URL
// 2. Development + no REDIS_URL set (graceful degradation for AI-only mode)
export const REDIS_DISABLED = (isProd && isLocal) || (isDev && !rawUrl);
export const QUEUE_PREFIX   = process.env.BULLMQ_PREFIX || 'lumi';

let _conn = null;

if (REDIS_DISABLED) {
  if (isDev) {
    logger.info(
      '[DEV MODE] Redis/BullMQ bypassed. Running in stateless AI mode (queue-dependent routes will skip writes).',
    );
  } else {
    logger.warn(
      { reason: rawUrl ? 'REDIS_URL points at localhost' : 'REDIS_URL not set' },
      '[bullmq:redis] DISABLED — queue-dependent routes will return 503 until a real REDIS_URL is configured',
    );
  }
} else {
  const url = rawUrl || 'redis://localhost:6379';
  _conn = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
    lazyConnect:          true,
    // Cap reconnect attempts so a misconfigured prod can't spam
    // the log stream every 2s. After 5 fails, give up.
    retryStrategy: (times) => {
      if (times > 5) {
        logger.warn({ attempts: times }, '[bullmq:redis] giving up on reconnect — set a valid REDIS_URL');
        return null;   // stop retrying
      }
      return Math.min(times * 500, 3000);
    },
    reconnectOnError: () => false,
  });

  // De-duplicate identical errors — one warning per error code
  // is plenty; we don't need 30 lines of the same ECONNREFUSED.
  let _lastErrCode = null;
  _conn.on('error', (err) => {
    const code = err?.code || err?.message;
    if (code === _lastErrCode) return;
    _lastErrCode = code;
    logger.warn({ code, msg: err?.message }, '[bullmq:redis] error');
  });

  // ── PRODUCTION SAFETY: Validate Redis eviction policy ─────────
  // BullMQ stores job queue data in Redis. If the eviction policy
  // is NOT 'noeviction', Redis will silently delete job data under
  // memory pressure, causing jobs to disappear without any error.
  //
  // REQUIRED POLICY: noeviction
  // DANGEROUS POLICIES: allkeys-lru, allkeys-lfu, volatile-lru, etc.
  //
  // On Render.com, configure via Dashboard → Redis → Advanced → maxmemory-policy
  (async () => {
    try {
      await _conn.connect();
      const config = await _conn.config('GET', 'maxmemory-policy');
      const policy = config?.[1]; // ['maxmemory-policy', 'allkeys-lru']

      if (policy !== 'noeviction') {
        logger.error(
          {
            current_policy: policy,
            required_policy: 'noeviction',
            impact: 'BullMQ job data can be silently evicted under memory pressure',
            fix: 'Set maxmemory-policy=noeviction in Redis config',
          },
          '❌ [bullmq:redis] DANGEROUS EVICTION POLICY DETECTED',
        );

        if (isProd) {
          logger.fatal(
            '[bullmq:redis] FATAL: Production Redis has wrong eviction policy. Jobs will be lost.',
          );
          // In strict mode, exit immediately to prevent silent job loss
          // Uncomment the line below to enforce hard failure:
          // process.exit(1);
        }
      } else {
        logger.info({ policy }, '[bullmq:redis] eviction policy validated ✓');
      }
    } catch (err) {
      logger.warn(
        { err: err.message },
        '[bullmq:redis] Could not validate eviction policy (connection may not be ready yet)',
      );
    }
  })();
}

export const bullConnection = _conn;
