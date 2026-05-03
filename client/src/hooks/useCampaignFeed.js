// ============================================================
// MARCOM / Lumi — useCampaignFeed
// ------------------------------------------------------------
// Single source of truth for live campaign data sourced from
// GET /api/lumi/feed. Returns:
//   { campaigns, loading, error, refetch, summary }
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
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';

const PRIMARY  = '/api/lumi/feed';
const FALLBACK = '/api/lumi/demo-feed';

async function fetchFeed(signal) {
  try {
    const res = await api.get(PRIMARY, { signal });
    if (Array.isArray(res.data?.campaigns) && res.data.campaigns.length > 0) {
      return res.data;
    }
    // Empty real feed → drop to demo so the UI shows something
  } catch (err) {
    if (axios.isCancel?.(err) || err?.name === 'CanceledError') throw err;
  }
  const demo = await api.get(FALLBACK, { signal });
  return demo.data;
}

// ── Helper: pull a metric value from an alert's signal rows ──
// Matches metric names case-insensitively. Returns the numeric
// value parsed from the formatted string, or null if absent.
export function metricValue(alert, name) {
  const row = (alert?.metrics ?? []).find(
    (m) => String(m?.metric || '').toLowerCase() === name.toLowerCase(),
  );
  if (!row?.value) return null;
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
  let healthSum = 0, healthCount = 0;

  for (const c of campaigns) {
    out.byStage[c.stage] = (out.byStage[c.stage] || 0) + 1;
    for (const a of c.alerts ?? []) {
      out.pending++;
      out.byVerdict[a.analysis?.verdict ?? 'HOLD'] = (out.byVerdict[a.analysis?.verdict ?? 'HOLD'] || 0) + 1;

      const spend = metricValue(a, 'spend') ?? metricValue(a, 'amount spent') ?? 0;
      const cpa   = metricValue(a, 'CPA');
      out.spend += spend;
      if (a.analysis?.verdict === 'KILL') out.wasted += spend;
      if (cpa != null) { cpaSum += cpa; cpaCount++; }

      // Health inference: SCALE → 80, HOLD → 55, KILL → 25
      const h = a.analysis?.verdict === 'SCALE' ? 80
              : a.analysis?.verdict === 'KILL'  ? 25 : 55;
      healthSum += h; healthCount++;
    }
  }
  out.blendedCpa = cpaCount > 0 ? cpaSum / cpaCount : null;
  out.health     = healthCount > 0 ? Math.round(healthSum / healthCount) : 0;
  return out;
}

export function useCampaignFeed() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const load = useCallback((signal) => {
    setLoading(true); setError(null);
    return fetchFeed(signal)
      .then((data) => setCampaigns(data?.campaigns ?? []))
      .catch((err) => {
        if (axios.isCancel?.(err) || err?.name === 'CanceledError') return;
        setError(err?.message || 'Unknown error');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    fetchFeed(ctrl.signal)
      .then((data) => { if (!cancelled) setCampaigns(data?.campaigns ?? []); })
      .catch((err) => {
        if (cancelled) return;
        if (axios.isCancel?.(err) || err?.name === 'CanceledError') return;
        setError(err?.message || 'Unknown error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  return {
    campaigns,
    loading,
    error,
    refetch: () => load(),
    summary: summarize(campaigns),
    setCampaigns,
  };
}
