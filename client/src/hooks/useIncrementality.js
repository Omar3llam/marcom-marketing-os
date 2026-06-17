// ============================================================
// MARCOM / Lumi — useIncrementality (Phase 4-E · holdout testing)
// ------------------------------------------------------------
// GET  /api/lumi/incrementality            → list designed/running/concluded holdouts
// POST /api/lumi/incrementality            → design a holdout (power calc)
// POST /api/lumi/incrementality/:id/metrics→ record OBSERVED counts (DESIGNED→RUNNING)
// POST /api/lumi/incrementality/:id/conclude→ read out lift + CI → memory
//
// THE PRODUCT SEAM: measurement is Agency/Enterprise depth. A 403 is NOT an
// error — it's an honest LOCKED state (`gated`), so the view renders "not
// enabled for this workspace" rather than a failure. Rows are contract-validated
// (IncrementalityListResponseSchema); a CONCLUDED row carries its persisted
// lift/CI/confidence — the view renders the backing row, never a re-derived lift.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api.js';
import { IncrementalityListResponseSchema, ConcludeIncrementalityResponseSchema } from '@/contracts/schemas';

export function useIncrementality() {
  const [tests, setTests] = useState([]);
  const [readouts, setReadouts] = useState({}); // testId → fresh conclude readout
  const [gated, setGated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    if (!aliveRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/lumi/incrementality');
      if (!aliveRef.current) return;
      const parsed = IncrementalityListResponseSchema.safeParse(res.data);
      setGated(false);
      setTests(parsed.success ? parsed.data.tests : []);
      if (!parsed.success) setError(new Error('Incrementality response failed contract validation'));
    } catch (err) {
      if (!aliveRef.current) return;
      // 403 = tier-gated. An honest locked state, not a failure.
      if (err?.response?.status === 403) { setGated(true); setTests([]); setError(null); }
      else { setGated(false); setError(err); setTests([]); } // clear stale lock on a real failure
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => { aliveRef.current = false; };
  }, [load]);

  const design = useCallback(async (input) => {
    setBusyId('new');
    try {
      await api.post('/api/lumi/incrementality', input);
      await load();
      return true;
    } catch (err) {
      if (aliveRef.current) setError(err);
      return false;
    } finally {
      if (aliveRef.current) setBusyId(null);
    }
  }, [load]);

  const recordCounts = useCallback(async (testId, counts) => {
    setBusyId(testId);
    try {
      await api.post(`/api/lumi/incrementality/${testId}/metrics`, counts);
      await load();
      return true;
    } catch (err) {
      if (aliveRef.current) setError(err);
      return false;
    } finally {
      if (aliveRef.current) setBusyId(null);
    }
  }, [load]);

  const conclude = useCallback(async (testId) => {
    setBusyId(testId);
    try {
      const res = await api.post(`/api/lumi/incrementality/${testId}/conclude`);
      const parsed = ConcludeIncrementalityResponseSchema.safeParse(res.data);
      if (aliveRef.current) {
        if (parsed.success) setReadouts((r) => ({ ...r, [testId]: parsed.data.readout }));
        else setError(new Error('Conclude response failed contract validation')); // surface contract drift, don't hide it
      }
      await load();
      return parsed.success ? parsed.data.readout : null;
    } catch (err) {
      if (aliveRef.current) setError(err);
      return null;
    } finally {
      if (aliveRef.current) setBusyId(null);
    }
  }, [load]);

  return { tests, readouts, gated, loading, error, busyId, refetch: load, design, recordCounts, conclude };
}
