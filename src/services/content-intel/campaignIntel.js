// ============================================================
// campaignIntel — live campaign performance → Content Lab prompt block
// ============================================================
// Auto-injects the workspace's top campaigns (verdict + real metrics) into the
// Content Lab generation prompt so copy is grounded in what's actually running.
// Read-only over the CONNECTOR substrate (the same MetricSnapshot-backed graph
// the Campaigns page + agentic loop trust) — NOT the legacy CampaignState feed.
//
// HONESTY (governing law): every number traces to a real snapshot row. Null
// metrics (awareness campaigns carry no ROAS/CTR) are OMITTED, never zero-filled.
// Zero-spend roster rows (PR #156/#160) are filtered out. Empty → '' so the
// caller omits the whole section (no "no data" placeholder in the prompt).
// ============================================================
import { getConnectorCampaigns } from '../entity-graph/index.js';
import { getConnectorVerdicts }  from '../verdict-engine/connectorVerdictService.js';
import { logger }                from '../../utils/logger.js';

const MAX_CAMPAIGNS = 5;

/**
 * PURE: join connector campaign rows (metrics, keyed `entityId`) with their
 * verdicts (keyed `id`), keep only real spenders, take the top N by spend.
 * @returns {Array<{name,channel,verdict,rationale,ctr,frequency,roas,spendMinor}>}
 */
export function selectTopCampaigns(campaigns = [], verdicts = [], limit = MAX_CAMPAIGNS) {
  const verdictById = new Map(verdicts.map((v) => [v.id, v])); // verdict.id === campaign.entityId
  return campaigns
    .filter((c) => Number.isFinite(c.spendMinor) && c.spendMinor > 0) // skip zero-spend roster rows
    .sort((a, b) => b.spendMinor - a.spendMinor)
    .slice(0, limit)
    .map((c) => {
      const v = verdictById.get(c.entityId) ?? null;
      return {
        name:       c.name,
        channel:    c.channel,
        verdict:    v?.verdict ?? null,
        // The verdict engine's rationale is already plain English ("Creative
        // fatigue detected — refresh the creative…"); the read-path never
        // exposes the raw signalType, so we surface the human sentence directly.
        rationale:  v?.rationale ?? null,
        ctr:        c.ctr ?? null,        // fraction (0.012 = 1.2%); null for awareness
        frequency:  c.frequency ?? null,
        roas:       c.roas ?? null,       // null for awareness — honest
        spendMinor: c.spendMinor,
      };
    });
}

/**
 * PURE: render the selected campaigns into the prompt block. Returns '' when
 * there is nothing to say (caller omits the section entirely).
 */
export function formatCampaignIntel(top = []) {
  if (!top.length) return '';

  const lines = top.map((c) => {
    let line = `- ${c.name} (${c.channel})`;
    if (c.verdict) {
      line += `: ${c.verdict}`;
      if (c.rationale) line += ` — ${c.rationale}`;
    }
    const metrics = [];
    if (c.ctr != null)       metrics.push(`CTR ${(c.ctr * 100).toFixed(2)}%`); // fraction → percent
    if (c.frequency != null) metrics.push(`Freq ${c.frequency.toFixed(1)}`);
    if (c.roas != null)      metrics.push(`ROAS ${c.roas.toFixed(2)}`);
    if (metrics.length)      line += ` (${metrics.join(', ')})`;
    return line;
  });

  return [
    'CURRENT CAMPAIGN PERFORMANCE (top campaigns by spend):',
    ...lines,
    '',
    'Use this performance data to inform your copy direction:',
    '- HOLD / WATCH campaigns: suggest a creative refresh angle',
    '- KILL campaigns: suggest completely new messaging',
    '- High frequency (>3.5): suggest a new audience angle',
    '- Low CTR (<1%): suggest a stronger hook or a different value proposition',
    '- SCALE campaigns: amplify what is already working',
  ].join('\n');
}

/**
 * Fetch the connector substrate and compose the prompt block. Best-effort: any
 * failure (or an un-synced workspace) yields '' so generation never breaks.
 * NOTE: getConnectorVerdicts re-reads getConnectorCampaigns internally, so the
 * campaign graph is read twice — acceptable for a per-generation call, and
 * refactoring the shared read-path is out of scope here.
 * @returns {Promise<string>}
 */
export async function getCampaignIntelligence(workspaceId) {
  if (!workspaceId) return '';
  try {
    const [campaigns, verdictResult] = await Promise.all([
      getConnectorCampaigns(workspaceId),
      getConnectorVerdicts(workspaceId),
    ]);
    return formatCampaignIntel(selectTopCampaigns(campaigns, verdictResult.verdicts));
  } catch (err) {
    logger.warn({ err: err.message, workspaceId }, '[campaignIntel] skipped — generation continues on brand context only');
    return '';
  }
}
