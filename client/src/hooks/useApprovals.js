// ============================================================
// MARCOM / Lumi — useApprovals (Phase 6B · STRATEGIST decision queue)
// ------------------------------------------------------------
// GET  /api/lumi/approvals?state=PENDING → { approvals } — plans awaiting a
//       STRATEGIST decision (each row includes lightweight plan context).
// POST /api/lumi/approvals/:id/decide    → 201 { request } — APPROVED or
//       REJECTED (+ reason). "Request revision" in the UI is REJECTED + reason.
//
// Every row is validated against ApprovalRequestSchema. A row that fails is
// COUNTED as unreadable and kept out of the decidable collection — it is never
// dropped. These three lines used to end "dropped rather than rendered as junk",
// and that drop is what let a queue of unreadable rows render as "No plans
// awaiting your approval" while the plans sat PENDING on the server. Governance
// fails CLOSED: an authorization we cannot read is one we do not decide, and
// one the operator is told about. The decide endpoint is STRATEGIST-gated
// server-side; this hook is only mounted for a STRATEGIST.
//
// Returns { pendingApprovals, unreadableCount, isLoading, error, decide,
//           decidingId, refetch }.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api.js';
import { ApprovalRequestSchema } from '@/contracts/schemas/plan.schema';

export function useApprovals() {
  const [pendingApprovals, setPendingApprovals] = useState([]);
  /** How many PENDING authorizations exist that we could not read. Never merged
   *  into `pendingApprovals` — an unreadable item is not a decidable one. */
  const [unreadableCount, setUnreadableCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [decidingId, setDecidingId] = useState(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/approvals', { params: { state: 'PENDING' } });
      if (!aliveRef.current) return;
      // Tier 2a — the QUEUE itself. A collection we cannot find is not an empty
      // queue; it is a queue we failed to read, and it may not be presented as
      // "nothing is awaiting you".
      const raw = res.data?.approvals;
      if (!Array.isArray(raw)) {
        setPendingApprovals([]);
        setUnreadableCount(0);
        setError(new Error('Approvals response failed contract validation'));
        return;
      }

      // Tier 2a — an unreadable ROW is never an absent row. It stays counted as
      // EXISTING and stays out of the decidable collection: not dropped, and
      // not smuggled in with holes in it either. Governance fails CLOSED — the
      // authorization remains open on the server, and the queue says so rather
      // than quietly shortening itself by one.
      const parsed = [];
      let unreadable = 0;
      for (const a of raw) {
        const r = ApprovalRequestSchema.safeParse(a);
        if (r.success) parsed.push(r.data); else unreadable += 1;
      }
      setPendingApprovals(parsed);
      setUnreadableCount(unreadable);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err);
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refetch();
    return () => { aliveRef.current = false; };
  }, [refetch]);

  // Decide an approval. `decision` is 'APPROVED' | 'REJECTED'; a REJECTED
  // (request-revision) must carry a reason. No optimistic update — governance
  // waits for the server, then refetch so the queue reflects what was written.
  const decide = useCallback(async (requestId, decision, reason) => {
    if (!requestId || (decision !== 'APPROVED' && decision !== 'REJECTED')) return null;
    if (decision === 'REJECTED' && !reason?.trim()) return null;
    setDecidingId(requestId);
    setError(null);
    try {
      const res = await api.post(`/api/lumi/approvals/${requestId}/decide`, {
        decision,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      await refetch();
      toast.success(decision === 'APPROVED' ? 'Plan approved.' : 'Revision requested — the plan owner can revise and resubmit.');
      return res.data?.request ?? null;
    } catch (err) {
      setError(err);
      toast.error(err?.response?.data?.message || 'Couldn’t record that decision right now.');
      return null;
    } finally {
      setDecidingId(null);
    }
  }, [refetch]);

  return { pendingApprovals, unreadableCount, isLoading, error, decide, decidingId, refetch };
}
