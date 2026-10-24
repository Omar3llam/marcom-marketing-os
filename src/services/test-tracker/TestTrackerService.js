// ============================================================
// TestTrackerService — experiment lifecycle + loop closure
// ============================================================
// Owns all DB I/O and the live Meta read. The deterministic
// testReadoutEngine never touches either.
//
//   startTest():           PROPOSED → RUNNING
//   recordVariantMetrics(): validated updates under the experiment lock
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
import { projectIncrementalityTest } from '../incrementality-engine/incrementalityProjection.js';
import { DECISION_CLASS } from '@marcom/runtime-contracts';

const GRAPH_BASE = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v21.0'}`;
// The WRITE half of the tested-dimension contract — see TEST_MEMORY_PREFIX in
// TestGeneratorService, which reads these rows back by this exact prefix.
// Exported so the pairing is testable rather than conventional.
export const TEST_ROOT_PREFIX = 'test:';
const HOLDOUT_DEFAULT_CHANNEL = 'META'; // the only live-connected channel today

// EntityLevel → the lowercase target type validateActionTarget expects.
// ACCOUNT is treated as campaign (mirrors verdictToActionType).
const LEVEL_TO_TARGET = Object.freeze({
  ACCOUNT: 'campaign', CAMPAIGN: 'campaign', ADSET: 'adset', AD: 'ad', CREATIVE: 'creative',
});

const METRIC_FIELDS = ['impressions', 'clicks', 'conversions', 'spendMinor', 'revenueMinor'];
const MAX_STORED_INT = 2147483647; // TestVariant Int / PostgreSQL int4, including minor-unit money.

function lifecycleError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateMetrics(row) {
  for (const field of METRIC_FIELDS) {
    const value = row[field];
    if (value != null && (!Number.isInteger(value) || value < 0 || value > MAX_STORED_INT)) {
      throw lifecycleError('INVALID_TEST_METRICS', `${field} must be an integer between 0 and ${MAX_STORED_INT}`);
    }
  }
}

// Every lifecycle writer takes this same parent lock. READ COMMITTED reads
// after the lock see the preceding writer's committed status and variants.
// Scope the lock itself, not just a read before it: foreign IDs acquire nothing.
async function withMutableTest(workspaceId, testId, operation) {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.$queryRaw`
      SELECT id FROM public.test_experiments
      WHERE id = ${testId}::uuid AND "workspaceId" = ${workspaceId}::uuid FOR UPDATE`;
    if (!owned.length) throw new Error('test not found');
    const test = await tx.testExperiment.findFirst({
      where: { id: testId, workspaceId }, include: { variants: true },
    });
    if (!test) throw new Error('test not found');
    if (test.status !== 'PROPOSED' && test.status !== 'RUNNING') {
      throw lifecycleError('TEST_CONFLICT', 'Experiment is terminal; its evidence cannot be changed.');
    }
    return operation(tx, test);
  }, {
    isolationLevel: 'ReadCommitted',
    // Conclusion holds the lock through optional Insights enrichment (each
    // request already has a 10s bound). Expiry rolls back the entire result;
    // it never permits a second writer or a partial conclusion.
    timeout: 60_000,
  });
}

async function writeMetrics(tx, test, rows) {
  const ownVariantIds = new Set(test.variants.map((v) => v.id));
  const owned = rows.filter((r) => r && r.variantId && ownVariantIds.has(r.variantId));
  // Validate the WHOLE batch before issuing even its first write.
  owned.forEach(validateMetrics);
  await Promise.all(owned.map((r) => tx.testVariant.update({
    where: { id: r.variantId, testId: test.id, test: { workspaceId: test.workspaceId } },
    data: Object.fromEntries(METRIC_FIELDS.filter((field) => r[field] != null).map((field) => [field, r[field]])),
  })));
  return { updated: owned.length };
}

/**
 * ONE experiment, by its own id. Workspace-scoped, so a test outside
 * `workspaceId` is indistinguishable from one that does not exist.
 *
 * C-13. The Testing OS could start, meter, conclude and promote a test by id
 * and could not READ one: five POSTs addressed a single row, and the only GET
 * was the list. A client holding one experiment id had to fetch a hundred and
 * filter, which is what "not addressable" means in practice.
 *
 * `variants` travel with it because B7-04 puts an Experiment's evidence on its
 * domain row rather than on the Decision — the arms ARE the readout, and a
 * by-id read without them would be addressable and useless.
 *
 * Mirrors `IncrementalityService.getTest`, which has existed since Phase 7C.
 */
export async function getTestById(workspaceId, testId) {
  if (!workspaceId) throw new Error('getTestById: workspaceId required');
  if (!testId) throw new Error('getTestById: testId required');
  return prisma.testExperiment.findFirst({
    where: { id: testId, workspaceId },
    include: { variants: true },
  });
}

/** PROPOSED → RUNNING. Workspace-scoped: a test outside `workspaceId` is invisible. */
export async function startTest(workspaceId, testId) {
  if (!workspaceId) throw new Error('startTest: workspaceId required');
  if (!testId) throw new Error('startTest: testId required');
  return withMutableTest(workspaceId, testId, (tx, test) => {
    if (test.status !== 'PROPOSED') throw lifecycleError('TEST_CONFLICT', 'Experiment has already started.');
    return tx.testExperiment.update({
      where: { id: testId, workspaceId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  });
}

/**
 * Record per-variant performance counts in one protected transaction.
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
  return withMutableTest(workspaceId, testId, (tx, test) => writeMetrics(tx, test, rows));
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
  const impressions = Number(d.impressions ?? 0);
  const clicks      = Number(d.clicks ?? 0);
  const conversions = Number(d.conversions ?? 0);
  const spend       = Number(d.spend ?? 0);

  let roas = 0;
  if (Array.isArray(d.purchase_roas)) {
    const row = d.purchase_roas.find((r) => r.action_type === 'omni_purchase') || d.purchase_roas[0];
    roas = row ? Number(row.value) : 0;
  } else if (d.purchase_roas != null) {
    roas = Number(d.purchase_roas);
  }
  const revenue = roas > 0 && spend > 0 ? roas * spend : 0;
  if (![spend, roas, revenue].every((value) => Number.isFinite(value) && value >= 0)) {
    throw lifecycleError('INVALID_TEST_METRICS', 'Meta money inputs must be finite and nonnegative.');
  }
  const metrics = {
    impressions,
    clicks,
    conversions,
    spendMinor:   toMinor(spend, currency),
    revenueMinor: toMinor(revenue, currency),
  };
  validateMetrics(metrics);
  return metrics;
}

/**
 * Best-effort: refresh each variant's counts from Meta Insights.
 * Resolves the workspace's META credential via resolveCredential (the
 * OAuth-authoritative marcom_credentials store) and pulls per-variant
 * insights. A missing token or per-variant API error is logged and skipped;
 * ownership, terminal-state and database failures still refuse the operation.
 *
 * @param {string} workspaceId
 * @param {string} testId
 * @returns {Promise<{refreshed:number, skipped:number, reason?:string}>}
 */
export async function refreshFromMeta(workspaceId, testId) {
  if (!workspaceId) throw new Error('refreshFromMeta: workspaceId required');
  if (!testId) throw new Error('refreshFromMeta: testId required');
  return withMutableTest(workspaceId, testId, refreshLockedTest);
}

// Reuse the caller's lock/transaction; never nest recordVariantMetrics here.
async function refreshLockedTest(tx, test) {
  const testId = test.id;

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
      // R11 (I68) — token in the Authorization header, not the query string.
      const url = `${GRAPH_BASE}/${encodeURIComponent(v.metaEntityId)}/insights?fields=${fields}`;
      const res = await axios.get(url, {
        timeout: 10_000,
        headers: { Authorization: `Bearer ${token}` },
      });
      const row = res.data?.data?.[0];
      if (!row) { skipped++; continue; }
      updates.push({ variantId: v.id, ...parseVariantInsights(row, test.currency) });
    } catch (err) {
      skipped++;
      logger.warn({ testId, variantId: v.id, err: err.message }, '[TestTrackerService] variant insight fetch failed');
    }
  }

  if (updates.length > 0) await writeMetrics(tx, test, updates);
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
 * Conclude a test — THE LOOP. One locked transaction covers best-effort live
 * refresh, honest readout and Memory, plus (when warranted + valid) a
 * PROPOSED verdict Decision.
 *
 * @returns {Promise<{ readout, memoryId, decisionId, verdict, actionType }>}
 */
export async function concludeTest(workspaceId, testId, { refresh = true } = {}) {
  if (!workspaceId) throw new Error('concludeTest: workspaceId required');
  if (!testId) throw new Error('concludeTest: testId required');
  const result = await withMutableTest(workspaceId, testId, async (tx, lockedTest) => {
    let test = lockedTest;
    if (test.variants.length < 2) throw new Error(`concludeTest: test ${testId} needs ≥2 variants`);
    test.variants.forEach(validateMetrics);
    if (refresh) {
      await refreshLockedTest(tx, test);
      test = await tx.testExperiment.findFirst({
        where: { id: testId, workspaceId }, include: { variants: true },
      });
    }

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
          // C-10 — one class over both test producers. See decisionClass.js.
          decisionClass: DECISION_CLASS.EXPERIMENT,
        },
      });
      decisionId = decision.id;
    }

    await tx.testExperiment.update({
      where: { id: test.id, workspaceId },
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
      await tx.testVariant.update({
        where: { id: readout.winnerVariantId, testId: test.id, test: { workspaceId } }, data: { isWinner: true },
      });
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

    return { readout, decisionId, memoryId: memory.id, verdict: resolved.verdict, actionType: resolved.actionType };
  });

  logger.info(
    { testId, winner: result.readout.winnerLabel, verdict: result.verdict, decisionId: result.decisionId },
    '[TestTrackerService] test concluded — loop closed',
  );
  return result;
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
  return { ...projectIncrementalityTest(linked), design: holdout.design };
}
