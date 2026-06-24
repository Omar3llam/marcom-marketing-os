// ============================================================
// MARCOM / Lumi — usePendingOutcomes (Phase X · the manual-entry queue)
// ------------------------------------------------------------
// GET /api/lumi/decisions/pending-outcomes → EXECUTED decisions still missing an
// outcome + the workspace currency. Validated against
// PendingOutcomesResponseSchema. Returns { decisions, currency, loading, error,
// refetch } — `refetch` lets the panel refresh after a successful record so the
// just-recorded decision drops off the list.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { PendingOutcomesResponseSchema } from '@/contracts/schemas';

export function usePendingOutcomes() {
  const [state, setState] = useState({ decisions: [], currency: 'USD', loading: true, error: null });

  const load = useCallback(async (signal) => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await api.get('/api/lumi/decisions/pending-outcomes');
      if (signal?.aborted) return;
      const parsed = PendingOutcomesResponseSchema.safeParse(res.data);
      if (!parsed.success) {
        setState({ decisions: [], currency: 'USD', loading: false, error: new Error('Pending-outcomes response failed contract validation') });
        return;
      }
      setState({ decisions: parsed.data.decisions, currency: parsed.data.currency, loading: false, error: null });
    } catch (err) {
      if (signal?.aborted) return;
      setState({ decisions: [], currency: 'USD', loading: false, error: err });
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
