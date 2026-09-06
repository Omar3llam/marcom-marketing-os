// ============================================================
// THE THEN DESTINATION — one page of decision history (B8-03)
// ------------------------------------------------------------
// Reads `GET /api/lumi/decisions`, the destination's OWN list. Not
// `/decisions/recent`, which is the sidebar's capped SIGNAL-only strip.
//
// B8-02's ruling holds here: a failure is a MEASURED state. This hook reports
// it and empties the page beside it — never instead of it — so a caller can
// tell "this workspace has decided nothing" from "we could not read it".
// `total` is carried separately from `decisions.length` for the same reason the
// backend counts it: a capped list is not a capped count.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';
import { DecisionHistoryPageSchema } from '@/contracts/schemas/decision.schema';

export function useDecisionHistory({ limit } = {}) {
  const [decisions, setDecisions] = useState([]);
  const [total, setTotal] = useState(null);      // null = not yet established
  const [nextCursor, setNextCursor] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const aliveRef = useRef(true);

  const load = useCallback(async (cursor = null, { append = false } = {}) => {
    setIsLoading(true);
    if (!append) setError(null);
    try {
      const res = await api.get('/api/lumi/decisions', {
        params: { ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}) },
      });
      if (!aliveRef.current) return;

      const parsed = DecisionHistoryPageSchema.safeParse(res.data);
      if (!parsed.success) {
        // A shape we cannot read is not an empty history. C-04's lesson: a
        // field on the wire is not a field the client has, and the honest
        // report is that the read did not land.
        setError(new Error('Decision history failed contract validation'));
        setDecisions([]); setTotal(null); setNextCursor(null);
        return;
      }

      setDecisions((prev) => (append ? [...prev, ...parsed.data.decisions] : parsed.data.decisions));
      setTotal(parsed.data.total);
      setNextCursor(parsed.data.nextCursor);
    } catch (err) {
      if (!aliveRef.current) return;
      if (axios.isCancel?.(err) || err?.name === 'CanceledError') return;
      setError(err);
      // Emptied BESIDE the error. Rows left under a failure banner would assert
      // that this is the history right now, which is what we just failed to read.
      setDecisions([]); setTotal(null); setNextCursor(null);
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, [limit]);

  /** Fetch the next page and APPEND it. No-op when there is no next page. */
  const loadMore = useCallback(() => {
    if (!nextCursor) return undefined;
    return load(nextCursor, { append: true });
  }, [load, nextCursor]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  return {
    decisions,
    total,
    hasMore: nextCursor !== null,
    isLoading,
    error,
    loadMore,
    refetch: () => load(),
  };
}
