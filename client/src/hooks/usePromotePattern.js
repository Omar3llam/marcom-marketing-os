// ============================================================
// MARCOM / Lumi — usePromotePattern (Phase 5 · the "make it a rule" trigger)
// ------------------------------------------------------------
// POST /api/lumi/patterns/:id/promote → { workspaceId, ruleId }. Turns a proven
// AccountPattern into a GuardrailRule that then rides the existing Phase-2
// sweep → confirm → execute governance (it never auto-executes). The account
// briefing already surfaces how many patterns are promotable; this is the tap.
//
// Role: STRATEGIST-only (route gate). Promoting a pattern to an account-wide
// rule is an owner decision, like the network-consent control beside it. The
// view gates the button; the server stays the arbiter and rejects unproven /
// conflicted / already-promoted patterns with a 409 we surface honestly.
//
// Returns { promote, promotingId, error }. `promote(id)` resolves to the
// response (or null on failure) so the caller can refetch + surface.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';

export function usePromotePattern() {
  const [promotingId, setPromotingId] = useState(null);
  const [error, setError] = useState(null);

  const promote = useCallback(async (patternId) => {
    if (!patternId) return null;
    setPromotingId(patternId);
    setError(null);
    try {
      const res = await api.post(`/api/lumi/patterns/${patternId}/promote`);
      return res.data; // { workspaceId, ruleId }
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setPromotingId(null);
    }
  }, []);

  return { promote, promotingId, error };
}
