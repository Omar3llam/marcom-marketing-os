// ============================================================
// MARCOM / Lumi — useConnections (Phase 12)
// ------------------------------------------------------------
// GET /api/lumi/connections → validate against ConnectionsResponseSchema →
// { data, loading, error }. Display fields only (no tokens). Typed api client.
// ============================================================
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { ConnectionsResponseSchema } from '@/contracts/schemas';

export function useConnections() {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/api/lumi/connections');
        if (cancelled) return;
        const parsed = ConnectionsResponseSchema.safeParse(res.data);
        if (!parsed.success) {
          setState({ data: null, loading: false, error: new Error('Connections response failed contract validation') });
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
