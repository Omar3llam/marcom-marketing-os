// ============================================================
// MARCOM / Lumi — useHome (Phase 9 · the unified two-band home)
// ------------------------------------------------------------
// GET /api/lumi/home → the agentic OS shell payload: a buyer band ("what needs
// a decision today"), a strategist band ("how the portfolio tracks to goal"),
// and the closed-loop status — all composed + role-scoped by the backend
// (AgentHomeService). This hook only fetches, validates against the contract,
// and surfaces honest states. It NEVER executes anything — the shell is read +
// navigate + propose; confirmation rides the existing /api/execute/meta path.
//
// CLIENT note: the API returns `buyerBand: null` for a CLIENT seat — the schema
// allows it and the view simply omits that band.
//
// Staleness: the backend runs an on-read sweep when its last LoopRun is older
// than the loop interval, so a fetched home is usually fresh. If a sweep was
// skipped (best-effort) we still RENDER the last picture and flag `isStale`
// rather than blocking — the next focus/refetch (or the cron) refreshes it.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { AgentHomeSchema } from '@/contracts/schemas';

// Stale when the loop last ran longer ago than its own interval. Honest, derived
// purely from the returned timestamps — never fabricated.
export function computeStale(loop) {
  if (!loop?.lastRunAt || !loop?.intervalMs) return false;
  return Date.now() - new Date(loop.lastRunAt).getTime() > loop.intervalMs;
}

export function useHome() {
  const [home, setHome] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!aliveRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/home');
      if (!aliveRef.current) return;
      const parsed = AgentHomeSchema.safeParse(res.data);
      if (parsed.success) setHome(parsed.data);
      else { setHome(null); setError(new Error('Home response failed contract validation')); }
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err);
      setHome(null);
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  // No polling — the cron sweeps every 15min. A refetch when the tab regains
  // focus is enough to pick up a sweep that ran while the operator was away.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  return { home, isStale: computeStale(home?.loop), isLoading, error, refetch: load };
}
