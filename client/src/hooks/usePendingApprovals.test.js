// ============================================================
// usePendingApprovals Hook Tests
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePendingApprovals } from './usePendingApprovals.js';
import { api } from '../lib/api.js';
import { useWorkspace } from './useWorkspace.js';

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('./useWorkspace.js', () => ({ useWorkspace: vi.fn() }));

const WS = '7517d1b9-b967-44f3-a77f-60f5c577f867';

describe('usePendingApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspace.mockReturnValue({ workspace: { id: WS }, loading: false });
  });

  it('fetches from the workspace-scoped pending endpoint (under /api/artifacts)', async () => {
    api.get.mockResolvedValueOnce({ data: { approvals: [] } });

    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(api.get).toHaveBeenCalledWith(
      `/api/artifacts/workspaces/${WS}/approvals/pending`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('transforms approval-wrapped rows into ArtifactCard shape (flat artifact + nested approval)', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        approvals: [
          {
            id: 'ap-1',
            status: 'PENDING',
            artifact: { id: 'art-1', type: 'hook', executionId: 'exec-9', nodeId: 'n1' },
          },
        ],
      },
    });

    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pending).toEqual([
      {
        id: 'art-1',
        type: 'hook',
        executionId: 'exec-9',
        nodeId: 'n1',
        approval: { id: 'ap-1', status: 'PENDING' },
      },
    ]);
  });

  it('defaults to an empty list when the payload omits approvals', async () => {
    api.get.mockResolvedValueOnce({ data: {} });
    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pending).toEqual([]);
  });

  it('surfaces an error message on failure', async () => {
    api.get.mockRejectedValueOnce(new Error('Boom'));
    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Boom');
    expect(result.current.pending).toEqual([]);
  });

  it('settles to empty without calling the API when there is no workspace yet', async () => {
    useWorkspace.mockReturnValue({ workspace: null, loading: false });
    const { result } = renderHook(() => usePendingApprovals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual([]);
  });
});
