// ============================================================
// MARCOM / Lumi — useAccountAggregate  (PARITY-01)
// ------------------------------------------------------------
// GET /api/lumi/account/aggregate → validate against
// AccountAggregateResponseSchema → { response, loading, error, forbidden }.
//
// THE CANONICAL ACCOUNT AGGREGATE. Until this hook, the endpoint had been
// served, role-gated and DB-tested with zero client callers, while Attention and
// Campaigns each summed the campaign rows themselves — and disagreed. Reading
// the answer is the whole point: `lib/accountAggregate.js` turns what comes back
// into what a card renders, and both surfaces use that one reading.
//
// A 403 is reported SEPARATELY from a failure. The endpoint is BUYER|STRATEGIST
// and both surfaces are already closed to a CLIENT seat, but `LockFromClient`
// renders its children while the role resolves — so the refusal is briefly
// reachable, and "you may not read this" is a different sentence from "we could
// not read this". Same rule useIncrementality follows for its own tier gate.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { AccountAggregateResponseSchema } from '@/contracts/schemas';

const EMPTY = { response: null, loading: true, error: null, forbidden: false };

export function useAccountAggregate() {
  const [state, setState] = useState(EMPTY);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null, forbidden: false }));
    (async () => {
      try {
        const res = await api.get('/api/lumi/account/aggregate');
        if (cancelled) return;
        const parsed = AccountAggregateResponseSchema.safeParse(res.data);
        if (!parsed.success) {
          // Contract drift is surfaced, never hidden behind an empty state —
          // a payload we cannot read is a failure, not an account with nothing
          // in it.
          setState({
            response: null,
            loading: false,
            error: new Error('Account aggregate response failed contract validation'),
            forbidden: false,
          });
          return;
        }
        setState({ response: parsed.data, loading: false, error: null, forbidden: false });
      } catch (err) {
        if (cancelled) return;
        if (err?.response?.status === 403) {
          setState({ response: null, loading: false, error: null, forbidden: true });
          return;
        }
        setState({ response: null, loading: false, error: err, forbidden: false });
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return { ...state, refetch };
}
