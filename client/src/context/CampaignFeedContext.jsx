// ============================================================
// MARCOM / Lumi — CampaignFeedContext
// ------------------------------------------------------------
// Singleton context for campaign feed data.
// Prevents duplicate fetches when multiple components need
// the same /api/lumi/feed data in the same render tree.
// ============================================================
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';

const PRIMARY  = '/api/lumi/feed';
const FALLBACK = '/api/lumi/demo-feed';

async function fetchFeed(signal) {
  // Firebase token is auto-injected by api.js interceptor
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

// Re-export summarize so consumers don't need to import from useCampaignFeed
export { summarize } from '@/hooks/useCampaignFeed.js';

const CampaignFeedCtx = createContext(null);

export function CampaignFeedProvider({ children }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const load = useCallback((signal) => {
    setLoading(true); setError(null);
    return fetchFeed(signal)
      .then(data => setCampaigns(data?.campaigns ?? []))
      .catch(err => {
        if (axios.isCancel?.(err) || err?.name === 'CanceledError') return;
        setError(err?.message || 'Unknown error');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    fetchFeed(ctrl.signal)
      .then(data  => { if (!cancelled) setCampaigns(data?.campaigns ?? []); })
      .catch(err  => {
        if (cancelled) return;
        if (axios.isCancel?.(err) || err?.name === 'CanceledError') return;
        setError(err?.message || 'Unknown error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; ctrl.abort(); };
  }, []);

  return (
    <CampaignFeedCtx.Provider value={{ campaigns, loading, error, refetch: load, setCampaigns }}>
      {children}
    </CampaignFeedCtx.Provider>
  );
}

export function useCampaignFeedContext() {
  const ctx = useContext(CampaignFeedCtx);
  if (!ctx) throw new Error('useCampaignFeedContext must be used inside CampaignFeedProvider');
  return ctx;
}
