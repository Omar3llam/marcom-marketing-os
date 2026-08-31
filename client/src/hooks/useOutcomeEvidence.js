// ============================================================
// MARCOM / Lumi — useOutcomeEvidence (B5-01X' · the READ side of review)
// ------------------------------------------------------------
// GET /api/lumi/decisions/:id/outcome-evidence → what Lumi observed over the
// comparison policy's baseline and observation windows, validated against
// OutcomeEvidenceResponseSchema.
//
// FETCHED PER DECISION, ON DEMAND. The panel opens one decision at a time, and
// the evidence read is one query per decision — folding it into the pending
// list would turn the queue into an N+1. Passing a null id fetches nothing, so
// a closed form costs no request.
//
// It returns EVIDENCE, never a judgement. Nothing here decides whether the
// decision worked; the operator still records that through useRecordOutcome.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { OutcomeEvidenceResponseSchema } from '@/contracts/schemas';

const IDLE = { evidence: null, loading: false, error: null };

export function useOutcomeEvidence(decisionId) {
  const [state, setState] = useState(IDLE);

  const load = useCallback(async (id, signal) => {
    if (!id) { setState(IDLE); return; }
    setState({ evidence: null, loading: true, error: null });
    try {
      const res = await api.get(`/api/lumi/decisions/${id}/outcome-evidence`);
      if (signal?.aborted) return;
      const parsed = OutcomeEvidenceResponseSchema.safeParse(res.data);
      if (!parsed.success) {
        // A response that does not match the contract is not evidence. Showing
        // whatever arrived would put unvalidated numbers in front of an operator
        // about to record an outcome from them.
        setState({ evidence: null, loading: false, error: new Error('Outcome-evidence response failed contract validation') });
        return;
      }
      setState({ evidence: parsed.data, loading: false, error: null });
    } catch (err) {
      if (signal?.aborted) return;
      setState({ evidence: null, loading: false, error: err });
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(decisionId, ctrl.signal);
    return () => ctrl.abort();
  }, [decisionId, load]);

  return state;
}
