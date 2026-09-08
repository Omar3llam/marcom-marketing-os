// ============================================================
// MARCOM / Lumi — usePlans (Phase 6A · forward-looking plans)
// ------------------------------------------------------------
// GET  /api/lumi/plans       → { workspaceId, plans }  — list (each row carries
//                              its goals; NOT live tracking).
// POST /api/lumi/plans       → 201 { workspaceId, plan } — build a plan
//                              (totalBudgetMinor + period; optional name/change/goal).
// GET  /api/lumi/plans/:id    → { workspaceId, plan } — plan + LIVE tracking, where
//                              tracking.goals[].landing is the goal-tracker estimate
//                              (a RANGE {low,expected,high} — never a point).
// POST /api/lumi/plans/:id/promote → 201 { planId, allocationPlanId, decisionsCreated,
//                                          outcome, promotedAt } — 200 on a repeat,
//   where nothing was created. `outcome` is the fact; promotionCopy owns the words.
//                              — mix → PROPOSED REALLOCATE Decisions (STRATEGIST).
//                              Blocked 409 ApprovalRequired if the plan's gate is open.
// POST /api/lumi/approvals    → 201 { request } — open the approval gate on a plan
//                              (Phase 6B; BUYER/STRATEGIST). Sets requiresApproval+PENDING.
//
// Every plan is validated against the existing PlanSchema; a row that fails the
// contract is dropped rather than rendered as junk. Create + promote are
// STRATEGIST-gated server-side; the view also gates the affordances.
//
// Returns { plans, isLoading, error, createPlan, isCreating, getPlan,
//           promotePlan, promotingId }.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api.js';
import { PlanSchema } from '@/contracts/schemas/plan.schema';
import { readRows } from '@/lib/rowIntegrity.js';

export function usePlans() {
  const [plans, setPlans] = useState([]);
  /** Positional: every row that arrived, readable or not. See lib/rowIntegrity. */
  const [planRows, setPlanRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [promotingId, setPromotingId] = useState(null);
  const [submittingId, setSubmittingId] = useState(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/plans');
      if (!aliveRef.current) return;
      // Tier 2b — every row survives, readable or not. A missing or renamed
      // collection is not an empty one.
      const read = readRows(PlanSchema, res.data?.plans);
      if (!read.ok) {
        setPlans([]); setPlanRows([]);
        setError(new Error('Plans response failed contract validation'));
        return;
      }
      setPlans(read.readable);
      setPlanRows(read.entries);
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

  // Guard the required shape (totalBudgetMinor + both period bounds) before POST.
  const createPlan = useCallback(async (input) => {
    if (
      typeof input?.totalBudgetMinor !== 'number' || !Number.isFinite(input.totalBudgetMinor) ||
      input.totalBudgetMinor <= 0 || !input?.periodStart || !input?.periodEnd
    ) {
      return null;
    }
    setIsCreating(true);
    setError(null);
    try {
      const res = await api.post('/api/lumi/plans', input);
      const created = res.data?.plan ?? null;
      await refetch();
      return created;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [refetch]);

  // Fetch one plan WITH live tracking (the landing estimate). Validated; returns
  // null on contract failure rather than a half-trusted object.
  const getPlan = useCallback(async (planId) => {
    if (!planId) return null;
    try {
      const res = await api.get(`/api/lumi/plans/${planId}`);
      const r = PlanSchema.safeParse(res.data?.plan);
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  }, []);

  // Submit a plan for STRATEGIST sign-off (Phase 6B). Opens the approval gate
  // (POST /approvals → Plan.requiresApproval=true, approvalState=PENDING). NO
  // optimistic update — approval is a governance action; we wait for the API and
  // refetch so the plan's reflected state is what the server actually wrote.
  const submitForApproval = useCallback(async (planId) => {
    if (!planId) return null;
    setSubmittingId(planId);
    setError(null);
    try {
      const res = await api.post('/api/lumi/approvals', { planId });
      await refetch();
      toast.success('Plan submitted for approval.');
      return res.data?.request ?? null;
    } catch (err) {
      setError(err);
      toast.error(err?.response?.data?.message || 'Couldn’t submit this plan for approval.');
      return null;
    } finally {
      setSubmittingId(null);
    }
  }, [refetch]);

  const promotePlan = useCallback(async (planId) => {
    if (!planId) return null;
    setPromotingId(planId);
    setError(null);
    try {
      const res = await api.post(`/api/lumi/plans/${planId}/promote`);
      await refetch(); // status flips DRAFT → ACTIVE on promote
      return res.data ?? null; // { planId, allocationPlanId, decisionsCreated }
    } catch (err) {
      setError(err);
      // The backend gate (409 ApprovalRequired) is the real arbiter — surface it
      // as a clear, actionable message, not a generic failure.
      if (err?.response?.status === 409 && err.response.data?.error === 'ApprovalRequired') {
        toast.error('This plan requires approval before it can be executed. Submit it for STRATEGIST review.');
      } else {
        toast.error(err?.response?.data?.message || 'Couldn’t promote this plan right now.');
      }
      return null;
    } finally {
      setPromotingId(null);
    }
  }, [refetch]);

  return { plans, planRows, isLoading, error, createPlan, isCreating, getPlan, promotePlan, promotingId, submitForApproval, submittingId };
}
