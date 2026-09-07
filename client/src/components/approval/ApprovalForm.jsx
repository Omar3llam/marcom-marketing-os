// ============================================================
// ApprovalForm — PR #36: Approval Decision Form
// ============================================================
// Form for making artifact approval decisions with structured feedback.
//
// FEATURES:
//   - Decision buttons (APPROVE, REJECT, REGENERATE, REQUEST_REVISION, ESCALATE)
//   - Conditional structured feedback form (for REGENERATE/REQUEST_REVISION)
//   - Feedback type dropdown
//   - Severity selection
//   - Preserve aspects multi-select
//   - Free-form feedback textarea
//
// USAGE:
//   <ApprovalForm
//     artifact={artifact}
//     onSubmit={(decision) => handleDecision(approval.id, decision)}
//     onCancel={() => clearDecision(approval.id)}
//   />
// ============================================================
import { useState } from 'react';
import { Check, X, RotateCcw, Edit, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Text } from '../primitives/core/Text.jsx';
import {
  DECISION,
  FEEDBACK_TYPE,
  FEEDBACK_TYPE_LABELS,
  SEVERITY,
  PRESERVE_ASPECT,
  PRESERVE_ASPECT_LABELS,
  getFeedbackTypesForArtifact,
} from '../../types/feedbackTypes.js';
import { cn } from '../../lib/utils';

/**
 * Approval form component.
 *
 * @param {Object} props
 * @param {Object} props.artifact - Artifact being reviewed
 * @param {Function} props.onSubmit - Submit callback(decision)
 * @param {Function} [props.onCancel] - Cancel callback
 * @param {Object} [props.initialDecision] - Pre-filled decision
 */
export function ApprovalForm({ artifact, onSubmit, onCancel, initialDecision }) {
  const [selectedDecision, setSelectedDecision] = useState(initialDecision?.decision || null);
  const [feedback, setFeedback] = useState(initialDecision?.feedback || '');

  // Structured feedback fields (only for REGENERATE/REQUEST_REVISION)
  const [feedbackType, setFeedbackType] = useState(
    initialDecision?.decisionMetadata?.feedbackType || ''
  );
  const [severity, setSeverity] = useState(
    initialDecision?.decisionMetadata?.severity || SEVERITY.MEDIUM
  );
  const [preserveAspects, setPreserveAspects] = useState(
    initialDecision?.decisionMetadata?.preserveAspects || []
  );

  const needsStructuredFeedback =
    selectedDecision === DECISION.REGENERATE ||
    selectedDecision === DECISION.REQUEST_REVISION;

  const relevantFeedbackTypes = getFeedbackTypesForArtifact(artifact.type);

  // Decision button configurations
  const decisions = [
    {
      value: DECISION.APPROVED,
      label: 'Approve',
      icon: Check,
      className: 'border-signal-scale/30 hover:bg-signal-scale/10 text-signal-scale',
    },
    {
      value: DECISION.REGENERATE,
      label: 'Regenerate',
      icon: RotateCcw,
      className: 'border-signal-hold/30 hover:bg-signal-hold/10 text-signal-hold',
    },
    {
      value: DECISION.REQUEST_REVISION,
      label: 'Request Revision',
      icon: Edit,
      className: 'border-lumi-gold/30 hover:bg-lumi-gold/10 text-lumi-gold',
    },
    {
      value: DECISION.REJECTED,
      label: 'Reject',
      icon: X,
      className: 'border-signal-kill/30 hover:bg-signal-kill/10 text-signal-kill',
    },
    {
      value: DECISION.ESCALATE,
      label: 'Escalate',
      icon: AlertTriangle,
      className: 'border-dark-muted/30 hover:bg-surface-dark/50 text-dark-muted',
    },
  ];

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!selectedDecision) {
      toast.error('Please select a decision');
      return;
    }

    const decision = {
      decision: selectedDecision,
      feedback: feedback.trim() || null,
    };

    // Add structured feedback for REGENERATE/REQUEST_REVISION
    if (needsStructuredFeedback) {
      decision.decisionMetadata = {
        feedbackType: feedbackType || null,
        severity,
        preserveAspects: preserveAspects.length > 0 ? preserveAspects : null,
      };
    }

    onSubmit(decision);
  };

  const handlePreserveAspectToggle = (aspect) => {
    setPreserveAspects(prev =>
      prev.includes(aspect)
        ? prev.filter(a => a !== aspect)
        : [...prev, aspect]
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Decision Buttons */}
      <div>
        <Text variant="label" intent="primary" className="mb-2">
          Decision
        </Text>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {decisions.map(({ value, label, icon: Icon, className }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSelectedDecision(value)}
              className={cn(
                'flex flex-col items-center gap-2 px-3 py-3 border rounded-lg transition-all',
                'hover:scale-105 active:scale-95',
                selectedDecision === value
                  ? cn(className, 'ring-2 ring-offset-2 ring-offset-surface-card')
                  : 'border-surface-border bg-surface-card text-dark-soft hover:border-surface-border-strong'
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Structured Feedback (conditional) */}
      {needsStructuredFeedback && (
        <div className="p-4 bg-surface-dark/20 border border-surface-border rounded-lg space-y-4">
          <Text variant="label" intent="primary">
            Structured Feedback
          </Text>

          {/* Feedback Type */}
          <div>
            <label htmlFor="feedbackType" className="block text-sm font-medium text-dark-soft mb-1">
              Feedback Type
            </label>
            <select
              id="feedbackType"
              value={feedbackType}
              onChange={(e) => setFeedbackType(e.target.value)}
              className="w-full px-3 py-2 bg-surface-card border border-surface-border rounded text-dark-base focus:outline-none focus:ring-2 focus:ring-lumi-gold/50"
            >
              <option value="">Select feedback type...</option>
              {relevantFeedbackTypes.map(type => (
                <option key={type} value={type}>
                  {FEEDBACK_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          {/* Severity */}
          <div>
            <Text variant="label" intent="secondary" className="mb-2">
              Severity
            </Text>
            <div className="flex gap-3">
              {Object.values(SEVERITY).map(level => (
                <label key={level} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="severity"
                    value={level}
                    checked={severity === level}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="text-lumi-gold focus:ring-lumi-gold/50"
                  />
                  <span className={cn(
                    'text-sm font-medium',
                    severity === level ? 'text-dark-base' : 'text-dark-muted'
                  )}>
                    {level}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Preserve Aspects */}
          <div>
            <Text variant="label" intent="secondary" className="mb-2">
              Preserve (do not change)
            </Text>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.values(PRESERVE_ASPECT).map(aspect => (
                <label key={aspect} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={preserveAspects.includes(aspect)}
                    onChange={() => handlePreserveAspectToggle(aspect)}
                    className="text-lumi-gold focus:ring-lumi-gold/50 rounded"
                  />
                  <span className={cn(
                    'text-sm',
                    preserveAspects.includes(aspect)
                      ? 'text-dark-base font-medium'
                      : 'text-dark-muted group-hover:text-dark-soft'
                  )}>
                    {PRESERVE_ASPECT_LABELS[aspect]}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Free-form Feedback */}
      <div>
        <label htmlFor="feedback" className="block text-sm font-medium text-dark-soft mb-1">
          Feedback {needsStructuredFeedback ? '(optional)' : ''}
        </label>
        <textarea
          id="feedback"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={4}
          placeholder={
            needsStructuredFeedback
              ? 'Add additional context or specific instructions...'
              : 'Explain your decision...'
          }
          className="w-full px-3 py-2 bg-surface-card border border-surface-border rounded text-dark-base placeholder:text-dark-subtle focus:outline-none focus:ring-2 focus:ring-lumi-gold/50 resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={!selectedDecision}
          className={cn(
            'px-4 py-2 rounded-lg font-medium transition-all',
            selectedDecision
              ? 'bg-lumi-gold text-surface-dark hover:bg-lumi-gold/90 active:scale-95'
              : 'bg-surface-dark text-dark-muted cursor-not-allowed'
          )}
        >
          Submit Decision
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg font-medium text-dark-soft hover:text-dark-base hover:bg-surface-dark/50 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
