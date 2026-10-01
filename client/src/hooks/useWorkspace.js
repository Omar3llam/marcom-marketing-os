// ============================================================
// MARCOM / Lumi — Workspace Hook
// ============================================================
// Fetches the current user's workspace from /api/user/workspace.
// Returns workspace metadata for the PROJECT dropdown in Sidebar.
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { READ, readStatusForError, isRetryableReadError } from '@/design-system/states/readStatus.js';

/**
 * What this read established about the workspace ENTITLEMENT.
 *
 * Phase 5.11 — the tokens now live in design-system/states/readStatus.js,
 * because the ROLE read needs exactly the same five outcomes and two
 * identical vocabularies would be the duplication that module prevents. The
 * alias is kept so every existing importer and test keeps its own name for a
 * workspace-shaped read.
 */
export const WORKSPACE_READ = READ;

/** The plans this client recognises. Anything else is not a plan we can act on. */
const KNOWN_PLANS = Object.freeze(['FREE', 'GROWTH', 'PRO']);

/**
 * Custom hook to fetch and manage the current user's workspace.
 *
 * `status` answers a DIFFERENT question from `workspace`: whether the
 * entitlement was established, not whether a record came back. A workspace row
 * can arrive with an unusable `plan` — the name still renders, the entitlement
 * is still unknown — so the two are reported separately and `workspace` keeps
 * exactly the meaning it had before this hook grew a status.
 *
 * @returns {{
 *   workspace: object | null,
 *   hasWorkspace: boolean,
 *   loading: boolean,
 *   error: string | null,
 *   status: string,
 *   refetch: () => Promise<void>
 * }}
 */
export function useWorkspace() {
  const { currentUser } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(WORKSPACE_READ.LOADING);

  const [canRetry, setCanRetry] = useState(false);
  const attemptRef = useRef(0);
  const aliveRef = useRef(true);
  const fetchWorkspace = useCallback(async () => {
      if (!aliveRef.current) return;
      const attempt = ++attemptRef.current;
      const isCancelled = () => !aliveRef.current || attempt !== attemptRef.current;
      setWorkspace(null); setHasWorkspace(false); setError(null); setCanRetry(false);
      if (!currentUser) {
        if (isCancelled()) return;
        setWorkspace(null);
        setHasWorkspace(false);
        // No session, so the read was never made. That is not a finding about
        // the workspace, and it is certainly not a plan.
        setStatus(WORKSPACE_READ.NOT_REACHABLE);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        setStatus(WORKSPACE_READ.LOADING);
        const response = await api.get('/api/user/workspace');
        if (isCancelled()) return;
        const data = response?.data;
        if (data?.hasWorkspace === true) {
          const ws = data.workspace ?? null;
          setWorkspace(ws);
          setHasWorkspace(ws !== null);
          // The record can be present and its entitlement still unreadable.
          // `?? 'FREE'` here is what sold a server error as an upgrade wall.
          setStatus(
            ws && KNOWN_PLANS.includes(ws.plan)
              ? WORKSPACE_READ.PRESENT
              : WORKSPACE_READ.NOT_REACHABLE,
          );
        } else if (data?.hasWorkspace === false) {
          setWorkspace(null);
          setHasWorkspace(false);
          setStatus(WORKSPACE_READ.NOTHING_FOUND);
        } else {
          // A 200 that does not answer the question. Unreadable, not empty.
          setWorkspace(null);
          setHasWorkspace(false);
          setStatus(WORKSPACE_READ.NOT_REACHABLE);
        }
      } catch (err) {
        if (isCancelled()) return;
        console.error('[useWorkspace] Failed to fetch workspace:', err);
        setError(err.response?.data?.error || 'Failed to load workspace');
        setWorkspace(null);
        setHasWorkspace(false);
        // Classified by the shared helper: a 403 is a refusal, anything else
        // is a read we could not complete. Never the same thing as a tier.
        setStatus(readStatusForError(err));
        setCanRetry(isRetryableReadError(err));
      } finally {
        if (!isCancelled()) setLoading(false);
      }
  }, [currentUser]);

  useEffect(() => {
    const attempts = attemptRef;
    aliveRef.current = true;
    // A new identity must not inherit the previous one's answer: reset before
    // asking, or the next user reads this one's entitlement until the request
    // lands.
    setWorkspace(null);
    setHasWorkspace(false);
    setError(null);
    setStatus(WORKSPACE_READ.LOADING);
    setLoading(true);
    fetchWorkspace();
    return () => { aliveRef.current = false; ++attempts.current; };
  }, [fetchWorkspace]);

  return {
    workspace,
    hasWorkspace,
    loading,
    error,
    status,
    refetch: fetchWorkspace,
    canRetry,
  };
}
