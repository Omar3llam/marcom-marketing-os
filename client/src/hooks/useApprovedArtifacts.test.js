// ============================================================
// useApprovedArtifacts Hook Tests
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useApprovedArtifacts } from './useApprovedArtifacts.js';
import { api } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn() } }));

describe('useApprovedArtifacts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches approved artifacts from the workspace-wide endpoint', async () => {
    const arts = [{ id: 'a1', approval: { status: 'COMPLETED', decision: 'APPROVED' } }];
    api.get.mockResolvedValueOnce({ data: { artifacts: arts } });

    const { result } = renderHook(() => useApprovedArtifacts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(api.get).toHaveBeenCalledWith(
      '/api/execute/artifacts/approved',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result.current.artifacts).toEqual(arts);
    expect(result.current.error).toBeNull();
  });

  it('defaults to an empty list when the payload omits artifacts', async () => {
    api.get.mockResolvedValueOnce({ data: {} });
    const { result } = renderHook(() => useApprovedArtifacts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.artifacts).toEqual([]);
  });

  it('surfaces an error message on failure', async () => {
    api.get.mockRejectedValueOnce(new Error('Boom'));
    const { result } = renderHook(() => useApprovedArtifacts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Boom');
    expect(result.current.artifacts).toEqual([]);
  });
});
