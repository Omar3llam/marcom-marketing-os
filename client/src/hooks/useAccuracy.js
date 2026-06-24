// ============================================================
// MARCOM / Lumi — useAccuracy (Phase 11A · the Proof Engine surface)
// ------------------------------------------------------------
// GET /api/lumi/accuracy → validate against DecisionAccuracySchema (+ the gated
// AccuracySurfaceSchema one-liner) → { data, surface, loading, error }. The
// `surface` is the backend's pre-computed RELIABLE gate — the client must NEVER
// re-derive a calibration claim; it renders what the gate allows.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { DecisionAccuracySchema, AccuracySurfaceSchema } from '@/contracts/schemas';

export function useAccuracy() {
  const [state, setState] = useState({ data: null, surface: null, loading: true, error: null });

  const load = useCallback(async (signal) => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await api.get('/api/lumi/accuracy');
      if (signal?.aborted) return;
      const core = DecisionAccuracySchema.safeParse({
        accountLift: res.data?.accountLift,
        calibration: res.data?.calibration,
        velocity: res.data?.velocity,
        coverage: res.data?.coverage,
      });
      const surface = AccuracySurfaceSchema.safeParse(res.data?.surface);
      if (!core.success || !surface.success) {
        setState({ data: null, surface: null, loading: false, error: new Error('Accuracy response failed contract validation') });
        return;
      }
      setState({ data: core.data, surface: surface.data, loading: false, error: null });
    } catch (err) {
      if (signal?.aborted) return;
      setState({ data: null, surface: null, loading: false, error: err });
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const refetch = useCallback(() => load(), [load]);

  return { ...state, refetch };
}
