// ============================================================
// MARCOM / Lumi — useAccuracy (Phase 11A · the Proof Engine surface)
// ------------------------------------------------------------
// GET /api/lumi/accuracy → validate against DecisionAccuracySchema (+ the gated
// AccuracySurfaceSchema one-liner) → { data, surface, loading, error }. The
// `surface` is the backend's pre-computed RELIABLE gate — the client must NEVER
// re-derive a calibration claim; it renders what the gate allows.
// ============================================================
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { DecisionAccuracySchema, AccuracySurfaceSchema } from '@/contracts/schemas';

export function useAccuracy() {
  const [state, setState] = useState({ data: null, surface: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/api/lumi/accuracy');
        if (cancelled) return;
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
        if (cancelled) return;
        setState({ data: null, surface: null, loading: false, error: err });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
