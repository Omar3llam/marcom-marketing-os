// ============================================================
// connectorVerdictService — live connector campaigns → verdicts
// ============================================================
// Bridges the connector entity graph (EntityGraphService) into the pure
// verdictEngine. Read-only: builds the {id,level,metrics,children} tree the
// engine wants, runs rollupVerdicts, returns JSON. NEVER persists — a GET that
// silently wrote PROPOSED Decision rows would surprise the caller and brush the
// "Lumi initiates / human confirms" guard. Persistence stays in VerdictService.
//
// TWO ELIGIBILITY TRACKS (load-bearing, governing law):
//   A. MEASURED REVENUE — positive claimed revenue against real spend → the
//      revenue verdicts (KILL/SCALE/HOLD). verdictEngine reads roas < 1.0 as KILL,
//      so this must be a REAL signal: a row whose revenue was never measured lands
//      revenueMinor 0 (snapshotSink `|| 0`), and forcing it through the roas
//      thresholds would fabricate a KILL from data that doesn't exist (the class
//      PR #96 removed from the ROAS display). We gate on revenue+spend directly
//      (not `roas != null`) because a stale row can carry a literal roas:0.
//   B. ENGAGEMENT, NO REVENUE — real spend + impressions but no measured revenue
//      (awareness/reach campaigns). These ARE eligible, via the engine's AWARENESS
//      track: judged on frequency + CTR only, roas stays null, NEVER a revenue
//      verdict. The engine routes A vs B on the `revenueMeasured` flag toSignalInput
//      derives — so both tracks share one code path; the gate only decides entry.
// Everything else is genuinely dataless (no spend or no delivery — incl. PR #156
// zero-spend roster rows) → `gatedOut`, never scored.
// (Revenue here is platform-CLAIMED via Meta action_values — present, if not yet
// independently verified — so it counts as measured for gating purposes.)
// ============================================================
import { getConnectorCampaigns } from '../entity-graph/index.js';
import { rollupVerdicts }        from './verdictEngine.js';
import { applyRelativeRanking }  from './relativeRanking.js';
import { logger }                from '../../utils/logger.js';

// Meta objectives that are GENUINELY awareness/reach — no purchase revenue is
// expected, so "no revenue measured" is honest, not a tracking gap. Everything
// else (OUTCOME_LEADS / OUTCOME_SALES / OUTCOME_APP_PROMOTION / legacy CONVERSIONS)
// is a conversion objective: no measured revenue there is a MEASUREMENT GAP.
export const AWARENESS_OBJECTIVES = new Set([
  'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_TRAFFIC',
  // legacy objective names Meta still returns on older campaigns:
  'BRAND_AWARENESS', 'REACH', 'VIDEO_VIEWS', 'POST_ENGAGEMENT', 'PAGE_LIKES', 'LINK_CLICKS', 'EVENT_RESPONSES',
]);

/** PURE: is this objective a genuine awareness/reach objective (no revenue expected)? */
export function isAwarenessObjective(objective) {
  return objective != null && AWARENESS_OBJECTIVES.has(objective);
}

/**
 * PURE: should revenue/conversion value be EXPECTED for this objective? A known
 * conversion objective → true (no revenue = a tracking gap). A known awareness
 * objective → false. Unknown/null → false: we never fabricate a "verify your
 * tracking" claim on an objective we don't actually know — and a real conversion
 * campaign carries a known OUTCOME_*, so it still gets the corrected message.
 */
export function revenueExpectedFor(objective) {
  return objective != null && !AWARENESS_OBJECTIVES.has(objective);
}

/** PURE: does this connector row carry a positive measured revenue signal? */
export function hasMeasuredRevenue(row) {
  const rev = row?.revenueMinor;
  const spend = row?.spendMinor;
  return Number.isFinite(rev) && rev > 0 && Number.isFinite(spend) && spend > 0;
}

/**
 * PURE: is this campaign's ROAS unscoreable for want of revenue DATA (not for
 * want of performance)? True only for a CONVERSION-objective campaign that spent
 * real money and measured no revenue — i.e. a tracking gap the user can close by
 * uploading revenue (Settings → Revenue data) or wiring a purchase pixel.
 *
 * Deliberately NOT true for:
 *   • a genuine awareness/reach campaign (no revenue is EXPECTED — scoring it on
 *     ROAS would be the fabrication the awareness track exists to prevent),
 *   • an unknown objective (we never claim a tracking gap we can't prove),
 *   • a campaign with no spend (nothing to attribute revenue to yet).
 *
 * This is the deterministic signal behind the "needs revenue" UI — it is derived
 * from real rows, never from an LLM.
 */
export function needsRevenueData(row) {
  const spend = row?.spendMinor;
  if (!Number.isFinite(spend) || spend <= 0) return false;
  return revenueExpectedFor(row?.objective) && !hasMeasuredRevenue(row);
}

/**
 * PURE: did this campaign actually deliver — real spend AND impressions — even
 * with no measured revenue? An awareness/reach campaign qualifies for the engine's
 * engagement-only track. A PR #156 zero-spend roster row (spend 0, impressions 0)
 * does NOT — it has no signal to judge, so it stays gatedOut.
 */
export function hasEngagement(row) {
  const spend = row?.spendMinor;
  const impressions = row?.impressions;
  return Number.isFinite(spend) && spend > 0 && Number.isFinite(impressions) && impressions > 0;
}

/** PURE: a connector row → the engine's leaf metric shape (raw, un-ratio'd). */
function toLeafMetrics(row) {
  return {
    spendMinor:   row.spendMinor   ?? 0,
    revenueMinor: row.revenueMinor ?? 0,
    impressions:  row.impressions  ?? 0,
    clicks:       row.clicks       ?? 0,
    conversions:  row.conversions  ?? 0,
    frequency:    row.frequency    ?? 0,
  };
}

/**
 * PURE: split connector campaigns into a verdict tree (eligible) + a gatedOut
 * list. Eligible = measured revenue OR real engagement (the engine's awareness
 * track handles the latter, roas null). gatedOut = genuinely dataless (no spend or
 * no delivery). Returns { tree, gatedOut }; tree is null when nothing is eligible
 * (caller must NOT fabricate a verdict in that case).
 */
export function buildConnectorVerdictTree(workspaceId, campaigns = []) {
  const eligible = [];
  const gatedOut = [];
  for (const c of campaigns) {
    // Measured revenue OR engaged-but-no-revenue both reach the engine; the
    // revenueMeasured flag (derived in toSignalInput) routes them to the revenue
    // verdicts vs the awareness track. Only dataless rows are gated out.
    if (hasMeasuredRevenue(c) || hasEngagement(c)) {
      eligible.push({
        id:      c.entityId,
        level:   'CAMPAIGN',
        name:    c.name,
        currency: c.currency || 'USD',
        // Carry the objective + the channel-agnostic revenueExpected flag so the
        // engine's no-revenue branch can name the real story: true awareness vs a
        // conversion campaign with no measured revenue (a tracking gap).
        objective:       c.objective ?? null,
        revenueExpected: revenueExpectedFor(c.objective),
        metrics: toLeafMetrics(c),
      });
    } else {
      gatedOut.push({ id: c.entityId, name: c.name, reason: 'no measured revenue or engagement' });
    }
  }
  const tree = eligible.length
    ? { id: workspaceId, level: 'ACCOUNT', children: eligible }
    : null;
  return { tree, gatedOut };
}

/**
 * Read connector campaigns for a workspace and return their verdicts.
 * @returns {Promise<{ verdicts:Array, gatedOut:Array, account:object|null, status:string }>}
 */
export async function getConnectorVerdicts(workspaceId) {
  if (!workspaceId) return { verdicts: [], gatedOut: [], account: null, status: 'NO_WORKSPACE' };

  const campaigns = await getConnectorCampaigns(workspaceId);
  const { tree, gatedOut } = buildConnectorVerdictTree(workspaceId, campaigns);

  if (!tree) {
    const status = gatedOut.length ? 'NO_ELIGIBLE_CAMPAIGNS' : 'NO_CAMPAIGNS';
    logger.info({ workspaceId, gatedOut: gatedOut.length, status }, '[connectorVerdicts] no eligible campaigns');
    return { verdicts: [], gatedOut, account: null, status };
  }

  // Absolute verdicts first, then the portfolio-relative post-pass over the SAME
  // annotated tree (same code the write twin runs) — bottom-of-cohort HOLD/WATCH
  // engagement campaigns become KILL, top-of-cohort become SCALE, with the
  // rationale rewritten to cite the real group average. Pure + deterministic.
  const annotated = applyRelativeRanking(rollupVerdicts(tree));
  const verdicts = annotated.children.map((c) => ({
    id:         c.id,
    name:       c.name,
    verdict:    c.verdict,
    confidence: c.verdictConfidence,
    rationale:  c.rationale,
    spendMinor: c.metrics.spendMinor,
    roas:       c.signalInput.roas,
    // revenueExpected (derived from the campaign objective) rides through so a
    // no-revenue campaign can be split honestly on-screen: a genuine awareness
    // campaign vs a conversion campaign with a tracking gap — the rationale
    // already distinguishes them per-row; this lets the aggregate banner too.
    revenueExpected: c.revenueExpected ?? false,
    // Set when this verdict was decided by the relative post-pass ('TOP' | 'BOTTOM')
    // — null otherwise. Lets the UI badge "relative to portfolio" honestly.
    relativeRank: c.relativeRank ?? null,
  }));

  logger.info(
    { workspaceId, scored: verdicts.length, gatedOut: gatedOut.length },
    '[connectorVerdicts] verdicts computed',
  );
  return {
    verdicts,
    gatedOut,
    account: { verdict: annotated.verdict, confidence: annotated.verdictConfidence },
    status: 'OK',
  };
}
