// ============================================================
// MARCOM / Lumi — CampaignFeedContext
// ------------------------------------------------------------
// Singleton context for campaign feed data.
// Prevents duplicate fetches when multiple components need
// the same /api/lumi/feed data in the same render tree.
// ============================================================
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';

const PRIMARY  = '/api/lumi/feed';

async function fetchFeed(signal) {
  // Firebase token is auto-injected by api.js interceptor
  // IMPORTANT: Always return real data, even if campaigns = [].
  // Empty array = new user with no uploads → show empty state, NOT demo data.
  // Demo data leaking to authenticated users creates false positives and erodes trust.
  const res = await api.get(PRIMARY, { signal });
  return res.data ?? { campaigns: [] };
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

  // Memoized so the provider value is referentially stable across renders —
  // a fresh object literal here would re-render every consumer on each render.
  // setCampaigns is a stable useState setter; load is a stable useCallback.
  const contextValue = useMemo(
    () => ({ campaigns, loading, error, refetch: load, setCampaigns }),
    [campaigns, loading, error, load],
  );

  return (
    <CampaignFeedCtx.Provider value={contextValue}>
      {children}
    </CampaignFeedCtx.Provider>
  );
}

export function useCampaignFeedContext() {
  const ctx = useContext(CampaignFeedCtx);
  if (!ctx) throw new Error('useCampaignFeedContext must be used inside CampaignFeedProvider');
  return ctx;
}
