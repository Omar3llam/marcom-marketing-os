// ============================================================
// useContentHistory — Content Lab saved-generations history
// ------------------------------------------------------------
// GET /api/tools/content-generations → workspace-scoped, newest first, last 50.
// refetch() is called after each new generation so the rail stays fresh.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api.js';

export function useContentHistory() {
  const [generations, setGenerations] = useState([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/tools/content-generations', { signal });
      setGenerations(res.data?.generations ?? []);
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
      setError(err?.response?.data?.error || 'Could not load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const refetch = useCallback(() => load(), [load]);

  return { generations, isLoading, error, refetch };
}
