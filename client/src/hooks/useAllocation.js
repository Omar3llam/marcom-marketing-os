// ============================================================
// MARCOM / Lumi — useAllocation (Phase 3 · capital allocation)
// ------------------------------------------------------------
// The preview-then-commit pair for cross-channel budget allocation:
//   POST /api/lumi/portfolio/allocate         → { plan } | { plan: null, message }
//   POST /api/lumi/portfolio/allocate/commit  → 201 { planId, decisionsCreated, plan }
// Preview is a pure projection (no writes); commit persists the AllocationPlan
// and mints PROPOSED REALLOCATE Decisions that STILL require human confirm
// through the existing /api/execute/meta path — it NEVER auto-executes.
//
// The preview is validated against the contract (AllocationPlanPreviewSchema)
// before it's trusted; a null plan (no connected channels) is surfaced honestly
// as previewNote, never a fabricated split. Commit is STRATEGIST-gated server-
// side; the view also gates the button.
//
// Returns the two actions + their independent in-flight / error / result state.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';
import { AllocationPlanPreviewSchema } from '@/contracts/schemas/allocationPlan.schema';

export function useAllocation() {
  const [plan, setPlan] = useState(null);          // validated AllocationPlanPreview | null
  const [previewNote, setPreviewNote] = useState(null); // honest "no channels" message
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const [committed, setCommitted] = useState(null); // { planId, decisionsCreated } | null
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState(null);

  const preview = useCallback(async ({ totalBudgetMinor, goal } = {}) => {
    setPreviewing(true);
    setPreviewError(null);
    setPreviewNote(null);
    setCommitted(null); // a fresh preview invalidates any prior commit confirmation
    try {
      const res = await api.post('/api/lumi/portfolio/allocate', { totalBudgetMinor, goal });
      const raw = res.data?.plan ?? null;
      if (!raw) {
        setPlan(null);
        setPreviewNote(res.data?.message || 'No connected channels to allocate.');
        return null;
      }
      const parsed = AllocationPlanPreviewSchema.safeParse(raw);
      if (!parsed.success) {
        setPlan(null);
        setPreviewError(new Error('Allocation preview failed contract validation'));
        return null;
      }
      setPlan(parsed.data);
      return parsed.data;
    } catch (err) {
      setPlan(null);
      setPreviewError(err);
      return null;
    } finally {
      setPreviewing(false);
    }
  }, []);

  const commit = useCallback(async ({ totalBudgetMinor, goal } = {}) => {
    setCommitting(true);
    setCommitError(null);
    try {
      const res = await api.post('/api/lumi/portfolio/allocate/commit', { totalBudgetMinor, goal });
      const result = { planId: res.data?.planId, decisionsCreated: res.data?.decisionsCreated ?? 0 };
      setCommitted(result);
      return result;
    } catch (err) {
      setCommitError(err);
      return null;
    } finally {
      setCommitting(false);
    }
  }, []);

  return { preview, commit, plan, previewNote, previewing, previewError, committed, committing, commitError };
}
