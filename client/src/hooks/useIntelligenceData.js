import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';
import { summarize } from '@/hooks/useCampaignFeed.js';

// B8-02 — this used to catch every non-cancel error and `return { campaigns: [] }`.
// That made `refresh`'s own catch unreachable for anything but a cancellation
// (which returns before setError), so the exported `error` was declared,
// cleared, returned and structurally ALWAYS NULL. A backend outage arrived at
// four live surfaces shaped exactly like a successful read of an empty account.
//
// It does not catch now. A failure is a measured semantic state and belongs to
// the caller; a hook may report it or rethrow it, but it may not turn it into
// data. An empty array still means "this account has no campaigns" — which is
// the whole point of not spelling a failure the same way.
async function fetchCampaigns(signal) {
  const res = await api.get('/api/lumi/feed', { signal });
  return res.data;
}

// R7 — fetchMemory() called /api/memory/patterns on every mount, stored the
// result in a `memory` state field, and returned it from this hook. Nothing
// consumed it: useIntelligence() has exactly two callers (useOverviewModel and
// useCampaignFeed) and neither destructures `memory`. It was a round-trip to a
// legacy table whose output never reached a pixel. Removed with the endpoint.
// The sidebar's decision list, the one surface that DID render that data, now
// reads the canonical spine via features/shell/services.js.

export function useIntelligenceData() {
  const [campaigns, setCampaigns] = useState([]);
  // Top-level feed field (Phase 2 forward signal) — fetched alongside campaigns
  // but dropped here until now; surfaced for the Intelligence FatigueForecast.
  const [fatiguePredictions, setFatiguePredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const feedData = await fetchCampaigns(signal);
      setCampaigns(feedData?.campaigns ?? []);
      setFatiguePredictions(Array.isArray(feedData?.fatiguePredictions) ? feedData.fatiguePredictions : []);
    } catch (err) {
      if (axios.isCancel?.(err) || err?.name === 'CanceledError') return;
      setError(err?.message || 'Failed to load intelligence data');
      // B8-02 — empty the collections BESIDE the error, never instead of it.
      // Stale rows under a failure banner would be a second claim: that these
      // are the account's campaigns right now, which is exactly what we just
      // failed to establish.
      setCampaigns([]);
      setFatiguePredictions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [refresh]);

  // R7 — recordDecision() POSTed { campaignId, actionType, decisionRationale }
  // to /api/memory/record, whose serializer required executionId, decisionType,
  // signalType, diagnosis, actionTaken, outcome and confidence. Every call it
  // could ever have made was a guaranteed 400, swallowed by a console.error.
  // It had no caller in the UI either. Removed with the endpoint rather than
  // repointed: writing a Decision is the verdict engine's job, not a hook's.

  return {
    campaigns,
    setCampaigns,
    summary: summarize(campaigns),
    fatiguePredictions,
    loading,
    error,
    refresh,
  };
}
