// ============================================================
// MARCOM / Lumi — Shared Redis connection for BullMQ
// ------------------------------------------------------------
// BullMQ requires `maxRetriesPerRequest: null` and
// `enableReadyCheck: false` on the ioredis client used by
// Worker / QueueScheduler — otherwise long-polling blocks fail.
// ============================================================
import IORedis  from 'ioredis';
import { logger } from '../utils/logger.js';

const url = process.env.REDIS_URL || 'redis://localhost:6379';

export const bullConnection = new IORedis(url, {
  maxRetriesPerRequest: null,
  enableReadyCheck:     false,
  lazyConnect:          true,
});

bullConnection.on('error', (err) => {
  logger.warn({ err: err.message }, '[bullmq:redis] error');
});

export const QUEUE_PREFIX = process.env.BULLMQ_PREFIX || 'lumi';
