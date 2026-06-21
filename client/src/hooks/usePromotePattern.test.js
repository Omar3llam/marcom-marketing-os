// ============================================================
// usePromotePattern Hook Tests
// ------------------------------------------------------------
// Promoting a proven AccountPattern to a GuardrailRule. Asserts the POST path
// (no body), the success passthrough ({ ruleId }), the in-flight promotingId,
// and honest surfacing of the backend's 409 governance rejection.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePromotePattern } from './usePromotePattern.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

describe('usePromotePattern', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /api/lumi/patterns/:id/promote (no body) and returns the ruleId', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', ruleId: 'rule-9' } });

    const { result } = renderHook(() => usePromotePattern());
    let returned;
    await act(async () => { returned = await result.current.promote('p1'); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/patterns/p1/promote');
    expect(returned).toEqual({ workspaceId: 'ws', ruleId: 'rule-9' });
    expect(result.current.promotingId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('no-ops without an id (never fires a POST)', async () => {
    const { result } = renderHook(() => usePromotePattern());
    let returned;
    await act(async () => { returned = await result.current.promote(undefined); });
    expect(api.post).not.toHaveBeenCalled();
    expect(returned).toBeNull();
  });

  it('surfaces the backend governance rejection (409) honestly and returns null', async () => {
    api.post.mockRejectedValueOnce(new Error('pattern is CONFLICTED — not promotable'));
    const { result } = renderHook(() => usePromotePattern());
    let returned;
    await act(async () => { returned = await result.current.promote('p1'); });

    expect(returned).toBeNull();
    expect(result.current.error?.message).toMatch(/not promotable/i);
    expect(result.current.promotingId).toBeNull();
  });
});
