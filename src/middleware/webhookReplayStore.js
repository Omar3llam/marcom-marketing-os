// ============================================================
// Webhook replay store — single-use claim over signed material
// ============================================================
// The HMAC verifier proves a request was produced by someone holding the
// secret. It does not prove the request has not been seen before: the same
// bytes and the same timestamp verify every time they are presented, for as
// long as the timestamp stays inside the replay window. Closing that window is
// a separate control, and this is it.
//
//   claimOnce(key) === true   first time this exact signed material is seen
//   claimOnce(key) === false  a replay — the caller must not do the work again
//
// The key is a digest of the material the signature covered, so a replay is
// recognisable and an attacker cannot alter the key without breaking
// verification. Entries live exactly as long as the replay window: outside it,
// the timestamp check refuses the request anyway, so remembering it longer
// buys nothing and costs memory.
//
// STORE SELECTION, and the honest limit of the fallback.
// Redis when the queue subsystem already owns a connection (the same seam
// rateLimitStore.js uses, for the same reason — an added dependency would buy
// nothing but supply-chain surface). `SET key NX PX ttl` is the claim: atomic,
// and atomic across instances, which is what makes the control real on a
// scaled deployment.
//
// Without Redis this falls back to a per-process Map. That fallback is a
// genuinely weaker control: two instances behind a load balancer each hold
// their own memory, so a replay routed to a different instance is not caught.
// It is still strictly better than no claim at all, and refusing every webhook
// because Redis is unavailable would turn a cache blip into a total outage —
// the same trade rateLimitStore.js documents. The degradation is logged once so
// it is visible rather than assumed.
// ============================================================
import { bullConnection, REDIS_DISABLED } from '../queues/connection.js';
import { logger } from '../utils/logger.js';

const PREFIX = process.env.WEBHOOK_REPLAY_REDIS_PREFIX || 'lumi:wh:';

// ── In-process fallback ──────────────────────────────────────
const seen = new Map(); // key -> expiresAt (ms)
let warnedNoRedis = false;

function sweep(now) {
  for (const [k, expiresAt] of seen) {
    if (expiresAt <= now) seen.delete(k);
  }
}

// Sweeping the whole map on every claim made the per-key expiry check below
// dead code — a mutation that deleted it changed nothing, which is how you find
// out a guard is not load-bearing. Now the per-key check is the expiry
// authority on every call, and the sweep does only the job its name implies:
// bounding memory, amortised, when the map has actually grown.
const SWEEP_THRESHOLD = 1_000;

function claimInMemory(key, ttlMs) {
  const now = Date.now();
  const existing = seen.get(key);
  if (existing !== undefined && existing > now) return false;
  if (seen.size >= SWEEP_THRESHOLD) sweep(now);
  seen.set(key, now + ttlMs);
  return true;
}

function redis() {
  if (REDIS_DISABLED || !bullConnection || !process.env.REDIS_URL) return null;
  return bullConnection;
}

/**
 * Claim this signed material once. Returns true the first time, false for a
 * replay inside the window.
 *
 * A Redis failure falls back to the in-process claim rather than refusing: the
 * request has already been authenticated, and the alternative is an outage.
 *
 * @param {string} key   digest of the signed material
 * @param {number} ttlMs how long a replay stays recognisable
 */
export async function claimOnce(key, ttlMs) {
  const conn = redis();
  if (!conn) {
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      logger.warn('[webhook-replay] no shared store — replay protection is per-instance only');
    }
    return claimInMemory(key, ttlMs);
  }
  try {
    const ok = await conn.set(`${PREFIX}${key}`, '1', 'PX', ttlMs, 'NX');
    return ok === 'OK';
  } catch (err) {
    logger.warn({ err: err.message }, '[webhook-replay] shared store unavailable — falling back to per-instance claim');
    return claimInMemory(key, ttlMs);
  }
}

/** Test seam: forget every claim and the one-time degradation warning. */
export function _resetReplayStore() {
  seen.clear();
  warnedNoRedis = false;
}
