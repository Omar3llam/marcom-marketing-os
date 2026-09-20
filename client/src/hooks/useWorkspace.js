// ============================================================
// MARCOM / Lumi — Workspace Hook
// ============================================================
// Fetches the current user's workspace from /api/user/workspace.
// Returns workspace metadata for the PROJECT dropdown in Sidebar.
// ============================================================
import { useState, useEffect } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { ABSENCE } from '@/design-system/states/absence.js';

/**
 * What this read established about the workspace's ENTITLEMENT.
 *
 * The four resolved values ARE B8-02's locked tokens, by value — this invents
 * no second vocabulary. Only `LOADING` is added, because B8-02 describes what a
 * surface knows about a CLAIM and says nothing about a request still in flight;
 * "loading ≠ success" is exactly why it needs its own token here rather than
 * borrowing one that already means something.
 *
 * Classifying a transport outcome is not frontend-derived product truth: the
 * HTTP result IS the API's answer, observed directly. What the code may never
 * do is turn "we could not ask" into a plan — see usePlan.
 */
export const WORKSPACE_READ = Object.freeze({
  /** The request has not resolved. No entitlement decision may be made. */
  LOADING: 'LOADING',
  /** A valid workspace with a plan we recognise. The only state that entitles. */
  PRESENT: ABSENCE.PRESENT,
  /** The server answered, and this user has no workspace. A FINDING. */
  NOTHING_FOUND: ABSENCE.NOTHING_FOUND,
  /** The read failed, or the entitlement it returned is unreadable. */
  NOT_REACHABLE: ABSENCE.NOT_REACHABLE,
  /** We are not entitled to ask. Never the same thing as a lower tier. */
  NOT_PERMITTED: ABSENCE.NOT_PERMITTED,
});

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

  const fetchWorkspace = async ({ isCancelled = () => false } = {}) => {
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
        // api.js rejects with a mapped domain error carrying `httpStatus`;
        // `response.status` is read too so a raw axios error is classified the
        // same way rather than silently falling through to "unreachable".
        const httpStatus = err?.httpStatus ?? err?.response?.status;
        setStatus(httpStatus === 403 ? WORKSPACE_READ.NOT_PERMITTED : WORKSPACE_READ.NOT_REACHABLE);
      } finally {
        if (!isCancelled()) setLoading(false);
      }
  };

  useEffect(() => {
    let cancelled = false;
    // A new identity must not inherit the previous one's answer: reset before
    // asking, or the next user reads this one's entitlement until the request
    // lands.
    setWorkspace(null);
    setHasWorkspace(false);
    setError(null);
    setStatus(WORKSPACE_READ.LOADING);
    setLoading(true);
    fetchWorkspace({ isCancelled: () => cancelled });
    return () => { cancelled = true; };
  // fetchWorkspace closes over currentUser; including it would recreate the effect every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  return {
    workspace,
    hasWorkspace,
    loading,
    error,
    status,
    refetch: fetchWorkspace,
  };
}
