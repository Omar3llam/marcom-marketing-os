// ============================================================
// MARCOM / Lumi — useBlendedTruth (Phase 11A)
// ------------------------------------------------------------
// GET /api/lumi/blended → validate against BlendedTruthSchema → { data, loading,
// error }. Schema is the source of truth: a parse failure surfaces as `error`,
// never a silent wrong render. Typed api client only (no raw fetch).
// ============================================================
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { BlendedTruthSchema } from '@/contracts/schemas';

export function useBlendedTruth() {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/api/lumi/blended');
        if (cancelled) return;
        const parsed = BlendedTruthSchema.safeParse({
          channels: res.data?.channels ?? [],
          portfolio: res.data?.portfolio ?? null,
        });
        if (!parsed.success) {
          setState({ data: null, loading: false, error: new Error('Blended-truth response failed contract validation') });
          return;
        }
        setState({ data: parsed.data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ data: null, loading: false, error: err });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
