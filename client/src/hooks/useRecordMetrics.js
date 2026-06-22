// ============================================================
// MARCOM / Lumi — useRecordMetrics (Phase 4-A · the RUNNING rung)
// ------------------------------------------------------------
// POST /api/lumi/tests/:id/metrics → { workspaceId, updated }. Records the
// MANUAL observed per-variant counts a RUNNING test needs before it can be
// concluded — the lifecycle step between Start and Conclude. The connector
// path (refreshFromMeta) is a SEPARATE, already-wired mechanism that runs on
// conclude; this is the human-entry counterpart for workspaces without a live
// Meta pull (today's reality), so a thin/zeroed test can be moved past the
// readout floor with real observed numbers — never fabricated ones.
//
// Body: { variants: [{ variantId, impressions?, clicks?, conversions?,
//         spendMinor?, revenueMinor? }] }. Money is integer minor units (the
// caller converts major→minor). The backend applies only the fields present.
//
// Role: recording is the SAME BUYER+STRATEGIST operator tier as start/conclude
// (route gate requireCollabRole(BUYER, STRATEGIST)). The view gates the form on
// canOperate; the server stays the arbiter.
//
// Returns { record, recordingId, error }. `record(id, variants)` resolves to
// the response (or null on failure) so the caller can refetch + surface.
// ============================================================
import { useCallback, useState } from 'react';
import { api } from '@/lib/api.js';

export function useRecordMetrics() {
  const [recordingId, setRecordingId] = useState(null);
  const [error, setError] = useState(null);

  const record = useCallback(async (testId, variants) => {
    if (!testId) return null;
    const rows = Array.isArray(variants) ? variants : [];
    if (rows.length === 0) return null;
    setRecordingId(testId);
    setError(null);
    try {
      const res = await api.post(`/api/lumi/tests/${testId}/metrics`, { variants: rows });
      return res.data; // { workspaceId, updated }
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setRecordingId(null);
    }
  }, []);

  return { record, recordingId, error };
}
