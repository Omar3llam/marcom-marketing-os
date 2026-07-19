// ============================================================
// MARCOM / Lumi — useBlendedTruth (Phase 11A)
// ------------------------------------------------------------
// GET /api/lumi/blended → validate against BlendedTruthSchema → { data, loading,
// error, gated }. Schema is the source of truth: a parse failure surfaces as
// `error`, never a silent wrong render. Typed api client only (no raw fetch).
//
// THE PRODUCT SEAM: /blended is requirePlan('GROWTH') server-side. A 403 is NOT
// an error — it's an honest LOCKED state (`gated`), so the view renders an
// upgrade prompt rather than a failure. Detection mirrors useIncrementality
// exactly (err?.response?.status === 403 → gated=true, error=null — never both).
// ============================================================
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { BlendedTruthSchema } from '@/contracts/schemas';

export function useBlendedTruth() {
  const [state, setState] = useState({ data: null, loading: true, error: null, gated: false });

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
          setState({ data: null, loading: false, error: new Error('Blended-truth response failed contract validation'), gated: false });
          return;
        }
        setState({ data: parsed.data, loading: false, error: null, gated: false });
      } catch (err) {
        if (cancelled) return;
        // 403 = tier-gated. An honest locked state, not a failure.
        if (err?.response?.status === 403) { setState({ data: null, loading: false, error: null, gated: true }); return; }
        setState({ data: null, loading: false, error: err, gated: false }); // clear stale lock on a real failure
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
