// ============================================================
// MARCOM / Lumi — Workspace Hook
// ============================================================
// Fetches the current user's workspace from /api/user/workspace.
// Returns workspace metadata for the PROJECT dropdown in Sidebar.
// ============================================================
import { useState, useEffect } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/context/AuthContext.jsx';

/**
 * Custom hook to fetch and manage the current user's workspace.
 *
 * @returns {{
 *   workspace: object | null,
 *   hasWorkspace: boolean,
 *   loading: boolean,
 *   error: string | null,
 *   refetch: () => Promise<void>
 * }}
 */
export function useWorkspace() {
  const { currentUser } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchWorkspace = async () => {
    if (!currentUser) {
      setWorkspace(null);
      setHasWorkspace(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await api.get('/api/user/workspace');

      if (response.data.hasWorkspace) {
        setWorkspace(response.data.workspace);
        setHasWorkspace(true);
      } else {
        setWorkspace(null);
        setHasWorkspace(false);
      }
    } catch (err) {
      console.error('[useWorkspace] Failed to fetch workspace:', err);
      setError(err.response?.data?.error || 'Failed to load workspace');
      setWorkspace(null);
      setHasWorkspace(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  return {
    workspace,
    hasWorkspace,
    loading,
    error,
    refetch: fetchWorkspace,
  };
}
