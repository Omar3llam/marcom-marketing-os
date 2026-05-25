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

  describe('Fetching Artifacts', () => {
    it('should fetch pending artifacts on mount', async () => {
      api.get.mockResolvedValueOnce({
        data: {
          artifacts: mockArtifacts,
          count: 2,
        },
      });

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(api.get).toHaveBeenCalledWith(
        `/api/execute/${mockExecutionId}/artifacts/pending-approval`
      );
      expect(result.current.artifacts).toEqual(mockArtifacts);
      expect(result.current.error).toBeNull();
    });

    it('should handle fetch errors', async () => {
      const errorMessage = 'Failed to fetch artifacts';
      api.get.mockRejectedValueOnce(new Error(errorMessage));

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe(errorMessage);
      expect(result.current.artifacts).toEqual([]);
    });

    it('should handle missing executionId', async () => {
      const { result } = renderHook(() => useArtifactApproval(null));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('No execution ID provided');
      expect(api.get).not.toHaveBeenCalled();
    });
  });

  describe('Decision Management', () => {
    it('should set decision for approval', async () => {
      api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const decision = {
        decision: 'APPROVED',
        feedback: 'Looks good',
      };

      act(() => {
        result.current.setDecision('approval-1', decision);
      });

      expect(result.current.decisions['approval-1']).toEqual(decision);
    });

    it('should clear decision for approval', async () => {
      api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set then clear
      act(() => {
        result.current.setDecision('approval-1', { decision: 'APPROVED' });
      });

      expect(result.current.decisions['approval-1']).toBeDefined();

      act(() => {
        result.current.clearDecision('approval-1');
      });

      expect(result.current.decisions['approval-1']).toBeUndefined();
    });

    it('should validate structured feedback before setting decision', async () => {
      api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const invalidDecision = {
        decision: 'REGENERATE',
        decisionMetadata: {
          preserveAspects: 'not-an-array', // Should be array
        },
      };

      expect(() => {
        act(() => {
          result.current.setDecision('approval-1', invalidDecision);
        });
      }).toThrow(/Invalid structured feedback/);
    });
  });

  describe('Refetch', () => {
    it('should refetch artifacts on demand', async () => {
      api.get.mockResolvedValueOnce({ data: { artifacts: mockArtifacts } });

      const { result } = renderHook(() => useArtifactApproval(mockExecutionId));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(api.get).toHaveBeenCalledTimes(1);

      // Refetch
      api.get.mockResolvedValueOnce({ data: { artifacts: [] } });

      await act(async () => {
        await result.current.refetch();
      });

      expect(api.get).toHaveBeenCalledTimes(2);
      expect(result.current.artifacts).toEqual([]);
    });
  });
});
