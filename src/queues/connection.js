// Importing this module never opens a socket or runs a Redis command.
// Queue activation must explicitly await verifyRedisReadiness(). This proves
// only the current Redis connection/policy, never permission to run a Worker.
import IORedis from 'ioredis';
import { logger } from '../utils/logger.js';

const rawUrl = process.env.REDIS_URL;
const isLocal = !rawUrl || /^redis:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/i.test(rawUrl);
export const REDIS_DISABLED = !rawUrl || (['production', 'development'].includes(process.env.NODE_ENV) && isLocal);
export const QUEUE_PREFIX = process.env.BULLMQ_PREFIX || 'lumi';
const READINESS_TIMEOUT_MS = 5000;
let probing = false;
let pending = null;

// lazyConnect is essential: middleware can retain this client reference without
// connecting during import. Do not construct a BullMQ Queue at module scope.
export const bullConnection = REDIS_DISABLED ? null : new IORedis(rawUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  connectTimeout: READINESS_TIMEOUT_MS,
  // Only an explicitly awaited probe may connect/retry. A reconnected socket
  // cannot silently reuse the eviction-policy observation from an old session.
  retryStrategy: times => probing && times <= 5 ? Math.min(times * 500, 3000) : null,
  reconnectOnError: () => false,
});

bullConnection?.on('error', () => {
  // Redis errors may contain connection URLs/authentication details.
  logger.warn({ code: 'REDIS_CONNECTION_ERROR' }, '[bullmq:redis] connection error');
});

function refusal(code) {
  return Object.assign(new Error(code), { code });
}

export function closeRedisConnection() {
  bullConnection?.disconnect();
}

export async function verifyRedisReadiness() {
  if (!bullConnection) throw refusal('REDIS_UNAVAILABLE');
  if (pending) return pending;
  const connection = bullConnection;
  let timer;
  let cancelled = false;
  probing = true;
  pending = (async () => {
    try {
      return await Promise.race([
        (async () => {
          if (connection.status !== 'ready') await connection.connect();
          if (cancelled) throw refusal('REDIS_READINESS_FAILED');
          const config = await connection.config('GET', 'maxmemory-policy');
          if (!Array.isArray(config) || config.length !== 2
            || config[0] !== 'maxmemory-policy' || config[1] !== 'noeviction') {
            throw refusal('REDIS_POLICY_UNQUALIFIED');
          }
          if (cancelled || connection.status !== 'ready') throw refusal('REDIS_READINESS_FAILED');
          return Object.freeze({ connection, evictionPolicy: 'noeviction', workerAdmission: 'NOT_QUALIFIED' });
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            cancelled = true;
            reject(refusal('REDIS_READINESS_FAILED'));
          }, READINESS_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      closeRedisConnection();
      throw refusal(err?.code === 'REDIS_POLICY_UNQUALIFIED' ? err.code : 'REDIS_READINESS_FAILED');
    } finally {
      clearTimeout(timer);
      probing = false;
    }
  })();
  try { return await pending; } finally { pending = null; }
}
