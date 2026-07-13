// ============================================================
// Publishing — the two stages of getting creative live
// ============================================================
// One workflow on the same Artifact rows: PENDING → APPROVED → publish-recorded.
// Two always-visible zones, top to bottom:
//   1. Awaiting approval  — workspace-wide PENDING artifacts (usePendingApprovals).
//      Visibility is consolidated here; the decision itself is an execution-resume
//      op owned by the per-execution Approval Queue, so each item links there
//      (see PendingApprovalItem) rather than inlining an approve that would strand
//      the paused execution.
//   2. Approved — record publish — the PR #105 approved list, unchanged.
//
// Both zones are always rendered (the empty one says so plainly) because they are
// the two stages of a single pipeline, not independent lists.
//
// Role: the page route is BUYER + STRATEGIST gated. Viewing pending is fine for
// both; deciding is STRATEGIST-only (enforced server-side + in PendingApprovalItem).
// ============================================================
import { Loader2, AlertCircle, CheckCircle2, Inbox } from 'lucide-react';
import { Text } from '../components/primitives/core/Text.jsx';
import { ArtifactCard } from '../components/approval/ArtifactCard.jsx';
import { PendingApprovalItem } from '../components/publish/PendingApprovalItem.jsx';
import { CardSkeleton } from '../components/ui/Skeleton.jsx';
import { HelpTip } from '../components/ui/HelpTip.jsx';
import { HELP } from '../lib/helpContent.js';
import { useApprovedArtifacts } from '../hooks/useApprovedArtifacts.js';
import { usePendingApprovals } from '../hooks/usePendingApprovals.js';

// A workflow zone: a header that's always present, with a body that switches
// between loading / error / empty / items — so an empty stage stays visible and
// honest rather than disappearing.
function Zone({ title, count, loading, error, onRetry, EmptyIcon, emptyText, errorText, className = '', children }) {
  const hasItems = count > 0;
  return (
    <section className={className} aria-label={title}>
      <div className="flex items-center justify-between mb-4">
        <Text variant="data" size="lg" intent="primary" className="font-semibold">
          {title}
        </Text>
        {!loading && !error && hasItems && (
          <Text variant="label" intent="muted">{count}</Text>
        )}
      </div>

      {loading && (
        <div className="space-y-4" aria-busy="true">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="h-9 w-9 text-signal-danger mb-3" />
          <Text variant="body" intent="danger" className="mb-1">{errorText}</Text>
          <Text variant="body" intent="muted" className="mb-4">{error}</Text>
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-gold text-surface-dark rounded-lg font-medium hover:bg-brand-gold/90"
          >
            <Loader2 className="h-4 w-4" />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && !hasItems && (
        <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border-subtle rounded-lg">
          <EmptyIcon className="h-9 w-9 text-signal-success mb-3" />
          <Text variant="body" intent="muted">{emptyText}</Text>
        </div>
      )}

      {!loading && !error && hasItems && children}
    </section>
  );
}

export default function Publishing() {
  const pending = usePendingApprovals();
  const approved = useApprovedArtifacts();

  return (
    <div className="container max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Text variant="title" intent="primary">
            Publishing
          </Text>
          <HelpTip variant="popover" content={HELP.PUBLISHING_WORKFLOW} />
        </div>
        <Text variant="body" intent="muted">
          The two stages of getting creative live: approve AI-generated artifacts, then record the
          manual Meta publish so real performance links back to each one.
        </Text>
      </header>

      {/* Zone 1 — Awaiting approval */}
      <Zone
        title="Awaiting approval"
        count={pending.pending.length}
        loading={pending.loading}
        error={pending.error}
        onRetry={() => pending.refetch()}
        EmptyIcon={Inbox}
        emptyText="Nothing awaiting approval right now."
        errorText="Couldn’t load pending approvals"
      >
        <div className="space-y-6">
          {pending.pending.map((artifact) => (
            <PendingApprovalItem key={artifact.approval.id} artifact={artifact} />
          ))}
        </div>
      </Zone>

      {/* Zone 2 — Approved · record publish */}
      <Zone
        className="mt-10"
        title="Approved — record publish"
        count={approved.artifacts.length}
        loading={approved.loading}
        error={approved.error}
        onRetry={() => approved.refetch()}
        EmptyIcon={CheckCircle2}
        emptyText="No approved creative yet. Once an artifact clears approval, it appears here so you can record its Meta publish."
        errorText="Couldn’t load approved creative"
      >
        <div className="space-y-6">
          {approved.artifacts.map((artifact) => (
            <div
              key={artifact.id}
              className="p-6 border border-border-subtle rounded-lg bg-surface-base"
            >
              <ArtifactCard artifact={artifact} />
            </div>
          ))}
        </div>
      </Zone>
    </div>
  );
}
