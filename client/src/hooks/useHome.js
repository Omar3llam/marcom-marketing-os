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
import { READ, isNoWorkspaceError, readStatusForError, isRetryableReadError } from '@/design-system/states/readStatus.js';
import { api } from '@/lib/api.js';
import { AgentHomeSchema } from '@/contracts/schemas';

// Stale when the loop last ran longer ago than its own interval. Honest, derived
// purely from the returned timestamps — never fabricated.
export function computeStale(loop) {
  if (!loop?.lastRunAt || !loop?.intervalMs) return false;
  return Date.now() - new Date(loop.lastRunAt).getTime() > loop.intervalMs;
}

/** Keep access/configuration evidence separate from the validated Home payload. */
export function homeReadState({ home, isLoading, error }) {
  if (isLoading) return { status: READ.LOADING, reason: null };
  if (!error) return { status: home ? READ.PRESENT : READ.NOT_REACHABLE, reason: null };
  if (isNoWorkspaceError(error)) return { status: READ.NOTHING_FOUND, reason: 'NoWorkspace' };
  const httpStatus = error.httpStatus ?? error.response?.status;
  const code = error.response?.data?.error ?? error.code;
  if (httpStatus === 409 && code === 'RoleNotConfigured') {
    return { status: READ.NOTHING_FOUND, reason: 'ROLE_UNSET' };
  }
  const status = readStatusForError(error);
  const roleReason = error.context?.roleReason ?? error.response?.data?.roleReason;
  return { status, reason: status === READ.NOT_PERMITTED ? null : roleReason ?? null };
}

export function useHome() {
  const [home, setHome] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);
  const attemptRef = useRef(0);

  const load = useCallback(async () => {
    if (!aliveRef.current) return;
    const attempt = ++attemptRef.current;
    setHome(null);
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/home');
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      const parsed = AgentHomeSchema.safeParse(res.data);
      if (parsed.success) setHome(parsed.data);
      else { setHome(null); setError(new Error('Home response failed contract validation')); }
    } catch (err) {
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      setError(err);
      setHome(null);
    } finally {
      if (aliveRef.current && attempt === attemptRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const attempts = attemptRef;
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; ++attempts.current; };
  }, [load]);

  // No polling — the cron sweeps every 15min. A refetch when the tab regains
  // focus is enough to pick up a sweep that ran while the operator was away.
  useEffect(() => {
    const onFocus = () => { if (!error || isRetryableReadError(error)) load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, error]);

  return { home, isStale: computeStale(home?.loop), isLoading, error,
    ...homeReadState({ home, isLoading, error }), refetch: load };
}
