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
      className: 'border-signal-success/30 hover:bg-signal-success/10 text-signal-success',
    },
    {
      value: DECISION.REGENERATE,
      label: 'Regenerate',
      icon: RotateCcw,
      className: 'border-signal-warning/30 hover:bg-signal-warning/10 text-signal-warning',
    },
    {
      value: DECISION.REQUEST_REVISION,
      label: 'Request Revision',
      icon: Edit,
      className: 'border-brand-gold/30 hover:bg-brand-gold/10 text-brand-gold',
    },
    {
      value: DECISION.REJECTED,
      label: 'Reject',
      icon: X,
      className: 'border-signal-danger/30 hover:bg-signal-danger/10 text-signal-danger',
    },
    {
      value: DECISION.ESCALATE,
      label: 'Escalate',
      icon: AlertTriangle,
      className: 'border-text-muted/30 hover:bg-surface-dark/50 text-text-muted',
    },
  ];

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!selectedDecision) {
      alert('Please select a decision');
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
                  ? cn(className, 'ring-2 ring-offset-2 ring-offset-surface-base')
                  : 'border-border-subtle bg-surface-base text-text-secondary hover:border-border-base'
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
        <div className="p-4 bg-surface-dark/20 border border-border-subtle rounded-lg space-y-4">
          <Text variant="label" intent="primary">
            Structured Feedback
          </Text>

          {/* Feedback Type */}
          <div>
            <label htmlFor="feedbackType" className="block text-sm font-medium text-text-secondary mb-1">
              Feedback Type
            </label>
            <select
              id="feedbackType"
              value={feedbackType}
              onChange={(e) => setFeedbackType(e.target.value)}
              className="w-full px-3 py-2 bg-surface-base border border-border-subtle rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-gold/50"
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
                    className="text-brand-gold focus:ring-brand-gold/50"
                  />
                  <span className={cn(
                    'text-sm font-medium',
                    severity === level ? 'text-text-primary' : 'text-text-muted'
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
                    className="text-brand-gold focus:ring-brand-gold/50 rounded"
                  />
                  <span className={cn(
                    'text-sm',
                    preserveAspects.includes(aspect)
                      ? 'text-text-primary font-medium'
                      : 'text-text-muted group-hover:text-text-secondary'
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
        <label htmlFor="feedback" className="block text-sm font-medium text-text-secondary mb-1">
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
          className="w-full px-3 py-2 bg-surface-base border border-border-subtle rounded text-text-primary placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-brand-gold/50 resize-none"
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
              ? 'bg-brand-gold text-surface-dark hover:bg-brand-gold/90 active:scale-95'
              : 'bg-surface-dark text-text-muted cursor-not-allowed'
          )}
        >
          Submit Decision
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg font-medium text-text-secondary hover:text-text-primary hover:bg-surface-dark/50 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
