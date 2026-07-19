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
// A 403 (CLIENT role) is treated as "no health to show" → null, not an error toast.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';

export function useAccountHealth() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/entities/health');
      if (!aliveRef.current) return;
      setHealth(res.data ?? null);
    } catch (err) {
      if (!aliveRef.current) return;
      // 403 = this role can't see the efficiency critique → show "—", not an error.
      // AppError carries .httpStatus; fall back to raw .response.status (un-mapped path).
      const status = err?.httpStatus ?? err?.response?.status;
      if (status === 403) { setHealth(null); return; }
      setError(err);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refetch();
    return () => { aliveRef.current = false; };
  }, [refetch]);

  return { health, loading, error, refetch };
}
