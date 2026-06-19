// ============================================================
// MARCOM / Lumi — useConnectorVerdicts
// ------------------------------------------------------------
// Reads GET /api/lumi/entities/verdicts: the verdict engine run over the live
// connector campaigns that have MEASURED revenue. Campaigns without measured
// revenue come back in `gatedOut` (never scored) so the UI can show an honest
// "needs revenue data" state instead of a fabricated KILL.
//
// Returns: { verdicts, gatedOut, account, status, loading, error, refetch }
//   verdicts[]: { id, name, verdict, confidence, rationale, spendMinor, roas }
//   gatedOut[]: { id, name, reason }
//
// Disjoint from the CSV feed (useCampaignFeed) and from useConnectorCampaigns —
// this hook adds the engine verdict on top of the same connector substrate.
// useEffect has a cleanup guard (no setState after unmount) per the ONE WAY rules.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';

export function useConnectorVerdicts() {
  const [verdicts, setVerdicts] = useState([]);
  const [gatedOut, setGatedOut] = useState([]);
  const [account, setAccount] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/entities/verdicts');
      if (!aliveRef.current) return;
      setVerdicts(Array.isArray(res.data?.verdicts) ? res.data.verdicts : []);
      setGatedOut(Array.isArray(res.data?.gatedOut) ? res.data.gatedOut : []);
      setAccount(res.data?.account ?? null);
      setStatus(res.data?.status ?? null);
    } catch (err) {
      if (!aliveRef.current) return;
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

  return { verdicts, gatedOut, account, status, loading, error, refetch };
}
