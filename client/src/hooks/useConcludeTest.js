// ============================================================
// MARCOM / Lumi — useConcludeTest (Phase 4-A · the loop trigger)
// ------------------------------------------------------------
// POST /api/lumi/tests/:id/conclude → ConcludeTestResponse. THE LOOP, by the
// buyer's hand: the backend reads the winner honestly, writes the outcome to
// memory, and (only when confident + governance-valid) links a PROPOSED
// REFRESH/SCALE Decision that the user still confirms through the execute path.
// Never auto-executes. The response is validated against the contract before
// it's trusted.
//
// Returns { conclude, concludingId, error }. `conclude(id)` resolves to the
// validated response (or null on failure) so the caller can refetch + surface.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';
import { ConcludeTestResponseSchema } from '@/contracts/schemas';

export function useConcludeTest() {
  const [concludingId, setConcludingId] = useState(null);
  const [error, setError] = useState(null);

  const conclude = useCallback(async (testId) => {
    if (!testId) return null;
    setConcludingId(testId);
    setError(null);
    try {
      const res = await api.post(`/api/lumi/tests/${testId}/conclude`);
      const parsed = ConcludeTestResponseSchema.safeParse(res.data);
      if (!parsed.success) {
        setError(new Error('Conclude response failed contract validation'));
        return null;
      }
      return parsed.data;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setConcludingId(null);
    }
  }, []);

  return { conclude, concludingId, error };
}
