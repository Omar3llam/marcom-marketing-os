// ============================================================
// MARCOM / Lumi — usePortfolio (UI-2 · pacing)
// ------------------------------------------------------------
// GET /api/lumi/portfolio → validate against PortfolioViewSchema →
// { data, loading, error }. The portfolio view carries the cross-channel
// blended totals, the per-channel + portfolio-wide pacing projection, and
// monthlyBudgetMinor — every field a real backing row (no fabrication).
// Mirrors the useConnections shape. Typed api client.
// ============================================================
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { PortfolioViewSchema } from '@/contracts/schemas/portfolio.schema';

export function usePortfolio() {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/api/lumi/portfolio');
        if (cancelled) return;
        const parsed = PortfolioViewSchema.safeParse(res.data);
        if (!parsed.success) {
          setState({ data: null, loading: false, error: new Error('Portfolio response failed contract validation') });
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
