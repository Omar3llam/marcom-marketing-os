// ============================================================
// TestTrackerService — experiment lifecycle + loop closure
// ============================================================
// Owns all DB I/O and the live Meta read. The deterministic
// testReadoutEngine never touches either.
//
//   startTest():           PROPOSED → RUNNING
//   recordVariantMetrics(): batched variant updates (no N+1 loop write)
//   refreshFromMeta():      best-effort per-variant Insights pull
//   concludeTest():         THE LOOP — read winner honestly, then in ONE
//                           transaction: mark CONCLUDED, write a
//                           first-class DecisionMemoryEntry, and (only
//                           when the winner is confident AND the verdict
//                           is governance-valid at this level) emit a
//                           PROPOSED REFRESH/SCALE Decision that rides
//                           the existing confirm→execute path.
//
// Live Meta read is ENRICHMENT, never a hard dependency: a missing
// integration/token degrades to the variant counts already on the rows.
// ============================================================
import axios from 'axios';
import { prisma }      from '../../lib/prisma.js';
import { logger }      from '../../utils/logger.js';
import { toMinor }     from '../../lib/money.js';
import { readTest }    from '../test-readout/testReadoutEngine.js';
import { CONFIDENCE_LABEL } from '../test-readout/testReadoutTypes.js';
import { verdictToActionType } from '../verdict-engine/verdictTypes.js';
import { validateActionTarget } from '../metaExecutionService.js';

const GRAPH_BASE = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v21.0'}`;
const TEST_ROOT_PREFIX = 'test:';

// EntityLevel → the lowercase target type validateActionTarget expects.
// ACCOUNT is treated as campaign (mirrors verdictToActionType).
const LEVEL_TO_TARGET = Object.freeze({
  ACCOUNT: 'campaign', CAMPAIGN: 'campaign', ADSET: 'adset', AD: 'ad', CREATIVE: 'creative',
});

/**
 * Transition a test experiment to RUNNING and record its start time.
 *
 * @param {string} testId - The ID of the test experiment to start.
 * @returns {object} The updated test experiment record.
 * @throws {Error} If `testId` is not provided.
 */
export async function startTest(testId) {
  if (!testId) throw new Error('startTest: testId required');
  return prisma.testExperiment.update({
    where: { id: testId },
    data:  { status: 'RUNNING', startedAt: new Date() },
  });
}

/**
 * Apply batched updates to test variants' performance metrics.
 *
 * Performs a single atomic transaction that updates only the numeric fields
 * provided for each variant (impressions, clicks, conversions, spendMinor,
 * revenueMinor).
 *
 * @param {string} testId - ID of the test experiment to which variants belong.
 * @param {Array<{variantId: string, impressions?: number, clicks?: number, conversions?: number, spendMinor?: number, revenueMinor?: number}>} rows - Update rows; entries without `variantId` are ignored.
 * @returns {{updated: number}} Object with `updated` equal to the number of update operations executed (0 when no ops).
 * @throws {Error} If `testId` is falsy.
 */
export async function recordVariantMetrics(testId, rows = []) {
  if (!testId) throw new Error('recordVariantMetrics: testId required');
  const ops = rows
    .filter((r) => r && r.variantId)
    .map((r) => prisma.testVariant.update({
      where: { id: r.variantId },
      data: {
        ...(r.impressions  != null && { impressions:  r.impressions }),
        ...(r.clicks       != null && { clicks:       r.clicks }),
        ...(r.conversions  != null && { conversions:  r.conversions }),
        ...(r.spendMinor   != null && { spendMinor:   r.spendMinor }),
        ...(r.revenueMinor != null && { revenueMinor: r.revenueMinor }),
      },
    }));
  if (ops.length === 0) return { updated: 0 };
  await prisma.$transaction(ops);
  return { updated: ops.length };
}

/**
 * Normalize a Meta insights row into integer counts and monetary values in minor units.
 *
 * Handles an optional `_data` wrapper on the insight object. When `purchase_roas` is an array,
 * selects the entry with `action_type === 'omni_purchase'` if present; otherwise uses the first entry.
 *
 * @param {object} insight - Meta insights row containing fields like `impressions`, `clicks`, `conversions`, `spend`, and `purchase_roas`.
 * @param {string} currency - ISO currency code used to convert spend and revenue to minor units.
 * @returns {{impressions: number, clicks: number, conversions: number, spendMinor: number, revenueMinor: number}}
 */
export function parseVariantInsights(insight, currency) {
  const d = insight?._data || insight || {};
  const impressions = parseInt(d.impressions || '0', 10);
  const clicks      = parseInt(d.clicks || '0', 10);
  const conversions = parseInt(d.conversions || '0', 10);
  const spend       = parseFloat(d.spend || '0');

  let roas = 0;
  if (Array.isArray(d.purchase_roas)) {
    const row = d.purchase_roas.find((r) => r.action_type === 'omni_purchase') || d.purchase_roas[0];
    roas = row ? parseFloat(row.value) : 0;
  } else if (d.purchase_roas != null) {
    roas = parseFloat(d.purchase_roas);
  }
  const revenue = roas > 0 && spend > 0 ? roas * spend : 0;

  return {
    impressions,
    clicks,
    conversions,
    spendMinor:   toMinor(spend, currency),
    revenueMinor: toMinor(revenue, currency),
  };
}

/**
 * Best-effort: refresh each variant's counts from Meta Insights.
 * Resolves the workspace's META Integration token (the canonical
 * resolver) and pulls per-variant insights. Never throws to the caller
 * — a missing token or a per-variant API error is logged and skipped.
 *
 * @returns {Promise<{refreshed:number, skipped:number, reason?:string}>}
 */
export async function refreshFromMeta(testId) {
  const test = await prisma.testExperiment.findUnique({
    where: { id: testId }, include: { variants: true },
  });
  if (!test) throw new Error(`refreshFromMeta: test ${testId} not found`);

  let integration;
  try {
    integration = await prisma.integration.findUnique({
      where: { workspaceId_platform: { workspaceId: test.workspaceId, platform: 'META' } },
    });
  } catch { integration = null; }

  if (!integration || !integration.isActive || !integration.accessToken) {
    logger.debug({ testId }, '[TestTrackerService] no active META integration — using stored counts');
    return { refreshed: 0, skipped: test.variants.length, reason: 'no_integration' };
  }
  const token = integration.accessToken;

  const updates = [];
  let skipped = 0;
  for (const v of test.variants) {
    if (!v.metaEntityId) { skipped++; continue; }
    try {
      const fields = 'impressions,clicks,spend,conversions,purchase_roas';
      const url = `${GRAPH_BASE}/${v.metaEntityId}/insights?fields=${fields}&access_token=${token}`;
      const res = await axios.get(url, { timeout: 10_000 });
      const row = res.data?.data?.[0];
      if (!row) { skipped++; continue; }
      updates.push({ variantId: v.id, ...parseVariantInsights(row, test.currency) });
    } catch (err) {
      skipped++;
      logger.warn({ testId, variantId: v.id, err: err.message }, '[TestTrackerService] variant insight fetch failed');
    }
  }

  if (updates.length > 0) await recordVariantMetrics(testId, updates);
  logger.info({ testId, refreshed: updates.length, skipped }, '[TestTrackerService] refreshed from Meta');
  return { refreshed: updates.length, skipped };
}

/**
 * Map a readout verdict to a governance-valid action for the given entity level.
 *
 * Attempts to resolve the provided `readoutVerdict` to an `actionType` that
 * passes target validation for `entityLevel`. If the original verdict is not
 * valid, a fallback between `SCALE` and `REFRESH` is attempted. If no valid
 * mapping exists, returns nulls to indicate no auto-action should be persisted.
 *
 * @param {string|null|undefined} readoutVerdict - Verdict produced by the readout (e.g., `'SCALE'`, `'REFRESH'`).
 * @param {string} entityLevel - Entity level of the test used to derive the target for validation.
 * @returns {{ verdict: string|null, actionType: string|null }} `verdict` and `actionType` to persist; `null` values indicate no governance-valid auto-action.
 */
export function resolveVerdict(readoutVerdict, entityLevel) {
  if (!readoutVerdict) return { verdict: null, actionType: null };
  const target = LEVEL_TO_TARGET[entityLevel];
  if (!target) return { verdict: null, actionType: null };

  const tryVerdict = (verdict) => {
    const actionType = verdictToActionType(verdict, entityLevel);
    return actionType && validateActionTarget(actionType, target) ? { verdict, actionType } : null;
  };

  return (
    tryVerdict(readoutVerdict) ||
    tryVerdict(readoutVerdict === 'SCALE' ? 'REFRESH' : 'SCALE') ||
    { verdict: null, actionType: null }
  );
}

/**
 * Finalizes a test: optionally refreshes live variant metrics, performs the readout, and persists the outcome and memory; creates a PROPOSED decision when a governance-valid verdict is resolved.
 *
 * @param {string} testId - The testExperiment id to conclude.
 * @param {Object} [options]
 * @param {boolean} [options.refresh=true] - If true, attempts a best-effort refresh of variant metrics from Meta before computing the readout.
 * @returns {Promise<{ readout: Object, memoryId: string|null, decisionId: string|null, verdict: string|null, actionType: string|null }>} An object containing the readout produced by the readTest engine, the created decisionMemoryEntry id, the created decision id (if any), and the resolved verdict and actionType (or `null` when not applicable).
 * @throws {Error} If `testId` is falsy (message: "concludeTest: testId required").
 * @throws {Error} If the test is not found (message: "concludeTest: test <id> not found").
 * @throws {Error} If the test has fewer than 2 variants (message: "concludeTest: test <id> needs ≥2 variants").
 */
export async function concludeTest(testId, { refresh = true } = {}) {
  if (!testId) throw new Error('concludeTest: testId required');

  if (refresh) {
    try { await refreshFromMeta(testId); }
    catch (err) { logger.debug({ testId, err: err.message }, '[TestTrackerService] refresh skipped'); }
  }

  const test = await prisma.testExperiment.findUnique({
    where: { id: testId }, include: { variants: true },
  });
  if (!test) throw new Error(`concludeTest: test ${testId} not found`);
  if (test.variants.length < 2) throw new Error(`concludeTest: test ${testId} needs ≥2 variants`);

  const readout = readTest({
    metric:   test.metric,
    variants: test.variants.map((v) => ({
      variantId:   v.id,
      label:       v.label,
      isControl:   v.isControl,
      impressions: v.impressions,
      clicks:      v.clicks,
      conversions: v.conversions,
      spendMinor:  v.spendMinor,
      revenueMinor: v.revenueMinor,
    })),
  });

  // Verdict only when confident AND governance-valid at this level AND we
  // have a concrete entity to target.
  const confident = readout.confidenceLabel === CONFIDENCE_LABEL.HIGH
                  || readout.confidenceLabel === CONFIDENCE_LABEL.MODERATE;
  const resolved  = confident && test.entityId
    ? resolveVerdict(readout.verdict, test.entityLevel)
    : { verdict: null, actionType: null };

  const sustainable = confident ? true : null;
  const rationale   = readout.rationale;

  const result = await prisma.$transaction(async (tx) => {
    let decisionId = null;
    if (resolved.verdict && test.entityId) {
      const decision = await tx.decision.create({
        data: {
          workspaceId: test.workspaceId,
          entityId:    test.entityId,
          entityLevel: test.entityLevel,
          verdict:     resolved.verdict,
          confidence:  readout.confidence,
          diagnosis:   rationale,
          rootCause:   `${TEST_ROOT_PREFIX}${test.id}`,
          status:      'PROPOSED',
        },
      });
      decisionId = decision.id;
    }

    await tx.testExperiment.update({
      where: { id: test.id },
      data: {
        status:          'CONCLUDED',
        concludedAt:     new Date(),
        winnerLabel:     readout.winnerLabel,
        lift:            readout.lift,
        confidence:      readout.confidence,
        confidenceLabel: readout.confidenceLabel,
        sampleNote:      readout.sampleNote,
        decisionId,
      },
    });

    if (readout.winnerVariantId) {
      await tx.testVariant.update({ where: { id: readout.winnerVariantId }, data: { isWinner: true } });
    }

    const memory = await tx.decisionMemoryEntry.create({
      data: {
        workspaceId:   test.workspaceId,
        decisionId,
        entityId:      test.entityId,
        actionType:    `${TEST_ROOT_PREFIX}${test.dimension}`,
        rationale,
        isSustainable: sustainable,
      },
    });

    return { decisionId, memoryId: memory.id };
  });

  logger.info(
    { testId, winner: readout.winnerLabel, verdict: resolved.verdict, decisionId: result.decisionId },
    '[TestTrackerService] test concluded — loop closed',
  );
  return {
    readout,
    memoryId:   result.memoryId,
    decisionId: result.decisionId,
    verdict:    resolved.verdict,
    actionType: resolved.actionType,
  };
}
