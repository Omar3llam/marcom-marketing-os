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
import { resolveCredential } from '../connectors/credentialStore.js';
import { designTest } from '../incrementality-engine/IncrementalityService.js';

const GRAPH_BASE = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v21.0'}`;
const TEST_ROOT_PREFIX = 'test:';
const HOLDOUT_DEFAULT_CHANNEL = 'META'; // the only live-connected channel today

// EntityLevel → the lowercase target type validateActionTarget expects.
// ACCOUNT is treated as campaign (mirrors verdictToActionType).
const LEVEL_TO_TARGET = Object.freeze({
  ACCOUNT: 'campaign', CAMPAIGN: 'campaign', ADSET: 'adset', AD: 'ad', CREATIVE: 'creative',
});

/** PROPOSED → RUNNING. Workspace-scoped: a test outside `workspaceId` is invisible. */
export async function startTest(workspaceId, testId) {
  if (!workspaceId) throw new Error('startTest: workspaceId required');
  if (!testId) throw new Error('startTest: testId required');
  // Authorize first — `update({where:{id}})` alone would mutate across workspaces.
  const existing = await prisma.testExperiment.findFirst({
    where: { id: testId, workspaceId }, select: { id: true },
  });
  if (!existing) throw new Error('startTest: test not found');
  return prisma.testExperiment.update({
    where: { id: testId },
    data:  { status: 'RUNNING', startedAt: new Date() },
  });
}

/**
 * Record per-variant performance counts. Batched as a single
 * $transaction over an array of updates — no `await` inside a loop,
 * so arch-check's no-N+1 rule is satisfied.
 *
 * Workspace-scoped: the test must belong to `workspaceId`, and only variants
 * that actually belong to that test are written — a forged variantId from
 * another workspace is dropped, never updated.
 *
 * @param {string} workspaceId
 * @param {string} testId
 * @param {Array<{variantId, impressions?, clicks?, conversions?, spendMinor?, revenueMinor?}>} rows
 */
export async function recordVariantMetrics(workspaceId, testId, rows = []) {
  if (!workspaceId) throw new Error('recordVariantMetrics: workspaceId required');
  if (!testId) throw new Error('recordVariantMetrics: testId required');
  const test = await prisma.testExperiment.findFirst({
    where: { id: testId, workspaceId },
    select: { id: true, variants: { select: { id: true } } },
  });
  if (!test) throw new Error('recordVariantMetrics: test not found');
  const ownVariantIds = new Set(test.variants.map((v) => v.id));
  const ops = rows
    .filter((r) => r && r.variantId && ownVariantIds.has(r.variantId))
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
 * Pure: normalize a raw Meta /insights row into variant counts in
 * minor units. Exported for unit testing without a network call.
 *
 * @param {object} insight — Meta insights row (impressions, clicks, spend, conversions, purchase_roas)
 * @param {string} currency
 * @returns {{impressions, clicks, conversions, spendMinor, revenueMinor}}
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
 * Resolves the workspace's META credential via resolveCredential (the
 * OAuth-authoritative marcom_credentials store) and pulls per-variant
 * insights. Never throws to the caller — a missing token or a per-variant
 * API error is logged and skipped.
 *
 * @param {string} workspaceId
 * @param {string} testId
 * @returns {Promise<{refreshed:number, skipped:number, reason?:string}>}
 */
export async function refreshFromMeta(workspaceId, testId) {
  if (!workspaceId) throw new Error('refreshFromMeta: workspaceId required');
  if (!testId) throw new Error('refreshFromMeta: testId required');
  const test = await prisma.testExperiment.findFirst({
    where: { id: testId, workspaceId }, include: { variants: true },
  });
  if (!test) throw new Error(`refreshFromMeta: test ${testId} not found`);

  let cred;
  try {
    cred = await resolveCredential(test.workspaceId, 'META');
  } catch { cred = null; }

  if (!cred || !cred.accessToken) {
    logger.debug({ testId }, '[TestTrackerService] no active META credential — using stored counts');
    return { refreshed: 0, skipped: test.variants.length, reason: 'no_integration' };
  }
  const token = cred.accessToken;

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

  if (updates.length > 0) await recordVariantMetrics(workspaceId, testId, updates);
  logger.info({ testId, refreshed: updates.length, skipped }, '[TestTrackerService] refreshed from Meta');
  return { refreshed: updates.length, skipped };
}

/**
 * Pure: reconcile the readout's verdict with what is governance-valid
 * at the test's entity level. Returns the verdict+actionType to persist,
 * or { verdict:null } when no valid auto-action fits (memory-only).
 * Exported for unit testing.
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
 * Conclude a test — THE LOOP. Best-effort live refresh, honest readout,
 * then one transaction that writes the outcome to memory and (when
 * warranted + valid) emits a PROPOSED verdict Decision.
 *
 * @returns {Promise<{ readout, memoryId, decisionId, verdict, actionType }>}
 */
export async function concludeTest(workspaceId, testId, { refresh = true } = {}) {
  if (!workspaceId) throw new Error('concludeTest: workspaceId required');
  if (!testId) throw new Error('concludeTest: testId required');

  if (refresh) {
    try { await refreshFromMeta(workspaceId, testId); }
    catch (err) { logger.debug({ testId, err: err.message }, '[TestTrackerService] refresh skipped'); }
  }

  const test = await prisma.testExperiment.findFirst({
    where: { id: testId, workspaceId }, include: { variants: true },
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

/**
 * The Phase-7C bridge: promote a CONCLUDED A/B test into a DESIGNED holdout
 * (incrementality test). An A/B test measures a *correlational* winner; a
 * holdout measures *causal* incremental lift. The concluded test supplies what
 * it actually knows — a measured baseline conversion rate (from its control
 * arm) + the entity binding — while the operator supplies the power-calc input
 * the A/B test can't (dailyEligible), with mde seeded from the observed lift.
 *
 * designTest() is the canonical creator and is called AS-IS — it has no source
 * link, so we stamp sourceTestId in a follow-up update (the traceability FK)
 * rather than touching the incrementality engine.
 *
 * @param {string} workspaceId
 * @param {string} testId — a CONCLUDED TestExperiment in this workspace
 * @param {{ dailyEligible:number, mde?:number, channel?:string }} opts
 * @returns {Promise<object>} the created DESIGNED IncrementalityTest (with .design + .sourceTestId)
 */
export async function promoteTestToHoldout(workspaceId, testId, { dailyEligible, mde, channel } = {}) {
  if (!workspaceId) throw new Error('promoteTestToHoldout: workspaceId required');
  if (!testId) throw new Error('promoteTestToHoldout: testId required');

  const test = await prisma.testExperiment.findFirst({
    where:   { id: testId, workspaceId },
    include: { variants: true },
  });
  if (!test) throw new Error('promoteTestToHoldout: test not found');
  if (test.status !== 'CONCLUDED') {
    throw new Error('promoteTestToHoldout: test is not CONCLUDED — only a concluded test can seed a holdout');
  }

  // baselineCvr is DERIVED from the control arm — never operator-entered. A
  // holdout designed off a fabricated baseline would mis-size the experiment.
  const control = test.variants.find((v) => v.isControl);
  if (!control) throw new Error('promoteTestToHoldout: test has no control variant — cannot derive baseline conversion rate');
  if (!(control.clicks > 0)) throw new Error('promoteTestToHoldout: control arm has zero clicks — cannot derive baseline conversion rate');
  const baselineCvr = control.conversions / control.clicks;

  // mde: operator value wins; else seed from the test's observed lift (stored as
  // a PERCENT on the row, 0–100) → fraction, clamped to (0,1); else neutral 0.1.
  // The route already range-validates an operator-supplied mde.
  const seededMde   = test.lift > 0 ? Math.min(test.lift / 100, 0.99) : null;
  const resolvedMde = (typeof mde === 'number' && mde > 0 && mde < 1) ? mde : (seededMde ?? 0.1);

  // channel is NOT on a TestExperiment → default to the only live channel.
  const resolvedChannel = (typeof channel === 'string' && channel.trim()) ? channel.trim() : HOLDOUT_DEFAULT_CHANNEL;

  const holdout = await designTest(workspaceId, {
    name:        `Holdout from ${test.dimension} test`,
    channel:     resolvedChannel,
    entityId:    test.entityId,
    entityLevel: test.entityLevel,
    baselineCvr,
    mde:         resolvedMde,
    dailyEligible,
  });

  // Stamp the provenance FK (designTest does not accept it).
  const linked = await prisma.incrementalityTest.update({
    where: { id: holdout.id },
    data:  { sourceTestId: test.id },
  });

  logger.info({ workspaceId, testId, holdoutId: holdout.id }, '[TestTrackerService] test promoted to holdout — loop bridged');
  return { ...linked, design: holdout.design };
}
