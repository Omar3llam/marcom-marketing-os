// ============================================================
// MARCOM / Lumi — useProjectId hook
// ------------------------------------------------------------
// Fetches and caches the user's active projectId.
// Required before calling:
//   - GET /api/credentials/status?projectId=
//   - GET /api/auth/meta/connect?projectId=
//   - POST /api/campaigns/fetch-meta (future)
//
// Returns:
//   { projectId: string|null, loading: boolean, error: string|null }
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { api }                 from '@/lib/api.js';
import { useAuth }             from '@/context/AuthContext.jsx';

export function useProjectId() {
  const { currentUser }              = useAuth();
  const [projectId, setProjectId]    = useState(null);
  const [loading,   setLoading]      = useState(true);
  const [error,     setError]        = useState(null);
  // Bumped by refetch() to re-run the effect (mirrors useConnections). Without
  // it, a failed /api/projects/mine left every caller permanently unable to
  // recover except by a full page reload.
  const [reloadKey, setReloadKey]    = useState(0);

  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    api.get('/api/projects/mine', { signal: ctrl.signal })
      .then(res => {
        setProjectId(res.data?.projectId ?? null);
      })
      .catch(err => {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        setError(err.response?.data?.error || 'Could not load project');
        setProjectId(null);
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [currentUser, reloadKey]);  // re-fetch if the user changes, or on refetch()

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  return { projectId, loading, error, refetch };
}
