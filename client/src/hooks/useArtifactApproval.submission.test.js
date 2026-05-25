// ============================================================
// useArtifactApproval Hook Tests — PR #36
// ============================================================
// Tests artifact approval workflow state management and API integration.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useArtifactApproval } from './useArtifactApproval.js';
import { api } from '../lib/api.js';

// Mock API client
vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('useArtifactApproval Hook — PR #36', () => {
  const mockExecutionId = 'exec-123';

  const mockArtifacts = [
    {
      id: 'artifact-1',
      type: 'ad_copy',
      content: 'Test ad copy content',
      size: 1024,
      createdAt: '2026-05-25T10:00:00Z',
      approval: {
        id: 'approval-1',
        status: 'PENDING',
      },
    },
    {
      id: 'artifact-2',
      type: 'visual_brief',
      content: 'Test visual brief',
      size: 2048,
      createdAt: '2026-05-25T10:05:00Z',
      approval: {
        id: 'approval-2',
        status: 'PENDING',
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe('Submission', () => {
    it('should not allow submission when not all decisions are made', async () => {
      api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Only decide on first artifact
      act(() => {
        result.current.setDecision('approval-1', { decision: 'APPROVED' });
      });

      expect(result.current.canSubmit).toBe(false);
    });

    it('should allow submission when all decisions are made', async () => {
      api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Decide on all artifacts
      act(() => {
        result.current.setDecision('approval-1', { decision: 'APPROVED' });
        result.current.setDecision('approval-2', { decision: 'REGENERATE' });
      });

      expect(result.current.canSubmit).toBe(true);
    });

    it('should submit decisions and resume execution', async () => {
      api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });
      api.post.mockResolvedValueOnce({
        data: {
          success: true,
          executionId: mockExecutionId,
          status: 'RESUMED',
          reExecuted: true,
        },
      });

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Make all decisions
      act(() => {
        result.current.setDecision('approval-1', {
          decision: 'APPROVED',
          feedback: 'Good',
        });
        result.current.setDecision('approval-2', {
          decision: 'REGENERATE',
          feedback: 'Try again',
          decisionMetadata: {
            feedbackType: 'visual_concept',
            severity: 'HIGH',
            preserveAspects: ['color_palette'],
          },
        });
      });

      let submitResult;
      await act(async () => {
        submitResult = await result.current.submitDecisions();
      });

      expect(api.post).toHaveBeenCalledWith(
        `/api/execute/${mockExecutionId}/resume`,
        {
          decisions: [
            {
              approvalId: 'approval-1',
              decision: 'APPROVED',
              feedback: 'Good',
              decisionMetadata: null,
            },
            {
              approvalId: 'approval-2',
              decision: 'REGENERATE',
              feedback: 'Try again',
              decisionMetadata: {
                feedbackType: 'visual_concept',
                severity: 'HIGH',
                preserveAspects: ['color_palette'],
              },
            },
          ],
        }
      );

      expect(submitResult.success).toBe(true);
      expect(result.current.decisions).toEqual({}); // Cleared on success
    });

    it('should handle submission errors', async () => {
      api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });
      api.post.mockRejectedValueOnce(new Error('Submission failed'));

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Make all decisions
      act(() => {
        result.current.setDecision('approval-1', { decision: 'APPROVED' });
        result.current.setDecision('approval-2', { decision: 'APPROVED' });
      });

      // Submit should reject
      let submitError;
      await act(async () => {
        try {
          await result.current.submitDecisions();
        } catch (err) {
          submitError = err;
        }
      });

      expect(submitError).toBeDefined();
      expect(submitError.message).toBe('Submission failed');
      expect(result.current.submitting).toBe(false);
    });

    it('should not submit if canSubmit is false', async () => {
      api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // No decisions made
      await expect(async () => {
        await act(async () => {
          await result.current.submitDecisions();
        });
      }).rejects.toThrow(/Cannot submit/);

      expect(api.post).not.toHaveBeenCalled();
    });
  });

});
