// ============================================================
// MARCOM / Lumi — useStartTest (Phase 4-A · the lifecycle bridge)
// ------------------------------------------------------------
// POST /api/lumi/tests/:id/start → { workspaceId, test }. Moves a committed
// PROPOSED experiment to RUNNING, by the operator's hand — the step PR #108
// (commit-agenda) left stranded: commit minted PROPOSED rows with no way to
// start them. No body; the test id is the path param.
//
// Role: starting is the SAME BUYER+STRATEGIST operator tier as committing and
// concluding (route gate requireCollabRole(BUYER, STRATEGIST)). The view gates
// the button on canOperate; the server stays the arbiter.
//
// Returns { start, startingId, error }. `start(id)` resolves to the response
// (or null on failure) so the caller can refetch + surface honestly.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';

export function useStartTest() {
  const [startingId, setStartingId] = useState(null);
  const [error, setError] = useState(null);

  const start = useCallback(async (testId) => {
    if (!testId) return null;
    setStartingId(testId);
    setError(null);
    try {
      const res = await api.post(`/api/lumi/tests/${testId}/start`);
      return res.data; // { workspaceId, test }
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setStartingId(null);
    }
  }, []);

  return { start, startingId, error };
}
