// ============================================================
// Worker Heartbeat — Invariant V-3
// ============================================================
// Each worker emits a heartbeat every HEARTBEAT_INTERVAL_MS.
// Heartbeats are Redis keys with a TTL = 3× the interval.
// If the key expires the worker is considered dead.
//
// vitals.js calls getWorkerHeartbeats() to surface live worker
// count. Workers call startHeartbeat() on startup.
//
// Degrades gracefully when Redis is unavailable (returns empty
// list / no-op emitter) — queue-disabled environments still
// boot without error.
// ============================================================

import { bullConnection } from '../../queues/connection.js';
import { logger }         from '../../utils/logger.js';

const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 15_000);
// TTL long enough to survive 3 missed beats before the key expires.
const HEARTBEAT_TTL_S = Math.ceil((HEARTBEAT_INTERVAL_MS * 3) / 1_000);
const KEY_PREFIX = 'lumi:worker:heartbeat:';

/**
 * Start emitting heartbeats for this worker process.
 * Returns a { workerId, stop } handle.
 * Workers must call stop() on SIGTERM / worker.close().
 */
export function startHeartbeat(workerId = String(process.pid)) {
  if (!bullConnection) {
    // Redis disabled — heartbeat is a no-op.
    return { workerId, stop: () => {} };
  }

  const key = `${KEY_PREFIX}${workerId}`;

  async function beat() {
    try {
      await bullConnection.set(key, String(Date.now()), 'EX', HEARTBEAT_TTL_S);
    } catch (err) {
      logger.warn({ workerId, err: err.message }, '[workerHealth] heartbeat write failed');
    }
  }

  beat(); // emit immediately so vitals see the worker right away
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);

  return {
    workerId,
    stop() {
      clearInterval(timer);
      // Delete the key so vitals stop showing the worker immediately.
      bullConnection.del(key).catch(() => {});
    },
  };
}

/**
 * Return all live worker heartbeat entries.
 * Used by vitals to show activeWorkerCount.
 *
 * @returns {Promise<Array<{ workerId: string, lastBeatAt: string, aliveMs: number }>>}
 */
export async function getWorkerHeartbeats() {
  if (!bullConnection) return [];

  try {
    const keys = await bullConnection.keys(`${KEY_PREFIX}*`);
    if (keys.length === 0) return [];

    const values = await bullConnection.mget(...keys);
    const now = Date.now();

    return keys.map((key, i) => {
      const ts = values[i] ? Number(values[i]) : null;
      return {
        workerId:   key.slice(KEY_PREFIX.length),
        lastBeatAt: ts ? new Date(ts).toISOString() : null,
        aliveMs:    ts ? now - ts : null,
      };
    });
  } catch (err) {
    logger.warn({ err: err.message }, '[workerHealth] failed to read heartbeats');
    return [];
  }
}
