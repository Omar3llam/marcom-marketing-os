// ============================================================
// useStartTest Hook Tests
// ------------------------------------------------------------
// Starting a committed PROPOSED experiment (PROPOSED → RUNNING). Asserts the
// POST path (no body), the success passthrough, the in-flight startingId, and
// honest error surfacing.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStartTest } from './useStartTest.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

describe('useStartTest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /api/lumi/tests/:id/start (no body) and returns the response', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', test: { id: 't1', status: 'RUNNING' } } });

    const { result } = renderHook(() => useStartTest());
    let returned;
    await act(async () => { returned = await result.current.start('t1'); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/tests/t1/start');
    expect(returned).toEqual({ workspaceId: 'ws', test: { id: 't1', status: 'RUNNING' } });
    expect(result.current.startingId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('no-ops without an id (never fires a POST)', async () => {
    const { result } = renderHook(() => useStartTest());
    let returned;
    await act(async () => { returned = await result.current.start(undefined); });
    expect(api.post).not.toHaveBeenCalled();
    expect(returned).toBeNull();
  });

  it('surfaces the real backend error and returns null', async () => {
    api.post.mockRejectedValueOnce(new Error('No resolvable workspace.'));
    const { result } = renderHook(() => useStartTest());
    let returned;
    await act(async () => { returned = await result.current.start('t1'); });

    expect(returned).toBeNull();
    expect(result.current.error?.message).toBe('No resolvable workspace.');
    expect(result.current.startingId).toBeNull();
  });
});
