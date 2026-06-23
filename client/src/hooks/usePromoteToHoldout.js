// ============================================================
// MARCOM / Lumi — usePromoteToHoldout (Phase 7C · the Testing→Incrementality bridge)
// ------------------------------------------------------------
// POST /api/lumi/tests/:id/promote-to-holdout → designs a DESIGNED holdout off a
// CONCLUDED A/B test. Mirrors useConcludeTest/useStartTest. The backend derives
// baselineCvr from the control arm — the caller only supplies dailyEligible (+
// optional mde/channel).
//
// The promote endpoint is gated STRATEGIST + Enterprise. On a 403 we tag the
// returned/stored error with `.kind` ('tier' | 'role' | 'generic') so the UI can
// surface the HONEST reason (the client has no tier signal of its own; the
// backend is the source of truth) instead of a generic failure.
//
// Returns { promote, promotingId, error }. `promote(id, payload)` resolves to the
// created holdout (or null on failure).
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';

function tagError(err) {
  const code = err?.response?.data?.error;
  const kind = code === 'TierGated' || code === 'MeasurementGated' ? 'tier'
    : code === 'RoleForbidden' ? 'role'
    : 'generic';
  const e = new Error(err?.response?.data?.message || 'Couldn’t promote this test to a holdout right now.');
  e.kind = kind;
  return e;
}

export function usePromoteToHoldout() {
  const [promotingId, setPromotingId] = useState(null);
  const [error, setError] = useState(null);

  const promote = useCallback(async (testId, payload = {}) => {
    if (!testId) return null;
    setPromotingId(testId);
    setError(null);
    try {
      const res = await api.post(`/api/lumi/tests/${testId}/promote-to-holdout`, payload);
      return res.data?.incrementalityTest ?? null;
    } catch (err) {
      setError(tagError(err));
      return null;
    } finally {
      setPromotingId(null);
    }
  }, []);

  return { promote, promotingId, error };
}
