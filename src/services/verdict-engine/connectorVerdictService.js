// ============================================================
// connectorVerdictService — live connector campaigns → verdicts
// ============================================================
// Bridges the connector entity graph (EntityGraphService) into the pure
// verdictEngine. Read-only: builds the {id,level,metrics,children} tree the
// engine wants, runs rollupVerdicts, returns JSON. NEVER persists — a GET that
// silently wrote PROPOSED Decision rows would surprise the caller and brush the
// "Lumi initiates / human confirms" guard. Persistence stays in VerdictService.
//
// THE REVENUE GATE (load-bearing, governing law): verdictEngine reads roas < 1.0
// as KILL. A campaign whose revenue was never measured lands revenueMinor 0 (see
// snapshotSink — `n.revenueMinor || 0`, never null), so feeding it to the engine
// would compute roas 0 → a fabricated KILL from data that doesn't exist — the
// exact class PR #96 removed from the ROAS display, one layer up. So a campaign
// is verdict-eligible ONLY with a positive MEASURED revenue signal against real
// spend; everything else is reported as `gatedOut` ("needs revenue data"), never
// scored. We gate on revenue+spend directly (not `roas != null`) because a stale
// pre-PR-#96 row can still carry a literal roas:0 that would otherwise slip in.
// (Revenue here is platform-CLAIMED via Meta action_values — present, if not yet
// independently verified — so it counts as measured for gating purposes.)
// ============================================================
import { getConnectorCampaigns } from '../entity-graph/index.js';
import { rollupVerdicts }        from './verdictEngine.js';
import { logger }                from '../../utils/logger.js';

/** PURE: does this connector row carry a positive measured revenue signal? */
export function hasMeasuredRevenue(row) {
  const rev = row?.revenueMinor;
  const spend = row?.spendMinor;
  return Number.isFinite(rev) && rev > 0 && Number.isFinite(spend) && spend > 0;
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
 * list (no measured revenue). Returns { tree, gatedOut }; tree is null when no
 * campaign is eligible (caller must NOT fabricate a verdict in that case).
 */
export function buildConnectorVerdictTree(workspaceId, campaigns = []) {
  const eligible = [];
  const gatedOut = [];
  for (const c of campaigns) {
    if (hasMeasuredRevenue(c)) {
      eligible.push({
        id:      c.entityId,
        level:   'CAMPAIGN',
        name:    c.name,
        currency: c.currency || 'USD',
        metrics: toLeafMetrics(c),
      });
    } else {
      gatedOut.push({ id: c.entityId, name: c.name, reason: 'no measured revenue' });
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

  const annotated = rollupVerdicts(tree);
  const verdicts = annotated.children.map((c) => ({
    id:         c.id,
    name:       c.name,
    verdict:    c.verdict,
    confidence: c.verdictConfidence,
    rationale:  c.rationale,
    spendMinor: c.metrics.spendMinor,
    roas:       c.signalInput.roas,
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
