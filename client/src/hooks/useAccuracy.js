// ============================================================
// MARCOM / Lumi — useAccuracy (Phase 11A · the Proof Engine surface)
// ------------------------------------------------------------
// GET /api/lumi/accuracy → validate against DecisionAccuracySchema (+ the gated
// AccuracySurfaceSchema one-liner) → { data, surface, loading, error }. The
// `surface` is the backend's pre-computed RELIABLE gate — the client must NEVER
// re-derive a calibration claim; it renders what the gate allows.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { DecisionAccuracySchema, AccuracySurfaceSchema } from '@/contracts/schemas';

export function useAccuracy() {
  const [state, setState] = useState({ data: null, surface: null, loading: true, error: null });

  const attemptRef = useRef(0);
  const aliveRef = useRef(true);

  const load = useCallback(async (signal) => {
    if (!aliveRef.current) return;
    const attempt = ++attemptRef.current;
    setState({ data: null, surface: null, loading: true, error: null });
    try {
      const res = await api.get('/api/lumi/accuracy');
      if (signal?.aborted || !aliveRef.current || attempt !== attemptRef.current) return;
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
      if (signal?.aborted || !aliveRef.current || attempt !== attemptRef.current) return;
      setState({ data: null, surface: null, loading: false, error: err });
    }
  }, []);

  useEffect(() => {
    const attempts = attemptRef;
    aliveRef.current = true;
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => { aliveRef.current = false; ++attempts.current; ctrl.abort(); };
  }, [load]);

  const refetch = useCallback(() => load(), [load]);

  return { ...state, refetch };
}
