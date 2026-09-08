// ============================================================
// MARCOM / Lumi — useTests (Phase 4-A · the Testing OS surface)
// ------------------------------------------------------------
// GET /api/lumi/tests → { workspaceId, generatedAt, agenda, experiments }.
// Each experiment is validated against TestExperimentSchema (the contract
// seam); only contract-valid rows are surfaced — a malformed row is dropped,
// never rendered with fabricated fields. A CONCLUDED row already carries its
// persisted readout (winnerLabel / lift / confidenceLabel / sampleNote), so the
// view renders real backing-row figures, never a re-derived number.
//
// Returns { experiments, agenda, loading, error, refetch }. `refetch` lets the
// page re-pull after a conclude so the new readout replaces the RUNNING row.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { TestExperimentSchema } from '@/contracts/schemas';
import { readRows } from '@/lib/rowIntegrity.js';

export function useTests() {
  const [state, setState] = useState({ experiments: [], experimentRows: [], agenda: [], loading: true, error: null });

  const load = useCallback(async (signal) => {
    try {
      const res = await api.get('/api/lumi/tests');
      if (signal?.cancelled) return;
      // Tier 2b — this said "keep only contract-valid rows — honest seam,
      // resilient to one bad row". The dropped row did not survive anywhere,
      // so a list shorter than the truth claimed to be complete, and a wholly
      // unreadable one rendered "No experiments yet".
      const read = readRows(TestExperimentSchema, res.data?.experiments);
      if (!read.ok) {
        setState({
          experiments: [], experimentRows: [], agenda: [], loading: false,
          error: new Error('Tests response failed contract validation'),
        });
        return;
      }
      const agenda = Array.isArray(res.data?.agenda) ? res.data.agenda : [];
      setState({
        experiments: read.readable, experimentRows: read.entries,
        agenda, loading: false, error: null,
      });
    } catch (err) {
      if (signal?.cancelled) return;
      setState({ experiments: [], experimentRows: [], agenda: [], loading: false, error: err });
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    setState((s) => ({ ...s, loading: true }));
    load(signal);
    return () => { signal.cancelled = true; };
  }, [load]);

  const refetch = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return load();
  }, [load]);

  return { ...state, refetch };
}
