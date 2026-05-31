// ============================================================
// useArtifactApproval Hook — PR #36: Approval Workflow
// ============================================================
// Manages artifact approval workflow state and API integration.
//
// RESPONSIBILITIES:
//   - Fetch pending artifacts for execution
//   - Track approval decisions (local state)
//   - Validate structured feedback
//   - Submit batch decisions to resume endpoint
//   - Handle loading/error states
//
// USAGE:
//   const {
//     artifacts,
//     loading,
//     error,
//     decisions,
//     setDecision,
//     clearDecision,
//     submitDecisions,
//     canSubmit,
//   } = useArtifactApproval(executionId);
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';

/**
 * Validate structured feedback client-side.
 *
 * @param {Object} structuredFeedback - { feedbackType?, severity?, preserveAspects? }
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateStructuredFeedback(structuredFeedback) {
  const errors = [];

  if (!structuredFeedback) {
    return { valid: true, errors: [] };
  }

  // Basic validation - backend will do full validation
  if (structuredFeedback.preserveAspects && !Array.isArray(structuredFeedback.preserveAspects)) {
    errors.push('preserveAspects must be an array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Hook for managing artifact approval workflow.
 *
 * @param {string} executionId - Execution ID to fetch artifacts for
 * @returns {Object} Approval state and actions
 */
export function useArtifactApproval(executionId) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Map of approvalId -> decision object
  const [decisions, setDecisions] = useState({});

  // ── Fetch pending artifacts ───────────────────────────────
  const fetchArtifacts = useCallback(async (signal) => {
    if (!executionId) {
      setError('No execution ID provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.get(
        `/api/execute/${executionId}/artifacts/pending-approval`,
        { signal }
      );

      setArtifacts(response.data.artifacts || []);
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      console.error('[useArtifactApproval] Failed to fetch artifacts:', err);
      setError(err.message || 'Failed to load pending artifacts');
    } finally {
      setLoading(false);
    }
  }, [executionId]);

  // Fetch on mount and when executionId changes
  useEffect(() => {
    const controller = new AbortController();
    fetchArtifacts(controller.signal);
    return () => controller.abort();
  }, [fetchArtifacts]);

  // ── Decision management ────────────────────────────────────

  /**
   * Set decision for an approval.
   *
   * @param {string} approvalId - Approval record ID
   * @param {Object} decision - Decision object
   * @param {string} decision.decision - APPROVED | REJECTED | REGENERATE | REQUEST_REVISION | ESCALATE
   * @param {string} [decision.feedback] - Free-form feedback text
   * @param {Object} [decision.decisionMetadata] - Structured feedback
   */
  const setDecision = useCallback((approvalId, decision) => {
    // Validate structured feedback if provided
    if (decision.decisionMetadata) {
      const validation = validateStructuredFeedback(decision.decisionMetadata);
      if (!validation.valid) {
        console.error('[useArtifactApproval] Invalid structured feedback:', validation.errors);
        throw new Error(`Invalid structured feedback: ${validation.errors.join(', ')}`);
      }
    }

    setDecisions(prev => ({
      ...prev,
      [approvalId]: decision,
    }));
  }, []);

  /**
   * Clear decision for an approval.
   *
   * @param {string} approvalId - Approval record ID
   */
  const clearDecision = useCallback((approvalId) => {
    setDecisions(prev => {
      const next = { ...prev };
      delete next[approvalId];
      return next;
    });
  }, []);

  /**
   * Check if all pending approvals have decisions.
   *
   * @returns {boolean}
   */
  const canSubmit = useCallback(() => {
    if (artifacts.length === 0) return false;

    const approvalIds = artifacts
      .filter(a => a.approval?.status === 'PENDING')
      .map(a => a.approval.id);

    return approvalIds.every(id => decisions[id]?.decision);
  }, [artifacts, decisions]);

  /**
   * Submit all decisions and resume execution.
   *
   * @returns {Promise<Object>} Resume result
   */
  const submitDecisions = useCallback(async () => {
    if (!canSubmit()) {
      throw new Error('Cannot submit: not all approvals have decisions');
    }

    setSubmitting(true);
    setError(null);

    try {
      // Build decisions array for API
      const decisionsArray = artifacts
        .filter(a => a.approval?.status === 'PENDING')
        .map(a => {
          const decision = decisions[a.approval.id];
          return {
            approvalId: a.approval.id,
            decision: decision.decision,
            feedback: decision.feedback || null,
            decisionMetadata: decision.decisionMetadata || null,
          };
        });

      const response = await api.post(
        `/api/execute/${executionId}/resume`,
        { decisions: decisionsArray }
      );

      // Clear local decisions on success
      setDecisions({});

      return response.data;
    } catch (err) {
      console.error('[useArtifactApproval] Failed to submit decisions:', err);
      setError(err.message || 'Failed to submit approval decisions');
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [executionId, artifacts, decisions, canSubmit]);

  return {
    artifacts,
    loading,
    error,
    submitting,
    decisions,
    setDecision,
    clearDecision,
    canSubmit: canSubmit(),
    submitDecisions,
    refetch: fetchArtifacts,
  };
}
