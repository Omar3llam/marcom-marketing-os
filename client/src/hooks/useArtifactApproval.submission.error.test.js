// ============================================================
// useArtifactApproval Hook Tests — Submission Error Path
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useArtifactApproval } from './useArtifactApproval.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('useArtifactApproval Hook — Submission Errors', () => {
  const mockExecutionId = 'exec-123';

  const mockArtifacts = [
    {
      id: 'artifact-1',
      type: 'ad_copy',
      content: 'Test ad copy content',
      size: 1024,
      createdAt: '2026-05-25T10:00:00Z',
      approval: { id: 'approval-1', status: 'PENDING' },
    },
    {
      id: 'artifact-2',
      type: 'visual_brief',
      content: 'Test visual brief',
      size: 2048,
      createdAt: '2026-05-25T10:05:00Z',
      approval: { id: 'approval-2', status: 'PENDING' },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle submission errors', async () => {
    api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });
    api.post.mockRejectedValueOnce(new Error('Submission failed'));

    const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setDecision('approval-1', { decision: 'APPROVED' });
      result.current.setDecision('approval-2', { decision: 'APPROVED' });
    });

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
