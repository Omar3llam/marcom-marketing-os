// ============================================================
// useRunSweep Hook Tests
// ------------------------------------------------------------
// Manually steering the agentic loop (re-scan + re-propose). Asserts the POST
// path (no body), the success passthrough ({ loopRun, agenda }), the in-flight
// `sweeping` flag, and honest error surfacing.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRunSweep } from './useRunSweep.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

describe('useRunSweep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /api/lumi/loop/run (no body) and returns the loopRun + agenda', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', loopRun: { loopHealth: 'HEALTHY' }, agenda: [{ id: 'a1' }] } });

    const { result } = renderHook(() => useRunSweep());
    let returned;
    await act(async () => { returned = await result.current.runSweep(); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/loop/run');
    expect(returned.agenda).toHaveLength(1);
    expect(result.current.sweeping).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('surfaces the real backend error and returns null', async () => {
    api.post.mockRejectedValueOnce(new Error('No resolvable workspace.'));
    const { result } = renderHook(() => useRunSweep());
    let returned;
    await act(async () => { returned = await result.current.runSweep(); });

    expect(returned).toBeNull();
    expect(result.current.error?.message).toBe('No resolvable workspace.');
    expect(result.current.sweeping).toBe(false);
  });
});
