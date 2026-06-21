// ============================================================
// MARCOM / Lumi — useCommitAgenda (Phase 4-A · the agenda trigger)
// ------------------------------------------------------------
// POST /api/lumi/tests → { workspaceId, created, variants, testIds }. Mints the
// proposed weekly agenda as real PROPOSED TestExperiment rows, by the operator's
// hand. Lumi proposes; the human commits; nothing auto-creates.
//
// The PAYLOAD is the full suggestion objects, not a list of ids: the backend
// commitAgenda() reads entityId / dimension / metric / variants off each pick.
// The agenda items the Testing OS already holds (from GET /api/lumi/tests) ARE
// valid picks, so they're passed straight back — no reshaping.
//
// Role: committing is the SAME BUYER+STRATEGIST operator tier as viewing (route
// gate requireCollabRole(BUYER, STRATEGIST)) — no stricter split, unlike the
// pending-approval decide gate. The view gates the button on canOperate; the
// server is still the arbiter.
//
// Returns { commit, committing, error }. `commit(picks)` resolves to the result
// (or null on failure) so the caller can refetch + surface honestly.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';

export function useCommitAgenda() {
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState(null);

  const commit = useCallback(async (picks) => {
    // Only commit suggestions the backend can actually persist (it filters on
    // entityId + dimension). Guard an empty set so we never fire a no-op POST
    // that the server would 400 or silently create nothing from.
    const valid = Array.isArray(picks) ? picks.filter((p) => p && p.entityId && p.dimension) : [];
    if (valid.length === 0) {
      setError(new Error('Nothing to commit — the agenda is empty.'));
      return null;
    }
    setCommitting(true);
    setError(null);
    try {
      const res = await api.post('/api/lumi/tests', { picks: valid });
      return res.data; // { workspaceId, created, variants, testIds }
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setCommitting(false);
    }
  }, []);

  return { commit, committing, error };
}
