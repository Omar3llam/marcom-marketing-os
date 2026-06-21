// ============================================================
// PendingApprovalItem — one artifact in Publishing's "Awaiting approval" zone
// ============================================================
// Reuses ArtifactCard for display (it already renders the PENDING badge), then
// routes to the DECISION rather than inlining it.
//
// Why a link, not an inline approve button:
//   The canonical approval is an execution-resume operation — ApprovalQueue
//   batches decisions and POSTs /api/execute/:executionId/resume to continue the
//   paused execution graph. The standalone POST /api/artifacts/:id/approve sets
//   status but does NOT resume, so approving here in isolation would strand the
//   execution. So we deep-link to the per-execution queue (the artifact carries
//   its executionId) instead of forking that flow. Visibility is consolidated
//   workspace-wide here; the decision stays where it can safely resume.
//
// Role: only a STRATEGIST can decide (server gate: requireApprover = STRATEGIST).
// A BUYER can see what's queued but gets an honest read-only note, not a link
// that would 403 on submit.
// ============================================================
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ArtifactCard } from '../approval/ArtifactCard.jsx';
import { Text } from '../primitives/core/Text.jsx';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';

export function PendingApprovalItem({ artifact }) {
  const { role } = useCollabRole();
  const canDecide = role === WORKSPACE_ROLE.STRATEGIST;
  const executionId = artifact.executionId;

  return (
    <div className="p-6 border border-border-subtle rounded-lg bg-surface-base">
      <ArtifactCard artifact={artifact} />

      <div className="mt-4 flex items-center justify-end">
        {canDecide && executionId ? (
          <Link
            to={`/app/approvals/${executionId}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-gold text-surface-dark rounded-lg font-medium hover:bg-brand-gold/90"
          >
            Review &amp; decide
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <Text variant="body" intent="muted">
            {canDecide
              ? 'No linked execution — review it in the run that produced it.'
              : 'Awaiting a strategist’s approval.'}
          </Text>
        )}
      </div>
    </div>
  );
}
