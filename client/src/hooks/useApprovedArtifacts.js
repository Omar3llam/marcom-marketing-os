// ============================================================
// useApprovedArtifacts Hook — workspace-wide approved creative
// ============================================================
// Fetches artifacts that have cleared human approval (COMPLETED + APPROVED),
// workspace-wide, for the Publishing view. This is the surface that makes the
// already-shipped "Record Meta publish" action reachable: the per-execution
// list endpoints can't serve it (no executions browser to supply an id).
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';

export function useApprovedArtifacts() {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchApproved = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/api/execute/artifacts/approved', { signal });
      setArtifacts(response.data?.artifacts ?? []);
      setLoading(false);
    } catch (err) {
      // Ignore aborts (component unmounted / re-fetch superseded).
      if (err.name === 'AbortError' || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      setError(err.message || 'Failed to load approved artifacts');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchApproved(controller.signal);
    return () => controller.abort();
  }, [fetchApproved]);

  return { artifacts, loading, error, refetch: fetchApproved };
}
