// ============================================================
// MARCOM / Lumi — useEconomics (Phase 4-D · unit economics)
// ------------------------------------------------------------
// GET /api/lumi/economics → validate against EconomicsAssessmentSchema →
// { data, loading, error, refetch }. The assessment is computed by the backend
// ONLY when economics are asserted (not seeded defaults) AND a real current CAC
// exists; otherwise `data.reason` (NOT_CONFIGURED | NO_CONVERSIONS) tells the
// surface to stay honest-empty. The CAC here is the account's CURRENT realized
// CAC — distinct from a plan's projected CAC; the client never re-derives it.
//
// useSaveEconomics(): PUT the asserted inputs (AOV, margin, …). A guardrail-style
// user-asserted real number — its truth is that the user owns it.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api.js';
import { EconomicsAssessmentSchema } from '@/contracts/schemas/unitEconomics.schema';

export function useEconomics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/economics');
      if (!aliveRef.current) return;
      const parsed = EconomicsAssessmentSchema.safeParse(res.data);
      if (parsed.success) {
        setData(parsed.data);
      } else {
        setData(null);
        setError(new Error('Economics response failed contract validation'));
      }
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

  return { data, loading, error, refetch };
}

export function useSaveEconomics() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = useCallback(async (inputs) => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.put('/api/lumi/economics', inputs);
      return res.data;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  return { save, saving, error };
}
