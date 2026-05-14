// ============================================================
// MARCOM / Lumi — IntelligenceContext
// ------------------------------------------------------------
// Single source of truth for all intelligence data in /app tree:
//   - campaigns (feed)
//   - memory (patterns + narratives)
//   - radar alerts
//   - execution state
// Prevents N parallel fetches when N components need the same data.
// Replaces scattered useCampaignFeed/useMemory hooks with unified state.
// ============================================================
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';
import { summarize } from '@/hooks/useCampaignFeed.js';

const IntelligenceCtx = createContext(null);

async function fetchCampaigns(signal) {
  try {
    const res = await api.get('/api/lumi/feed', { signal });
    if (Array.isArray(res.data?.campaigns) && res.data.campaigns.length > 0) {
      return res.data;
    }
  } catch (err) {
    if (axios.isCancel?.(err) || err?.name === 'CanceledError') throw err;
  }
  // Empty real feed → fallback to demo
  const demo = await api.get('/api/lumi/demo-feed', { signal });
  return demo.data;
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

export function IntelligenceProvider({ children }) {
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

  // Initial fetch on mount
  useEffect(() => {
    const ctrl = new AbortController();
    refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [refresh]);

  const value = {
    // Campaigns
    campaigns,
    setCampaigns,
    summary: summarize(campaigns),

    // Memory
    memory,
    recordDecision: async ({ campaignId, actionType, decisionRationale }) => {
      try {
        await api.post('/api/memory/record', {
          campaignId,
          actionType,
          decisionRationale,
        });
        // Optimistically refresh memory after recording
        const memData = await fetchMemory();
        setMemory(memData);
      } catch (err) {
        console.error('[IntelligenceContext] Failed to record decision:', err);
      }
    },

    // State
    loading,
    error,
    refresh,
  };

  return (
    <IntelligenceCtx.Provider value={value}>
      {children}
    </IntelligenceCtx.Provider>
  );
}

export function useIntelligence() {
  const ctx = useContext(IntelligenceCtx);
  if (!ctx) throw new Error('useIntelligence must be used inside IntelligenceProvider');
  return ctx;
}
