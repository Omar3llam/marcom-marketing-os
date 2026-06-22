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
// POST /api/lumi/plans/:id/promote → 201 { planId, allocationPlanId, decisionsCreated }
//                              — mix → PROPOSED REALLOCATE Decisions (STRATEGIST).
//
// Every plan is validated against the existing PlanSchema; a row that fails the
// contract is dropped rather than rendered as junk. Create + promote are
// STRATEGIST-gated server-side; the view also gates the affordances.
//
// Returns { plans, isLoading, error, createPlan, isCreating, getPlan,
//           promotePlan, promotingId }.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api.js';
import { PlanSchema } from '@/contracts/schemas/plan.schema';

export function usePlans() {
  const [plans, setPlans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [promotingId, setPromotingId] = useState(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/plans');
      if (!aliveRef.current) return;
      const raw = Array.isArray(res.data?.plans) ? res.data.plans : [];
      const parsed = [];
      for (const p of raw) {
        const r = PlanSchema.safeParse(p);
        if (r.success) parsed.push(r.data);
      }
      setPlans(parsed);
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
      return null;
    } finally {
      setPromotingId(null);
    }
  }, [refetch]);

  return { plans, isLoading, error, createPlan, isCreating, getPlan, promotePlan, promotingId };
}
