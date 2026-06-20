// ============================================================
// Publishing — navigable approved-creative surface
// ============================================================
// Lists artifacts that have cleared human approval, so an operator can record
// the manual Meta publish of each (via RecordPublishForm, embedded in
// ArtifactCard). This closes the reachability gap left by PR #104: the publish
// form existed and was correctly gated, but nothing in the live navigation
// rendered an approved artifact, so it was unreachable.
//
// Data source: GET /api/execute/artifacts/approved (workspace-wide, BUYER +
// STRATEGIST gated server-side; the route itself is RoleGate'd to match).
// ============================================================
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Text } from '../components/primitives/core/Text.jsx';
import { ArtifactCard } from '../components/approval/ArtifactCard.jsx';
import { CardSkeleton } from '../components/ui/Skeleton.jsx';
import { useApprovedArtifacts } from '../hooks/useApprovedArtifacts.js';

export default function Publishing() {
  const { artifacts, loading, error, refetch } = useApprovedArtifacts();

  return (
    <div className="container max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <Text variant="title" intent="primary" className="mb-2">
          Publishing
        </Text>
        <Text variant="body" intent="muted">
          Approved creative, ready to record as live Meta ads. Publish the ad in Meta Ads Manager
          using this artifact, then record its Meta IDs here to link real performance back to it.
        </Text>
      </header>

      {/* Loading — skeleton, never a blank page */}
      {loading && (
        <div className="space-y-4" aria-busy="true">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {/* Error — mapped message + retry */}
      {!loading && error && (
        <div role="alert" className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="h-10 w-10 text-signal-danger mb-3" />
          <Text variant="title" intent="danger" className="mb-1">
            Couldn’t load approved creative
          </Text>
          <Text variant="body" intent="muted" className="mb-4">
            {error}
          </Text>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-gold text-surface-dark rounded-lg font-medium hover:bg-brand-gold/90"
          >
            <Loader2 className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {/* Empty — honest, not a blank page */}
      {!loading && !error && artifacts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle2 className="h-10 w-10 text-signal-success mb-3" />
          <Text variant="title" intent="secondary" className="mb-1">
            No approved creative yet
          </Text>
          <Text variant="body" intent="muted">
            Once an artifact clears approval, it appears here so you can record its Meta publish.
          </Text>
        </div>
      )}

      {/* List — each card self-gates the Record Meta publish form */}
      {!loading && !error && artifacts.length > 0 && (
        <div className="space-y-6">
          {artifacts.map((artifact) => (
            <div
              key={artifact.id}
              className="p-6 border border-border-subtle rounded-lg bg-surface-base"
            >
              <ArtifactCard artifact={artifact} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
