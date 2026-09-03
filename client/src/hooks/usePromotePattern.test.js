// ============================================================
// usePromotePattern — C-05 · the authorization, not the one-tap
// ------------------------------------------------------------
// This suite used to assert a single `promote(patternId)` that POSTed to
// /patterns/:id/promote and came back with a ruleId. That call granted Lumi
// standing authority over the account in one click, and R-13 removed it.
//
// What is asserted now is the shape of the replacement: proposing creates
// nothing, granting is a separate act, revoking exists, and every refusal the
// server sends reaches the caller intact.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePromotePattern } from './usePromotePattern.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

describe('usePromotePattern', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the one-call promote is gone', () => {
    const { result } = renderHook(() => usePromotePattern());
    // A surviving `promote()` would be a client path to an ungated grant.
    expect(result.current.promote).toBeUndefined();
  });

  it('requesting files an authorization and returns its id — no rule yet', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', requestId: 'req-9', state: 'PENDING' } });

    const { result } = renderHook(() => usePromotePattern());
    let returned;
    await act(async () => { returned = await result.current.requestPromotion('p1'); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/patterns/p1/promotion-request');
    expect(returned).toMatchObject({ requestId: 'req-9', state: 'PENDING' });
    // Nothing was granted, so nothing names a rule.
    expect(returned.ruleId).toBeUndefined();
    expect(result.current.busyId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('granting is a second, explicit act and is what produces the rule', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', state: 'APPROVED', ruleId: 'rule-9' } });

    const { result } = renderHook(() => usePromotePattern());
    let returned;
    await act(async () => { returned = await result.current.grantPromotion('req-9'); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/promotions/req-9/decision', { decision: 'APPROVED' });
    expect(returned).toMatchObject({ state: 'APPROVED', ruleId: 'rule-9' });
  });

  it('revoking targets the rule, not the pattern', async () => {
    api.post.mockResolvedValueOnce({ data: { ruleId: 'rule-9', episodesClosed: 2 } });

    const { result } = renderHook(() => usePromotePattern());
    let returned;
    await act(async () => { returned = await result.current.revokePromotion('rule-9'); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/guardrails/rule-9/revoke');
    expect(returned).toMatchObject({ ruleId: 'rule-9', episodesClosed: 2 });
  });

  it('no-ops without an id (never fires a POST)', async () => {
    const { result } = renderHook(() => usePromotePattern());
    let returned;
    await act(async () => { returned = await result.current.requestPromotion(undefined); });
    expect(api.post).not.toHaveBeenCalled();
    expect(returned).toBeNull();
  });

  it('surfaces a governance rejection honestly and returns null', async () => {
    api.post.mockRejectedValueOnce(new Error('pattern is CONFLICTED — not promotable'));
    const { result } = renderHook(() => usePromotePattern());
    let returned;
    await act(async () => { returned = await result.current.requestPromotion('p1'); });

    expect(returned).toBeNull();
    expect(result.current.error?.message).toMatch(/not promotable/i);
    expect(result.current.busyId).toBeNull();
  });

  it('a refused grant is not reported as a grant', async () => {
    // The server re-checks the belief at the moment of the decision. A pattern
    // that has degraded since the request is refused, and the caller must not
    // read that as a rule having been created.
    api.post.mockRejectedValueOnce(new Error('BeliefDegraded'));
    const { result } = renderHook(() => usePromotePattern());
    let returned;
    await act(async () => { returned = await result.current.grantPromotion('req-9'); });

    expect(returned).toBeNull();
    expect(result.current.error).toBeTruthy();
  });
});
