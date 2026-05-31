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

async function fetchMemory(signal) {
  try {
    const res = await api.get('/api/memory/patterns', { signal });
    return res.data ?? { patterns: [], narratives: [], total: 0 };
  } catch (err) {
    if (axios.isCancel?.(err) || err?.name === 'CanceledError') throw err;
    return { patterns: [], narratives: [], total: 0 };
  }
}

export function useIntelligenceData() {
  const [campaigns, setCampaigns] = useState([]);
  const [memory, setMemory] = useState({ patterns: [], narratives: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const [feedData, memData] = await Promise.all([
        fetchCampaigns(signal),
        fetchMemory(signal),
      ]);
      setCampaigns(feedData?.campaigns ?? []);
      setMemory(memData);
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

  const recordDecision = useCallback(async ({ campaignId, actionType, decisionRationale }) => {
    try {
      await api.post('/api/memory/record', { campaignId, actionType, decisionRationale });
      const memData = await fetchMemory();
      setMemory(memData);
    } catch (err) {
      console.error('[IntelligenceContext] Failed to record decision:', err);
    }
  }, []);

  return {
    campaigns,
    setCampaigns,
    summary: summarize(campaigns),
    memory,
    recordDecision,
    loading,
    error,
    refresh,
  };
}
