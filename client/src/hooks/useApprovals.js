// ============================================================
// MARCOM / Lumi — useApprovals (Phase 6B · STRATEGIST decision queue)
// ------------------------------------------------------------
// GET  /api/lumi/approvals?state=PENDING → { approvals } — plans awaiting a
//       STRATEGIST decision (each row includes lightweight plan context).
// POST /api/lumi/approvals/:id/decide    → 201 { request } — APPROVED or
//       REJECTED (+ reason). "Request revision" in the UI is REJECTED + reason.
//
// Every row is validated against ApprovalRequestSchema; a row that fails the
// contract is dropped rather than rendered as junk. The decide endpoint is
// STRATEGIST-gated server-side; this hook is only mounted for a STRATEGIST.
//
// Returns { pendingApprovals, isLoading, error, decide, decidingId, refetch }.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api.js';
import { ApprovalRequestSchema } from '@/contracts/schemas/plan.schema';

export function useApprovals() {
  const [pendingApprovals, setPendingApprovals] = useState([]);
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
      const raw = Array.isArray(res.data?.approvals) ? res.data.approvals : [];
      const parsed = [];
      for (const a of raw) {
        const r = ApprovalRequestSchema.safeParse(a);
        if (r.success) parsed.push(r.data);
      }
      setPendingApprovals(parsed);
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

  return { pendingApprovals, isLoading, error, decide, decidingId, refetch };
}
