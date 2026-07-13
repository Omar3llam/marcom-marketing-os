// ============================================================
// usePendingApprovals — workspace-wide artifacts awaiting approval
// ============================================================
// Feeds the Publishing "Awaiting approval" zone — the upstream half of the
// approve → record-publish workflow. Reuses the EXISTING pending endpoint; no
// new backend route.
//
// Two non-obvious facts confirmed against the backend (don't "simplify" away):
//   1. Real path is /api/artifacts/workspaces/:id/approvals/pending — the router
//      mounts at /api/artifacts (server.js), so it is NOT /api/workspaces/...
//      as some comments claim. It also needs the workspace UUID in the path
//      (the server still re-checks it against the token), so we read it from
//      useWorkspace().
//   2. The payload is approval-wrapped and inverted vs the approved endpoint:
//      { approvals: [{ id, status, artifact: {...} }] }. ArtifactCard expects a
//      flat artifact with a nested `approval`, so the transform below is
//      required — usePendingApprovals is NOT a drop-in clone of
//      useApprovedArtifacts.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useWorkspace } from './useWorkspace.js';

function isAbort(err) {
  return err?.name === 'AbortError' || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED';
}

// approval-wrapped row → the flat { ...artifact, approval } shape ArtifactCard
// and PendingApprovalItem consume. `executionId` is surfaced explicitly because
// the "Review & decide" deep link depends on it.
function toArtifactShape(approval) {
  const artifact = approval.artifact ?? {};
  return {
    ...artifact,
    executionId: artifact.executionId ?? null,
    approval: { id: approval.id, status: approval.status },
  };
}

// `enabled` (default true) lets a caller skip the fetch entirely — the Sidebar
// passes false for a CLIENT (who has no Publishing surface), so we never fire a
// workspace-scoped request that would only 403. The Publishing page calls with
// no args and keeps the original always-on behaviour.
export function usePendingApprovals({ enabled = true } = {}) {
  const { workspace, loading: wsLoading } = useWorkspace();
  const workspaceId = workspace?.id ?? null;

  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPending = useCallback(async (signal) => {
    if (!enabled || !workspaceId) return; // the effect handles the disabled / no-workspace cases
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(
        `/api/artifacts/workspaces/${workspaceId}/approvals/pending`,
        { signal },
      );
      setPending((res.data?.approvals ?? []).map(toArtifactShape));
      setLoading(false);
    } catch (err) {
      if (isAbort(err)) return;
      setError(err.message || 'Failed to load pending approvals');
      setLoading(false);
    }
  }, [workspaceId, enabled]);

  useEffect(() => {
    const controller = new AbortController();
    if (enabled && workspaceId) {
      fetchPending(controller.signal);
    } else if (!enabled || !wsLoading) {
      // Disabled, or workspace resolved with no id → nothing to fetch; settle honestly.
      setPending([]);
      setLoading(false);
    }
    // else: workspace still resolving → keep loading=true (no flash of "empty").
    return () => controller.abort();
  }, [enabled, workspaceId, wsLoading, fetchPending]);

  return { pending, loading, error, refetch: fetchPending };
}
