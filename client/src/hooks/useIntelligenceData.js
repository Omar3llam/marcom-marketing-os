import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';
import { summarize } from '@/hooks/useCampaignFeed.js';

async function fetchCampaigns(signal) {
  try {
    const res = await api.get('/api/lumi/feed', { signal });
    // Empty array = new user with 0 uploads → show empty state, NOT demo data.
    return res.data;
  } catch (err) {
    if (axios.isCancel?.(err) || err?.name === 'CanceledError') throw err;
    return { campaigns: [] };
  }
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
