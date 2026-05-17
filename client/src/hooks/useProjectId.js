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
import { useState, useEffect } from 'react';
import { api }                 from '@/lib/api.js';
import { useAuth }             from '@/context/AuthContext.jsx';

export function useProjectId() {
  const { currentUser }              = useAuth();
  const [projectId, setProjectId]    = useState(null);
  const [loading,   setLoading]      = useState(true);
  const [error,     setError]        = useState(null);

  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.get('/api/projects/mine')
      .then(res => {
        if (!cancelled) {
          setProjectId(res.data?.projectId ?? null);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Could not load project');
          setProjectId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [currentUser]);  // re-fetch if user changes

  return { projectId, loading, error };
}
