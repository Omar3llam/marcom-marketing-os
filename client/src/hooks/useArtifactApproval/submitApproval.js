// ============================================================
// submitApproval — Extracted approval submission logic
// ============================================================
// Handles the batch submission of artifact approval decisions
// to the resume endpoint. Extracted from useArtifactApproval
// for code size compliance (hook was 213 LOC).
//
// RESPONSIBILITIES:
//   - Validate canSubmit state
//   - Transform decisions map into API array format
//   - POST to /api/execute/:executionId/resume
//   - Clear local decisions on success
//   - Handle errors with structured state updates
// ============================================================
import { api } from '../../lib/api.js';

/**
 * Submit all approval decisions and resume execution.
 *
 * @param {Object} params - Submission parameters
 * @param {string} params.executionId - Execution ID
 * @param {Array} params.artifacts - Pending artifacts
 * @param {Object} params.decisions - Map of approvalId -> decision
 * @param {Function} params.canSubmit - Validation callback
 * @param {Function} params.setSubmitting - Loading state setter
 * @param {Function} params.setError - Error state setter
 * @param {Function} params.setDecisions - Decisions state setter
 * @returns {Promise<Object>} Resume API response data
 */
export async function submitApproval({
  executionId,
  artifacts,
  decisions,
  canSubmit,
  setSubmitting,
  setError,
  setDecisions,
}) {
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
}
