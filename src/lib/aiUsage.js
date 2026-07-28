// ============================================================
// MARCOM / AI usage metering — the write side
// ------------------------------------------------------------
// One row per provider attempt-sequence through the gateway.
//
// BEST-EFFORT, exactly like recordAdminAction: never throws, never blocks a
// caller's response. A metering write that can fail a customer's copy
// generation is strictly worse than no metering write. The caller is expected
// NOT to await this — see ProviderGateway.
//
// The honesty rule this file enforces: a token count that the provider did not
// report is stored as NULL, never 0. `?? null` (not `|| null`) is load-bearing
// — a real, reported 0 must survive as 0, because "the provider billed us for
// zero output tokens" and "the provider told us nothing" are different facts
// and the cost view has to be able to tell them apart.
// ============================================================
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Record one AI provider attempt-sequence. Never throws.
 *
 * @param {object} entry
 * @param {string|null} [entry.workspaceId] null ⇒ unattributed (honest, not a placeholder)
 * @param {string} entry.capability
 * @param {string} entry.provider
 * @param {string|null} [entry.model]
 * @param {number|null} [entry.inputTokens] null ⇒ unreported
 * @param {number|null} [entry.outputTokens] null ⇒ unreported
 * @param {number|null} [entry.tokens]
 * @param {number|null} [entry.latencyMs]
 * @param {number|null} [entry.attempts]
 * @param {boolean} [entry.success]
 * @param {boolean} [entry.isFallback] cross-provider fallback ONLY, not a retry
 * @returns {Promise<boolean>} true when the row landed
 */
export async function recordAiUsage(entry = {}) {
  try {
    await prisma.aiUsageLog.create({
      data: {
        workspaceId: entry.workspaceId ?? null,
        capability: entry.capability,
        provider: entry.provider,
        model: entry.model ?? null,
        inputTokens: entry.inputTokens ?? null,
        outputTokens: entry.outputTokens ?? null,
        tokens: entry.tokens ?? null,
        latencyMs: entry.latencyMs ?? null,
        attempts: entry.attempts ?? null,
        success: entry.success ?? true,
        isFallback: entry.isFallback ?? false,
      },
    });
    return true;
  } catch (err) {
    logger.warn(
      { err: err?.message, capability: entry.capability, provider: entry.provider },
      '[aiUsage] usage NOT recorded',
    );
    return false;
  }
}

// How long a usage row is kept. 90 days covers a quarterly cost review.
const DEFAULT_MAX_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Read per call, not at module load: a module-scope read would freeze the value
// at import time (and could only be re-tested via vi.resetModules(), which
// segfaults this repo's forks pool). A junk or non-positive value falls back to
// the default rather than computing a cutoff in the future and deleting the
// whole table.
function maxAgeDays() {
  const n = Number(process.env.AIUSAGE_MAX_AGE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_DAYS;
}

/**
 * Delete usage rows older than AIUSAGE_MAX_AGE_DAYS.
 *
 * This table takes a row per AI call and is the highest-volume writer in the
 * system, so it needs a retention story rather than unbounded growth. Unlike
 * recordAiUsage this DOES surface its failure: it is invoked deliberately by an
 * operator or a scheduler, both of which need to know the sweep did not run.
 *
 * @returns {Promise<number>} rows deleted
 */
export async function cleanAiUsageLogs() {
  const days = maxAgeDays();
  const cutoff = new Date(Date.now() - days * DAY_MS);

  const { count } = await prisma.aiUsageLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  logger.info({ count, cutoff: cutoff.toISOString(), days }, '[aiUsage] retention sweep complete');
  return count;
}
