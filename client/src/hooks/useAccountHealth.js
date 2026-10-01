// ============================================================
// MARCOM / Lumi — useAccountHealth
// ------------------------------------------------------------
// Reads GET /api/lumi/entities/health: the deterministic analysis engine
// (Wasted Spend + Account Health + per-campaign Impact) run over the live
// connector campaigns. Every number traces to a MetricSnapshot row via the
// verdict engine — no connector data → honest nulls, never a fabricated 0.
//
// Returns: { health, loading, error, refetch }
//   health = { score, label, wastedSpend: { minor, pct }, campaigns: [{ entityId, impactScore, verdict }] }
//            (score/label/wastedSpend.* are null when nothing can be scored)
//
// Disjoint from useConnectorCampaigns/useConnectorVerdicts — this hook adds the
// scored roll-up on top of the same substrate. Cleanup guard per the ONE WAY rules.
// A 403 (CLIENT role) is permission absence: null health, forbidden=true, no
// error toast. Overview uses that flag to avoid mistaking another role's 403
// for successful empty scoring.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';

export function useAccountHealth() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const aliveRef = useRef(true);
  const attemptRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!aliveRef.current) return;
    const attempt = ++attemptRef.current;
    setHealth(null);
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await api.get('/api/lumi/entities/health');
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      setHealth(res.data ?? null);
    } catch (err) {
      if (!aliveRef.current || attempt !== attemptRef.current) return;
      // 403 = this role can't see the efficiency critique → show "—", not an error.
      // AppError carries .httpStatus; fall back to raw .response.status (un-mapped path).
      const status = err?.httpStatus ?? err?.response?.status;
      if (status === 403) { setHealth(null); setForbidden(true); return; }
      setError(err);
    } finally {
      if (aliveRef.current && attempt === attemptRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const attempts = attemptRef;
    aliveRef.current = true;
    refetch();
    return () => { aliveRef.current = false; ++attempts.current; };
  }, [refetch]);

  return { health, loading, error, forbidden, refetch };
}
