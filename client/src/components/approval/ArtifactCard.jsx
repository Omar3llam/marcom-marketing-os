// ============================================================
// ArtifactCard — PR #36: Artifact Display Component
// ============================================================
// Displays individual artifact with metadata and content preview.
//
// FEATURES:
//   - Artifact metadata (type, size, created date)
//   - Content preview with expand/collapse
//   - Approval status indicator
//   - Visual distinction by artifact type
//
// USAGE:
//   <ArtifactCard artifact={artifact} />
// ============================================================
import { useState } from 'react';
import { ChevronDown, ChevronUp, FileText, Image, Code } from 'lucide-react';
import { Text } from '../primitives/core/Text.jsx';
import { RecordPublishForm, isApproved } from '../publish/RecordPublishForm.jsx';
import { cn } from '../../lib/utils';

/**
 * Get icon component for artifact type.
 *
 * @param {string} type - Artifact type
 * @returns {Component} Lucide icon component
 */
function getArtifactIcon(type) {
  const iconMap = {
    visual_brief: Image,
    ad_copy: FileText,
    hook: FileText,
    caption: FileText,
    headline: FileText,
    code: Code,
  };

  return iconMap[type] || FileText;
}

/**
 * Format bytes to human-readable size.
 *
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
function formatBytes(bytes) {
  if (!bytes) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format date to relative time.
 *
 * @param {string} dateString - ISO date string
 * @returns {string} Relative time
 */
function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Artifact display card component.
 *
 * @param {Object} props
 * @param {Object} props.artifact - Artifact with approval status
 * @param {boolean} [props.expanded] - Initial expanded state
 * @param {Function} [props.onExpand] - Expand callback
 */
export function ArtifactCard({ artifact, expanded: initialExpanded = false, onExpand }) {
  const [expanded, setExpanded] = useState(initialExpanded);

  const Icon = getArtifactIcon(artifact.type);

  const handleToggle = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    onExpand?.(newExpanded);
  };

  // Truncate content for preview
  const contentPreview = artifact.content
    ? artifact.content.length > 200
      ? artifact.content.substring(0, 200) + '...'
      : artifact.content
    : 'No content available';

  // Approval status styling
  const approvalStatusClass = {
    PENDING: 'bg-signal-warning/10 text-signal-warning border-signal-warning/20',
    COMPLETED: 'bg-signal-success/10 text-signal-success border-signal-success/20',
  }[artifact.approval?.status] || 'bg-surface-base text-text-muted border-border-subtle';

  return (
    <div className="border border-border-subtle rounded-lg bg-surface-base overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-subtle bg-surface-dark/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            <div className="mt-1 text-text-muted">
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Text variant="data" intent="primary" className="font-semibold">
                  {artifact.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </Text>
                {artifact.approval && (
                  <span
                    className={cn(
                      'px-2 py-0.5 text-xs font-medium rounded border',
                      approvalStatusClass
                    )}
                  >
                    {artifact.approval.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-text-subtle">
                <span>Node: {artifact.nodeId}</span>
                <span>•</span>
                <span>{formatBytes(artifact.size)}</span>
                <span>•</span>
                <span>{formatRelativeTime(artifact.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* Expand/Collapse button */}
          <button
            onClick={handleToggle}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors rounded hover:bg-surface-dark/50"
            aria-label={expanded ? 'Collapse content' : 'Expand content'}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span>Collapse</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Expand</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {/* Metadata */}
        {artifact.metadata && Object.keys(artifact.metadata).length > 0 && (
          <div className="mb-3 p-2 bg-surface-dark/20 rounded text-xs">
            <Text variant="label" intent="subtle" className="mb-1">
              Metadata
            </Text>
            <div className="space-y-1">
              {Object.entries(artifact.metadata).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-text-muted font-medium">{key}:</span>
                  <span className="text-text-secondary">{JSON.stringify(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content preview/full */}
        <div>
          <Text variant="label" intent="subtle" className="mb-2">
            Content
          </Text>
          <div
            className={cn(
              'p-3 bg-surface-dark/10 rounded font-mono text-sm text-text-secondary whitespace-pre-wrap break-words',
              !expanded && 'max-h-32 overflow-hidden'
            )}
          >
            {expanded ? artifact.content || contentPreview : contentPreview}
          </div>
        </div>

        {/* Approval decision (if completed) */}
        {artifact.approval?.status === 'COMPLETED' && artifact.approval.decision && (
          <div className="mt-3 p-3 bg-signal-success/5 border border-signal-success/20 rounded">
            <div className="flex items-center gap-2 mb-1">
              <Text variant="data" intent="success" className="font-semibold">
                Decision: {artifact.approval.decision}
              </Text>
            </div>
            {artifact.approval.feedback && (
              <Text variant="body" intent="secondary" size="sm" className="mt-2">
                {artifact.approval.feedback}
              </Text>
            )}
          </div>
        )}

        {/* Approved → tell the operator the honest next step (there is no
            one-click API publish; they create the ad in Meta, then record it). */}
        {isApproved(artifact) && (
          <div className="mt-4 p-3 rounded-lg bg-signal-success/10 border border-signal-success/20">
            <Text variant="data" intent="success" className="font-semibold">
              Approved — ready to publish
            </Text>
            <Text variant="body" intent="muted" size="sm" className="mt-0.5">
              Copy this content into Meta Ads Manager to create the ad — Lumi does not publish it for you.
              Then record the Meta IDs below to link performance back to this artifact.
            </Text>
          </div>
        )}

        {/* Record a manual Meta publish — self-gates to APPROVED artifacts. */}
        <RecordPublishForm artifact={artifact} />
      </div>
    </div>
  );
}
