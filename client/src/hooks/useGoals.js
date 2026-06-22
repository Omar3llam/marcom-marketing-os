// ============================================================
// MARCOM / Lumi — useGoals (Phase 6A · north-star goals)
// ------------------------------------------------------------
// GET  /api/lumi/goals → { workspaceId, goals } — the raw NorthStarGoal rows.
//   Each row is validated against NorthStarGoalSchema; a row that fails the
//   contract is dropped rather than rendered as junk (never fabricate a goal).
// POST /api/lumi/goals → 201 { workspaceId, goal } — create one. STRATEGIST-
//   gated server-side (requireStrategist); the view also gates the form, so a
//   BUYER never sees the create affordance and the server stays the arbiter.
//
// NOTE: GET /goals returns the STORED status only — the goal-tracker landing
// estimate runs ONLY for plan-attached goals (GET /plans/:id). Standalone goals
// here surface their persisted status, not a recomputed landing — honest by
// construction, no fabricated projection.
//
// Returns { goals, isLoading, error, createGoal, isCreating, refetch }.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api.js';
import { NorthStarGoalSchema } from '@/contracts/schemas/plan.schema';

export function useGoals() {
  const [goals, setGoals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/goals');
      if (!aliveRef.current) return;
      const raw = Array.isArray(res.data?.goals) ? res.data.goals : [];
      const parsed = [];
      for (const g of raw) {
        const r = NorthStarGoalSchema.safeParse(g);
        if (r.success) parsed.push(r.data);
      }
      setGoals(parsed);
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

  // Guard the payload against the backend's required shape before POSTing —
  // metric, comparator, a finite targetValue, and both period bounds.
  const createGoal = useCallback(async (input) => {
    if (
      !input?.metric || !input?.comparator ||
      typeof input?.targetValue !== 'number' || !Number.isFinite(input.targetValue) ||
      !input?.periodStart || !input?.periodEnd
    ) {
      return null;
    }
    setIsCreating(true);
    setError(null);
    try {
      const res = await api.post('/api/lumi/goals', input);
      const created = res.data?.goal ?? null;
      await refetch(); // re-read so the new goal appears with its persisted status
      return created;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [refetch]);

  return { goals, isLoading, error, createGoal, isCreating, refetch };
}
