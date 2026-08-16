// ============================================================
// MARCOM / Lumi — useRecordOutcome (Phase X · the Proof Engine WRITE path)
// ------------------------------------------------------------
// POST /api/lumi/decisions/:id/outcome → { workspaceId, decisionId, outcome,
//                                          previousOutcomeId }.
// Records what ACTUALLY happened after an EXECUTED decision — human-asserted,
// the same operator-owned measurement as useRecordMetrics (never fabricated).
// This is the one real input that fills the Proof Engine; until a causal
// realized-metrics source is wired, a human closes the loop here.
//
// Body: { spendDeltaMinor, revenueDeltaMinor, roasDelta, windowStart, windowEnd,
//         sustained, measuredAt }. Money is integer minor units (the caller
//         converts major→minor via toMinor). Negative deltas are valid — a KILL
//         reduces both spend and revenue.
//
// `measuredAt` (R6 · I19) is WHEN the operator established the result, and it is
// required. The hook never fills it in: a clock read here would record the
// moment of the request as the moment of measurement.
//
// Provenance is NOT sent. The server projects the evidence reference from the
// rows it holds; anything this hook attached would be a claim about a database
// the browser cannot see. Recording APPENDS — the response's
// `previousOutcomeId` names the row this one retired, if there was one.
//
// Role: BUYER+STRATEGIST (the route gate is the arbiter; the panel hides the
// form from a CLIENT). Returns { record, recordingId, error }. `record(id, body)`
// resolves to the response (or null on failure) so the caller can refetch.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';

export function useRecordOutcome() {
  const [recordingId, setRecordingId] = useState(null);
  const [error, setError] = useState(null);

  const record = useCallback(async (decisionId, body) => {
    if (!decisionId || !body) return null;
    setRecordingId(decisionId);
    setError(null);
    try {
      const res = await api.post(`/api/lumi/decisions/${decisionId}/outcome`, body);
      return res.data; // { workspaceId, decisionId, outcome, previousOutcomeId }
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setRecordingId(null);
    }
  }, []);

  return { record, recordingId, error };
}
