// ============================================================
// useCommitAgenda Hook Tests
// ------------------------------------------------------------
// The commit path mints PROPOSED experiments from the proposed agenda. Asserts:
// the POST shape ({ picks: [...] } — full suggestion objects, not ids), the
// success result passthrough, the empty-agenda guard (no no-op POST), and honest
// error surfacing.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCommitAgenda } from './useCommitAgenda.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

const PICKS = [
  { entityId: 'e1', dimension: 'HOOK', metric: 'CTR', hypothesis: 'Sharper hook' },
  { entityId: 'e2', dimension: 'OFFER', metric: 'ROAS', hypothesis: 'Stronger offer' },
];

describe('useCommitAgenda', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the full picks to /api/lumi/tests and returns the result', async () => {
    api.post.mockResolvedValueOnce({
      data: { workspaceId: 'ws', created: 2, variants: 4, testIds: ['t1', 't2'] },
    });

    const { result } = renderHook(() => useCommitAgenda());
    let returned;
    await act(async () => { returned = await result.current.commit(PICKS); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/tests', { picks: PICKS });
    expect(returned).toEqual({ workspaceId: 'ws', created: 2, variants: 4, testIds: ['t1', 't2'] });
    expect(result.current.committing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('filters out picks the backend cannot persist (no entityId/dimension)', async () => {
    api.post.mockResolvedValueOnce({ data: { created: 1 } });
    const { result } = renderHook(() => useCommitAgenda());
    await act(async () => {
      await result.current.commit([{ entityId: 'e1', dimension: 'HOOK' }, { hypothesis: 'orphan, no entity' }]);
    });
    expect(api.post).toHaveBeenCalledWith('/api/lumi/tests', { picks: [{ entityId: 'e1', dimension: 'HOOK' }] });
  });

  it('guards an empty agenda without firing a no-op POST', async () => {
    const { result } = renderHook(() => useCommitAgenda());
    let returned;
    await act(async () => { returned = await result.current.commit([]); });

    expect(api.post).not.toHaveBeenCalled();
    expect(returned).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('surfaces the real backend error and returns null', async () => {
    api.post.mockRejectedValueOnce(new Error('picks[] is required'));
    const { result } = renderHook(() => useCommitAgenda());
    let returned;
    await act(async () => { returned = await result.current.commit(PICKS); });

    expect(returned).toBeNull();
    expect(result.current.error?.message).toBe('picks[] is required');
    expect(result.current.committing).toBe(false);
  });
});
