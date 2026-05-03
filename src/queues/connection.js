// ============================================================
// MARCOM / Lumi — Shared Redis connection for BullMQ
// ------------------------------------------------------------
// Resilience policy:
//   - In production, refuse to fall back to localhost. If
//     REDIS_URL is missing or points at localhost, mark the
//     queue subsystem DISABLED and export a sentinel `null`
//     connection. Routes that need Redis return a 503 instead
//     of letting BullMQ spam reconnect errors every 2 s.
//   - In development, fall back to localhost (the historical
//     behaviour) so `npm run dev` still works without a
//     dedicated Redis container.
//   - Always cap reconnect attempts at 5 so a misconfig can't
//     fill the log stream.
// ============================================================
import IORedis  from 'ioredis';
import { logger } from '../utils/logger.js';

const isProd  = process.env.NODE_ENV === 'production';
const rawUrl  = process.env.REDIS_URL;
const isLocal = !rawUrl || /^redis:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/i.test(rawUrl);

export const REDIS_DISABLED = isProd && isLocal;
export const QUEUE_PREFIX   = process.env.BULLMQ_PREFIX || 'lumi';

let _conn = null;

if (REDIS_DISABLED) {
  logger.warn(
    { reason: rawUrl ? 'REDIS_URL points at localhost' : 'REDIS_URL not set' },
    '[bullmq:redis] DISABLED — queue-dependent routes will return 503 until a real REDIS_URL is configured',
  );
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
}

export const bullConnection = _conn;
