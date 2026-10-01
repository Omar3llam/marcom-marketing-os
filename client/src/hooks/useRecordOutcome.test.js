// ============================================================
// useRecordOutcome Hook Tests
// ------------------------------------------------------------
// The human-asserted outcome writer for an EXECUTED decision. Asserts: it POSTs
// the body to /decisions/:id/outcome and returns { outcome }; it no-ops (no
// request) without a decision id or body; and it surfaces a real error honestly
// while returning null.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRecordOutcome } from './useRecordOutcome.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

const BODY = {
  spendDeltaMinor: -420000, revenueDeltaMinor: 1820000, roasDelta: 1.8,
  windowStart: '2026-06-01T00:00:00.000Z', windowEnd: '2026-06-08T00:00:00.000Z', sustained: true,
};

describe('useRecordOutcome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not recover submitted money into the backend-withheld Outcome receipt', async () => {
    const outcome = { id: 'o1', spendDeltaMinor: null, revenueDeltaMinor: null, currency: null,
      roasDelta: BODY.roasDelta, sustained: BODY.sustained,
      monetary: { status: 'INSUFFICIENT_EVIDENCE', reason: 'OUTCOME_MONETARY_BASIS_UNPROVEN',
        knowledge: 'NOT_ENOUGH', spendDeltaMinor: null, revenueDeltaMinor: null, currency: null } };
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', decisionId: 'd-1', outcome } });
    const { result } = renderHook(() => useRecordOutcome());
    let returned;
    await act(async () => { returned = await result.current.record('d-1', BODY); });
    expect(returned.outcome).toEqual(outcome);
    expect(JSON.stringify(returned.outcome)).not.toContain('420000');
    expect(JSON.stringify(returned.outcome)).not.toContain('1820000');
    expect(JSON.stringify(returned.outcome)).not.toContain('USD');
  });

  it('POSTs the body to /decisions/:id/outcome and returns the response', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', decisionId: 'd-1', outcome: { id: 'o-1' } } });

    const { result } = renderHook(() => useRecordOutcome());
    let returned;
    await act(async () => { returned = await result.current.record('d-1', BODY); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/decisions/d-1/outcome', BODY);
    expect(returned).toEqual({ workspaceId: 'ws', decisionId: 'd-1', outcome: { id: 'o-1' } });
    expect(result.current.error).toBeNull();
  });

  it('no-ops (no request) without a decision id or a body', async () => {
    const { result } = renderHook(() => useRecordOutcome());
    let a; let b;
    await act(async () => { a = await result.current.record(undefined, BODY); });
    await act(async () => { b = await result.current.record('d-1', null); });
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('surfaces a real error and returns null', async () => {
    api.post.mockRejectedValueOnce(new Error('decision is not EXECUTED'));
    const { result } = renderHook(() => useRecordOutcome());
    let returned;
    await act(async () => { returned = await result.current.record('d-1', BODY); });
    expect(returned).toBeNull();
    expect(result.current.error?.message).toBe('decision is not EXECUTED');
  });
});
