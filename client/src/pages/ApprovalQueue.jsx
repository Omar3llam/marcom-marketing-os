// ============================================================
// ApprovalQueue Page — PR #36: Artifact Approval UI
// ============================================================
// Main approval workflow page for reviewing AI-generated artifacts.
//
// FEATURES:
//   - Fetch pending artifacts for execution
//   - Display artifacts with approval forms
//   - Batch decision submission
//   - Progress tracking
//   - Success/error handling
//
// ROUTE:
//   /app/approvals/:executionId
//
// FLOW:
//   1. Load pending artifacts via useArtifactApproval
//   2. User reviews each artifact and makes decision
//   3. Submit all decisions in batch
//   4. Resume execution with decision context
//   5. Redirect to execution view
// ============================================================
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Text } from '../components/primitives/core/Text.jsx';
import { ArtifactCard } from '../components/approval/ArtifactCard.jsx';
import { ApprovalForm } from '../components/approval/ApprovalForm.jsx';
import { useArtifactApproval } from '../hooks/useArtifactApproval.js';
import { cn } from '../lib/utils';
import { appRoutes } from '../app/routeManifest.js';

/**
 * Approval queue page component.
 */
export default function ApprovalQueue() {
  const { executionId } = useParams();
  const navigate = useNavigate();

  const {
    artifacts,
    loading,
    error,
    submitting,
    decisions,
    setDecision,
    clearDecision,
    canSubmit,
    submitDecisions,
  } = useArtifactApproval(executionId);

  // ── Handle decision submission ────────────────────────────
  const handleSubmit = async () => {
    try {
      const result = await submitDecisions();

      // Show success message and redirect
      toast.success(`Execution resumed successfully — status: ${result.status}, re-executed: ${result.reExecuted}`);

      // Redirect to execution view or feed
      navigate(appRoutes.overview);
    } catch (err) {
      console.error('[ApprovalQueue] Failed to submit decisions:', err);
      // Error already set in hook state
    }
  };

  // ── Render states ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-lumi-gold mb-4" />
        <Text variant="body" intent="muted">
          Loading pending approvals...
        </Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <AlertCircle className="h-12 w-12 text-signal-kill mb-4" />
        <Text variant="title" intent="danger" className="mb-2">
          Failed to Load Approvals
        </Text>
        <Text variant="body" intent="muted">
          {error}
        </Text>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-lumi-gold text-surface-dark rounded-lg font-medium hover:bg-lumi-gold/90"
        >
          Retry
        </button>
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <CheckCircle className="h-12 w-12 text-signal-scale mb-4" />
        <Text variant="title" intent="success" className="mb-2">
          No Pending Approvals
        </Text>
        <Text variant="body" intent="muted">
          All artifacts have been reviewed for this execution.
        </Text>
        <button
          onClick={() => navigate(appRoutes.overview)}
          className="mt-4 px-4 py-2 bg-lumi-gold text-surface-dark rounded-lg font-medium hover:bg-lumi-gold/90"
        >
          Back to Feed
        </button>
      </div>
    );
  }

  // ── Main approval UI ──────────────────────────────────────

  const decidedCount = Object.keys(decisions).length;
  const totalCount = artifacts.filter(a => a.approval?.status === 'PENDING').length;
  const progress = totalCount > 0 ? (decidedCount / totalCount) * 100 : 0;

  return (
    <div className="container max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <Text variant="title" intent="primary" className="mb-2">
          Artifact Approval Queue
        </Text>
        <Text variant="body" intent="muted">
          Review AI-generated artifacts and make approval decisions.
        </Text>
        <div className="mt-4 flex items-center gap-3">
          <Text variant="data" intent="secondary">
            {decidedCount} / {totalCount} decisions made
          </Text>
          <div className="flex-1 h-2 bg-surface-dark rounded-full overflow-hidden">
            <div
              className="h-full bg-lumi-gold transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Artifacts */}
      <div className="space-y-6">
        {artifacts.map(artifact => (
          <div
            key={artifact.id}
            className={cn(
              'p-6 border rounded-lg transition-all',
              decisions[artifact.approval?.id]
                ? 'border-lumi-gold/50 bg-lumi-gold/5'
                : 'border-surface-border bg-surface-card'
            )}
          >
            {/* Artifact display */}
            <div className="mb-6">
              <ArtifactCard artifact={artifact} />
            </div>

            {/* Approval form (only for PENDING approvals) */}
            {artifact.approval?.status === 'PENDING' && (
              <div className="mt-4">
                <ApprovalForm
                  artifact={artifact}
                  onSubmit={(decision) => setDecision(artifact.approval.id, decision)}
                  onCancel={() => clearDecision(artifact.approval.id)}
                  initialDecision={decisions[artifact.approval.id]}
                />
              </div>
            )}

            {/* Decision preview (if decided) */}
            {decisions[artifact.approval?.id] && (
              <div className="mt-4 p-3 bg-signal-scale/10 border border-signal-scale/20 rounded">
                <div className="flex items-center justify-between">
                  <div>
                    <Text variant="data" intent="success" className="font-semibold">
                      Decision: {decisions[artifact.approval.id].decision}
                    </Text>
                    {decisions[artifact.approval.id].feedback && (
                      <Text variant="body" intent="secondary" size="sm" className="mt-1">
                        {decisions[artifact.approval.id].feedback}
                      </Text>
                    )}
                  </div>
                  <button
                    onClick={() => clearDecision(artifact.approval.id)}
                    className="text-xs text-dark-muted hover:text-dark-base"
                  >
                    Edit
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Submit bar (sticky) */}
      <div className="sticky bottom-0 mt-8 p-4 bg-surface-dark/95 backdrop-blur-sm border border-surface-border rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <Text variant="data" intent="primary">
              {canSubmit ? 'Ready to submit' : `${totalCount - decidedCount} decisions remaining`}
            </Text>
            <Text variant="body" intent="muted" size="sm">
              {canSubmit
                ? 'All artifacts have been reviewed. Submit to resume execution.'
                : 'Review all artifacts before submitting.'}
            </Text>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={cn(
              'px-6 py-3 rounded-lg font-semibold transition-all',
              canSubmit && !submitting
                ? 'bg-lumi-gold text-surface-dark hover:bg-lumi-gold/90 active:scale-95'
                : 'bg-surface-dark text-dark-muted cursor-not-allowed'
            )}
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting...
              </span>
            ) : (
              'Submit All Decisions'
            )}
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mt-3 p-3 bg-signal-kill/10 border border-signal-kill/20 rounded">
            <Text variant="body" intent="danger" size="sm">
              {error}
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
