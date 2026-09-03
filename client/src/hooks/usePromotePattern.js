// ============================================================
// MARCOM / Lumi — usePromotePattern (C-05 · the autonomy authorization)
// ------------------------------------------------------------
// This hook used to be one call: POST /patterns/:id/promote → { ruleId }. One
// tap turned a learned pattern into a rule that judges the account from then
// on, with nothing recording who did it or what they believed at the time.
//
// R-13 split that into a proposal and a decision, and R-14 added a way back:
//
//   requestPromotion(patternId)   → { requestId }   files the authorization
//   grantPromotion(requestId)     → { ruleId }      creates the rule
//   revokePromotion(ruleId)       → { episodesClosed }
//
// Today the same STRATEGIST seat performs both halves — the server records that
// as `selfApproved` rather than dressing it up as a second pair of eyes — so the
// view holds the requestId between the two clicks. It is deliberately NOT a
// queue: there is no read of pending authorizations yet, so a page reload loses
// the local handle and the server answers a repeat request with `AlreadyPending`,
// which the caller surfaces as-is rather than hiding.
//
// WHAT THE GRANT ACTUALLY GIVES: authority to JUDGE and RAISE, never to act.
// The created rule writes PROPOSED decisions that still ride confirm→execute.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';

export function usePromotePattern() {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const call = useCallback(async (id, fn) => {
    if (!id) return null;
    setBusyId(id);
    setError(null);
    try {
      const res = await fn();
      return res.data;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setBusyId(null);
    }
  }, []);

  /** Propose that a pattern become a rule. Grants nothing. */
  const requestPromotion = useCallback((patternId) => call(patternId, () =>
    api.post(`/api/lumi/patterns/${patternId}/promotion-request`)), [call]);

  /** Grant the standing authority. This is the act that creates the rule. */
  const grantPromotion = useCallback((requestId) => call(requestId, () =>
    api.post(`/api/lumi/promotions/${requestId}/decision`, { decision: 'APPROVED' })), [call]);

  /** Withdraw it. The rule stops being evaluated; the record of the grant stays. */
  const revokePromotion = useCallback((ruleId) => call(ruleId, () =>
    api.post(`/api/lumi/guardrails/${ruleId}/revoke`)), [call]);

  return { requestPromotion, grantPromotion, revokePromotion, busyId, error };
}
