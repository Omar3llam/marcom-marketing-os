// ============================================================
// One Decision, read as a destination (C-11, B8-04)
// ------------------------------------------------------------
// `GET /api/lumi/decisions/:id` answers with THREE different refusals, and they
// are not interchangeable:
//
//   404  no such row in this workspace          → NOT_REACHABLE (nothing to open)
//   409  the row exists and is not a destination → NOT_SUPPORTED (ALLOCATION, or
//        (`NotADecisionDestination`)               a row with no class at all)
//   500  the read failed                         → NOT_REACHABLE
//
// C-11 chose 409 over 404 deliberately: the row EXISTS, and saying "not found"
// would be a false statement about the account — the defect class C-03 and C-07
// exist to end. This hook keeps the three apart so the surface can too.
//
// B8-02's ruling: a failure is a MEASURED state. Reported, never converted into
// an empty decision.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { api } from '@/lib/api.js';
import { KNOWLEDGE } from '@marcom/runtime-contracts';
import { DecisionDetailResponseSchema } from '@/contracts/schemas/decisionDetail.schema';

/** Why this decision could not be shown, in C-06's vocabulary. */
export const DETAIL_REFUSAL = Object.freeze({
  NOT_FOUND:       'NOT_FOUND',
  NOT_DESTINATION: 'NOT_DESTINATION',
  UNREADABLE:      'UNREADABLE',
});

/** PURE: the C-06 token a refusal carries, for `absenceState()`. */
export function knowledgeOfRefusal(refusal) {
  switch (refusal) {
    // "The question does not apply here" — an allocation plan is not a Decision
    // with a destination, and no amount of retrying changes that.
    case DETAIL_REFUSAL.NOT_DESTINATION: return KNOWLEDGE.CANNOT_ASK;
    // "We could not establish the truth — the read failed, or no record of it
    // exists." Covers both the missing row and the failed read: in neither case
    // did we learn anything about the decision.
    case DETAIL_REFUSAL.NOT_FOUND:
    case DETAIL_REFUSAL.UNREADABLE:  return KNOWLEDGE.COULD_NOT_LOOK;
    default: return null;
  }
}

export function useDecisionDetail(id) {
  const [decision, setDecision] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!id) { setIsLoading(false); setRefusal(DETAIL_REFUSAL.NOT_FOUND); return; }
    setIsLoading(true);
    setRefusal(null);
    try {
      const res = await api.get(`/api/lumi/decisions/${encodeURIComponent(id)}`);
      if (!aliveRef.current) return;

      const parsed = DecisionDetailResponseSchema.safeParse(res.data);
      if (!parsed.success) {
        // A shape we cannot read is not a decision we can show. C-04: a field on
        // the wire is not a field the client has.
        setDecision(null);
        setRefusal(DETAIL_REFUSAL.UNREADABLE);
        return;
      }
      setDecision(parsed.data.decision);
    } catch (err) {
      if (!aliveRef.current) return;
      if (axios.isCancel?.(err) || err?.name === 'CanceledError') return;
      // B8-05 — `httpStatus` FIRST. `api.js` rejects with `mapTransportError`'s
      // AppError, which carries `httpStatus` and has no `response` at all, so
      // reading only `err.response.status` made this `undefined` on every real
      // request and collapsed all three refusals into UNREADABLE — undoing
      // C-11's deliberate 409. `useIncrementality` already read it this way.
      // Proved by `useExperimentDetail.test.js`, which drives THIS hook against
      // the shape the api client actually throws.
      const status = err?.httpStatus ?? err?.response?.status;
      setDecision(null);
      if (status === 404) setRefusal(DETAIL_REFUSAL.NOT_FOUND);
      else if (status === 409) setRefusal(DETAIL_REFUSAL.NOT_DESTINATION);
      else setRefusal(DETAIL_REFUSAL.UNREADABLE);
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  return { decision, refusal, isLoading, refetch: load };
}
