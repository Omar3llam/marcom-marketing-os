// ============================================================
// useApprovals — Tier 2a: a governance queue fails CLOSED
// ------------------------------------------------------------
// RULING (Omar): "An unreadable row is never equivalent to an absent row."
// And for governance specifically — FAIL CLOSED:
//
//     لا تختفي · لا تتحول إلى "No plans awaiting approval"
//     لا يتم اعتبارها counted / actionable
//     → يظهر أن هناك item غير قابل للقراءة  → governance action لا تتم
//
// What stood here dropped the row and said nothing:
//
//     const raw = Array.isArray(res.data?.approvals) ? res.data.approvals : [];
//     for (const a of raw) { const r = …safeParse(a); if (r.success) parsed.push(r.data); }
//
// so a queue whose rows all failed the contract rendered "No plans awaiting
// your approval." — under a promise reading "When someone submits a plan for
// sign-off, it shows up here" — while the plans sat PENDING on the server. An
// authorization that can never be granted or denied through the product.
//
// The hook's own header called this "dropped rather than rendered as junk".
// That was a stated policy, and the ruling replaces it: legacy, not future law.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useApprovals } from './useApprovals.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const approval = (over = {}) => ({
  id: 'req1', workspaceId: 'w1', planId: 'p1', subjectType: 'PLAN', subjectId: 'p1',
  requestedById: 'u1', state: 'PENDING', reason: null, decidedById: null, decidedAt: null,
  createdAt: '2026-06-20T00:00:00.000Z',
  plan: {
    id: 'p1', name: 'Q3 growth plan', periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-09-30T00:00:00.000Z', totalBudgetMinor: 5000000,
    currency: 'USD', status: 'DRAFT',
  },
  ...over,
});

const load = async (data) => {
  api.get.mockResolvedValue({ data });
  const { result } = renderHook(() => useApprovals());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
};

describe('useApprovals · an unreadable authorization does not vanish', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a row that fails the contract is COUNTED as unreadable, not dropped', async () => {
    const { id, ...noId } = approval();
    expect(id).toBeDefined();
    const r = await load({ approvals: [approval(), noId] });
    expect(r.current.pendingApprovals).toHaveLength(1);
    expect(r.current.unreadableCount).toBe(1);
  });

  it('a queue whose every row is unreadable is NOT an empty queue', async () => {
    // The defect: this used to be indistinguishable from "nothing is awaiting
    // you", while the plans stayed PENDING.
    const r = await load({ approvals: [{ nonsense: true }, { alsoNonsense: true }] });
    expect(r.current.pendingApprovals).toEqual([]);
    expect(r.current.unreadableCount).toBe(2);
  });

  it('an unreadable row is never handed back as if it were decidable', async () => {
    const r = await load({ approvals: [{ id: 'req9', state: 'PENDING' }] });
    // Not present in the actionable collection at all — "not counted /
    // actionable" is the ruling, so it may not be smuggled in with holes in it.
    expect(r.current.pendingApprovals).toHaveLength(0);
    expect(r.current.unreadableCount).toBe(1);
  });

  it('a MISSING approvals collection is an error, not an empty queue', async () => {
    const r = await load({ workspaceId: 'w1' });
    expect(r.current.error).toBeTruthy();
    expect(r.current.error.message).toMatch(/contract validation/i);
    expect(r.current.pendingApprovals).toEqual([]);
  });

  it('a RENAMED collection is an error too', async () => {
    const r = await load({ requests: [approval()] });
    expect(r.current.error).toBeTruthy();
  });

  // ── self-refutation: emptiness and health are still expressible ───────────
  it('a genuinely empty queue is empty, with nothing unreadable and no error', async () => {
    const r = await load({ approvals: [] });
    expect(r.current.error).toBeNull();
    expect(r.current.pendingApprovals).toEqual([]);
    expect(r.current.unreadableCount).toBe(0);
  });

  it('…and valid rows still arrive intact and decidable', async () => {
    const r = await load({ approvals: [approval()] });
    expect(r.current.error).toBeNull();
    expect(r.current.unreadableCount).toBe(0);
    expect(r.current.pendingApprovals[0].plan.name).toBe('Q3 growth plan');
  });
});
