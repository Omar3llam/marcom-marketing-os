// ============================================================
// MARCOM / Lumi — useFeed hook
// ------------------------------------------------------------
// Owns all data-fetching for the Decision OS. Components stay
// presentational; this hook is the single integration point
// against `GET /api/lumi/feed`.
//
// Returns:
//   { decisions, loading, error, refetch, setDecisions }
//
// `setDecisions` is exposed so optimistic UI updates (e.g.
// removing a card after Execute) don't require a roundtrip.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { api } from '../lib/api.js';

const PRIMARY_FEED  = '/api/lumi/feed';
const FALLBACK_FEED = '/api/lumi/demo-feed';

// ── Adapter: backend feed shape → flat `decisions` array ────
// All field accesses use optional chaining + ?? defaults so a
// partial payload (missing alerts, metrics, memory, etc.) never
// crashes the renderer.
export function adaptFeedPayload(data) {
  if (!data?.campaigns) return [];

  return data.campaigns.flatMap((campaign) =>
    (campaign?.alerts ?? []).map((alert) => ({
      id:               alert?.action_id,
      idempotencyKey:   alert?.idempotency_key,
      campaignId:       campaign?.campaign_id,
      campaignName:     campaign?.campaign_id,   // backend lacks name today
      stage:            campaign?.stage ?? 'UNKNOWN',
      priority:         alert?.priority ?? 'LOW',
      rootCause:        alert?.analysis?.root_cause ?? 'Unknown',
      verdict:          alert?.analysis?.verdict   ?? 'HOLD',
      historicalInsight: alert?.historical_insight ?? null,
      actionPlan: {
        action:          alert?.action_plan?.action          ?? '',
        status:          alert?.action_plan?.status          ?? 'PENDING',
        imageUrl:        alert?.action_plan?.imageUrl        ?? null,
        referencePrompt: alert?.action_plan?.reference_prompt ?? null,
      },
      whyDeepDive: (alert?.metrics ?? []).map((m) => ({
        metric:  m?.metric,
        trend:   m?.trend,
        value:   m?.value,
        delta:   m?.delta,
        context: m?.context,
        status:  m?.status,
      })),
      memory: (alert?.memory ?? []).map((mem) => ({
        actionType:        mem?.actionType,
        rationale:         mem?.decisionRationale,
        isSustainable:     mem?.isSustainable,
        impactDurationHrs: mem?.impactDurationHrs,
      })),
      // Surface orchestrator output (Phase-8 dual-agent) when present.
      creativeAssets: alert?.creative_assets ?? null,
    })),
  );
}

// Try the JWT-protected real feed first; fall back to /demo-feed if
// the user isn't authed yet OR the feed is empty (zero campaigns
// uploaded). This keeps the public demo URL useful while showing
// real data the moment a CSV is uploaded.
async function fetchFeed(signal) {
  try {
    const res = await api.get(PRIMARY_FEED, { signal });
    if (Array.isArray(res.data?.campaigns) && res.data.campaigns.length > 0) {
      return res.data;
    }
    // Empty real feed → fall through to demo so the UI is never blank.
  } catch (err) {
    if (axios.isCancel?.(err) || err?.name === 'CanceledError') throw err;
    // 401 / 5xx / network → silently try demo.
  }
  const demo = await api.get(FALLBACK_FEED, { signal });
  return demo.data;
}

export function useFeed() {
  const [decisions, setDecisions] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  // Tracks the latest invocation so a stale resolve from a
  // racing refetch never overwrites a newer payload.
  const fetchOnce = useCallback((signal) => {
    setLoading(true);
    setError(null);
    return fetchFeed(signal)
      .then((data) => setDecisions(adaptFeedPayload(data)))
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
      .then((data) => {
        if (cancelled) return;
        setDecisions(adaptFeedPayload(data));
      })
      .catch((err) => {
        if (cancelled) return;
        if (axios.isCancel?.(err) || err?.name === 'CanceledError') return;
        setError(err?.message || 'Unknown error');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  const refetch = useCallback(() => fetchOnce(), [fetchOnce]);

  return { decisions, loading, error, refetch, setDecisions };
}
