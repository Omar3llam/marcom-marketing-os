// ============================================================
// MARCOM / Lumi — useCampaignFeed
// ------------------------------------------------------------
// Delegates to IntelligenceContext for singleton fetch behavior.
// Returns: { campaigns, loading, error, refetch, summary }
//
// Where `campaigns` is the raw backend shape:
//   [{ campaign_id, stage, alerts: [
//        { action_id, priority, analysis: { verdict, root_cause },
//          action_plan, metrics: [{metric,value,trend,status,...}],
//          memory, creative_assets }
//   ] }]
//
// Falls back to /api/lumi/demo-feed when /feed is empty or 401
// (so the public stakeholder-demo URL still renders something).
// ============================================================
import { useIntelligence } from '@/context/IntelligenceContext.jsx';

// ── Helper: pull a metric value from an alert's signal rows ──
// Matches metric names case-insensitively. Prefers the typed `raw` numeric the
// feed now emits; falls back to parsing the formatted display string (the
// legacy/demo path, which carries no `raw`). Returns null when the metric row
// is absent — a missing metric is null, never 0, so callers can render "—".
//
// DEPENDENCY: the string-parse fallback assumes `value` is a formatted number
// (e.g. "EGP 4,200", "2.50%"). If the feed ever stops sending `raw`, this is
// the only thing keeping the column alive — keep `raw` populated server-side.
export function metricValue(alert, name) {
  const row = (alert?.metrics ?? []).find(
    (m) => String(m?.metric || '').toLowerCase() === name.toLowerCase(),
  );
  if (!row) return null;
  if (Number.isFinite(row.raw)) return row.raw;
  if (row.value == null) return null;
  const n = parseFloat(String(row.value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ── Helper: derived workspace summary from raw campaigns ─────
export function summarize(campaigns = []) {
  const out = {
    total: campaigns.length,
    byStage:    { DYING: 0, FATIGUED: 0, TESTING: 0, STABLE: 0, SCALING: 0 },
    byVerdict:  { KILL: 0, HOLD: 0, SCALE: 0, TEST: 0 },
    pending:    0,
    spend:      0,
    wasted:     0,
    blendedCpa: null,
    health:     0,
  };
  let cpaSum = 0, cpaCount = 0;
  let healthSum = 0, healthCount = 0;   // mean of REAL per-campaign health_score (0–1)

  for (const c of campaigns) {
    out.byStage[c.stage] = (out.byStage[c.stage] || 0) + 1;

    // Account health = mean of the REAL per-campaign health_score the feed
    // exposes (computeHealthScore over roas/ctr/frequency, 0.00–1.00). No
    // verdict→number inference: a campaign with no score is simply excluded,
    // so health traces to backing rows or reads 0 ("no score yet").
    if (Number.isFinite(c.health_score)) { healthSum += c.health_score; healthCount++; }

    for (const a of c.alerts ?? []) {
      out.pending++;
      out.byVerdict[a.analysis?.verdict ?? 'HOLD'] = (out.byVerdict[a.analysis?.verdict ?? 'HOLD'] || 0) + 1;

      const spend = metricValue(a, 'spend') ?? metricValue(a, 'amount spent') ?? 0;
      const cpa   = metricValue(a, 'CPA');
      out.spend += spend;
      if (a.analysis?.verdict === 'KILL') out.wasted += spend;
      if (cpa != null) { cpaSum += cpa; cpaCount++; }
    }
  }
  out.blendedCpa = cpaCount > 0 ? cpaSum / cpaCount : null;
  // Scale the 0–1 mean to the 0–100 the UI gauges expect. 0 when nothing scored.
  out.health     = healthCount > 0 ? Math.round((healthSum / healthCount) * 100) : 0;
  return out;
}

// ── Hook wrapper — delegates to IntelligenceContext ─────────
export function useCampaignFeed() {
  const { campaigns, loading, error, refresh, setCampaigns, summary } = useIntelligence();
  return {
    campaigns,
    loading,
    error,
    refetch: refresh,
    setCampaigns,
    summary,
  };
}
