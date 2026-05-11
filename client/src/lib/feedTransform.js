// ============================================================
// MARCOM / Lumi — Feed Transform Utility
// ------------------------------------------------------------
// Transforms Claude orchestrator decisions (from /upload-csv?mode=analyze)
// into the campaigns feed format expected by CampaignAnalysis.jsx.
//
// Input: { decisions: Array<OrchestratorDecision> }
// Output: Array<CampaignFeedItem>
// ============================================================

/**
 * Transform orchestrator decisions into campaign feed format.
 * Groups by campaign_id, maps decisions → alerts, infers stage from verdict.
 *
 * @param {object} uploadResult - Response from POST /api/campaigns/upload-csv?mode=analyze
 * @returns {Array} - campaigns array in useCampaignFeed format
 */
export function transformDecisionsToFeed(uploadResult) {
  const decisions = uploadResult?.decisions ?? [];
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return [];
  }

  // Group decisions by campaignId (multiple adsets → same campaign)
  const byCampaign = new Map();

  for (const d of decisions) {
    const cid = d.campaignName || d.campaignId || 'Unknown Campaign';
    if (!byCampaign.has(cid)) {
      byCampaign.set(cid, {
        campaign_id: cid,
        stage:       inferStage(d.verdict, d.risk_level),
        alerts:      [],
      });
    }

    const campaign = byCampaign.get(cid);
    campaign.alerts.push({
      action_id:        `analyze-${d.campaignId}-${Date.now()}`,
      idempotency_key:  `analyze-${d.campaignId}-${Date.now()}`,
      priority:         inferPriority(d.verdict, d.risk_level),
      analysis: {
        verdict:    d.verdict,
        root_cause: d.why?.[0] || d.impact || 'Analysis complete',
      },
      historical_insight: d.why?.slice(1).join(' · ') || null,
      action_plan: {
        action:           d.action?.type || 'Review decision',
        status:           'PENDING',
        imageUrl:         null,
        reference_prompt: null,
      },
      metrics: buildMetricsFromDecision(d),
      memory:  [],
      // Preserve raw decision for debugging
      _rawDecision: d,
    });
  }

  return Array.from(byCampaign.values());
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Infer CampaignStage enum from verdict + risk_level.
 * Maps to Prisma schema stages: DYING, FATIGUED, TESTING, STABLE, SCALING
 */
function inferStage(verdict, riskLevel) {
  if (verdict === 'KILL') {
    return riskLevel === 'HIGH' ? 'DYING' : 'FATIGUED';
  }
  if (verdict === 'SCALE') {
    return 'SCALING';
  }
  if (verdict === 'HOLD') {
    return riskLevel === 'HIGH' ? 'FATIGUED' : 'STABLE';
  }
  return 'TESTING';
}

/**
 * Infer alert priority from verdict + risk_level.
 */
function inferPriority(verdict, riskLevel) {
  if (verdict === 'KILL' && riskLevel === 'HIGH') return 'HIGH';
  if (verdict === 'SCALE' && riskLevel === 'LOW') return 'LOW';
  return 'MEDIUM';
}

/**
 * Build structured metrics array from orchestrator decision.
 * Claude returns "impact" string — we parse it for display.
 * Real metric values come from modeSpecificData.campaignTable if present.
 */
function buildMetricsFromDecision(decision) {
  const rows = [];

  // Extract metrics from the enriched decision object if available
  // (orchestrator passes through the parsed campaign data)
  const raw = decision.modeSpecificData?.campaignTable?.[0];
  if (raw) {
    const ctr  = raw.ctr  ?? 0;
    const roas = raw.roas ?? 0;
    const freq = raw.frequency ?? 0;
    const cpa  = raw.costPerResult ?? 0;

    rows.push(
      { metric: 'CTR',       trend: trendFor('ctr', ctr),   value: `${ctr.toFixed(2)}%`,  delta: '', context: 'Per CSV upload', status: statusFor('ctr', ctr) },
      { metric: 'ROAS',      trend: trendFor('roas', roas), value: `${roas.toFixed(2)}x`, delta: '', context: 'Per CSV upload', status: statusFor('roas', roas) },
      { metric: 'Frequency', trend: trendFor('freq', freq), value: `${freq.toFixed(2)}`,  delta: '', context: 'Per CSV upload', status: statusFor('freq', freq) },
      { metric: 'CPA',       trend: trendFor('cpa', cpa),   value: `$${cpa.toFixed(2)}`,  delta: '', context: 'Per CSV upload', status: statusFor('cpa', cpa) },
    );
  } else {
    // Fallback: parse impact string for display (less structured)
    rows.push({
      metric:  'Impact',
      trend:   decision.verdict === 'KILL' ? 'down' : decision.verdict === 'SCALE' ? 'up' : 'flat',
      value:   decision.confidence ? `${Math.round(decision.confidence * 100)}%` : '—',
      delta:   '',
      context: decision.impact || 'Claude analysis',
      status:  decision.verdict === 'KILL' ? 'danger' : decision.verdict === 'SCALE' ? 'positive' : 'warning',
    });
  }

  return rows;
}

function trendFor(metric, val) {
  if (metric === 'ctr' || metric === 'roas') return val >= 2 ? 'up' : val >= 1 ? 'flat' : 'down';
  if (metric === 'freq') return val > 4 ? 'up' : 'flat';
  if (metric === 'cpa')  return val > 50 ? 'up' : 'flat';
  return 'flat';
}

function statusFor(metric, val) {
  if (metric === 'ctr')  return val >= 2   ? 'positive' : val >= 1   ? 'warning' : 'danger';
  if (metric === 'roas') return val >= 3   ? 'positive' : val >= 1   ? 'warning' : 'danger';
  if (metric === 'freq') return val <= 2   ? 'positive' : val <= 3.5 ? 'warning' : 'danger';
  if (metric === 'cpa')  return val <= 20  ? 'positive' : val <= 50  ? 'warning' : 'danger';
  return 'warning';
}
