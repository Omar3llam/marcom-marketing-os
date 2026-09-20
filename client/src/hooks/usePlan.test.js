// ============================================================
// usePlan — feature-gating entitlement derivation
// ------------------------------------------------------------
// Pins the hierarchy (FREE < GROWTH < PRO): canAccess is monotonic and an
// undefined requirement is ungated. useWorkspace is mocked so no network/auth
// is needed.
//
// Phase 5.9 — the second half of this file pins the distinction the hook used
// to lack. `workspace?.plan ?? 'FREE'` made a 500, a 403, an absent workspace
// and a plan-less 200 all resolve to a CONFIDENT FREE, which the route gate
// then sold as "upgrade to unlock". Entitlement is now claimed only from
// WORKSPACE_READ.PRESENT; everything else is `plan: null` and locked.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/hooks/useWorkspace.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useWorkspace: vi.fn() };
});

import { usePlan } from './usePlan.js';
import { useWorkspace, WORKSPACE_READ } from '@/hooks/useWorkspace.js';

/** A workspace that was READ successfully, carrying `plan`. */
const asPlan = (plan, loading = false) =>
  useWorkspace.mockReturnValue({
    workspace: plan === undefined ? null : { plan },
    loading,
    status: WORKSPACE_READ.PRESENT,
  });

/** A read that did NOT establish an entitlement. */
const asStatus = (status, { workspace = null, loading = false } = {}) =>
  useWorkspace.mockReturnValue({ workspace, loading, status });

beforeEach(() => vi.clearAllMocks());

describe('usePlan — a plan that WAS read', () => {
  it('FREE reaches only FREE', () => {
    asPlan('FREE');
    const { result } = renderHook(() => usePlan());
    expect(result.current.plan).toBe('FREE');
    expect(result.current.isFree).toBe(true);
    expect(result.current.isGrowth).toBe(false);
    expect(result.current.isPro).toBe(false);
    expect(result.current.canAccess('FREE')).toBe(true);
    expect(result.current.canAccess('GROWTH')).toBe(false);
    expect(result.current.canAccess('PRO')).toBe(false);
  });

  it('GROWTH reaches FREE + GROWTH but not PRO', () => {
    asPlan('GROWTH');
    const { result } = renderHook(() => usePlan());
    expect(result.current.isGrowth).toBe(true);
    expect(result.current.isPro).toBe(false);
    expect(result.current.canAccess('GROWTH')).toBe(true);
    expect(result.current.canAccess('PRO')).toBe(false);
  });

  it('PRO reaches everything', () => {
    asPlan('PRO');
    const { result } = renderHook(() => usePlan());
    expect(result.current.isPro).toBe(true);
    expect(result.current.isGrowth).toBe(true);
    expect(result.current.canAccess('PRO')).toBe(true);
    expect(result.current.canAccess('GROWTH')).toBe(true);
  });

  it('an undefined requirement is ungated (always accessible)', () => {
    asPlan('FREE');
    const { result } = renderHook(() => usePlan());
    expect(result.current.canAccess(undefined)).toBe(true);
  });

  it('passes through the workspace loading flag (so gates can wait)', () => {
    asPlan('PRO', true);
    const { result } = renderHook(() => usePlan());
    expect(result.current.loading).toBe(true);
  });

  it('passes the workspace status through, so a gate can tell absence from a tier', () => {
    asPlan('PRO');
    const { result } = renderHook(() => usePlan());
    expect(result.current.status).toBe(WORKSPACE_READ.PRESENT);
  });
});

describe('usePlan — an entitlement that was NOT established', () => {
  // This was `an absent workspace/plan floors to FREE (never unlocked by
  // default)`. The INTENT — never unlocked by default — is kept and asserted
  // below; the claim that absence IS FREE was the defect, so the assertion is
  // corrected rather than the test removed.
  it('an absent workspace is not unlocked — and is not FREE either', () => {
    asStatus(WORKSPACE_READ.NOTHING_FOUND);
    const { result } = renderHook(() => usePlan());
    expect(result.current.canAccess('GROWTH')).toBe(false);
    expect(result.current.canAccess('PRO')).toBe(false);
    expect(result.current.plan).toBeNull();
    expect(result.current.plan).not.toBe('FREE');
    expect(result.current.isFree).toBe(false);
  });

  it.each([
    ['a failed read', WORKSPACE_READ.NOT_REACHABLE],
    ['a refused read', WORKSPACE_READ.NOT_PERMITTED],
    ['an absent workspace', WORKSPACE_READ.NOTHING_FOUND],
  ])('%s yields plan:null, never FREE', (_label, status) => {
    asStatus(status);
    const { result } = renderHook(() => usePlan());
    expect(result.current.plan).toBeNull();
    expect(result.current.isFree).toBe(false);
    expect(result.current.isGrowth).toBe(false);
    expect(result.current.isPro).toBe(false);
    expect(result.current.status).toBe(status);
  });

  it.each([
    WORKSPACE_READ.NOT_REACHABLE,
    WORKSPACE_READ.NOT_PERMITTED,
    WORKSPACE_READ.NOTHING_FOUND,
    WORKSPACE_READ.LOADING,
  ])('%s never grants access to a gated tier', (status) => {
    asStatus(status);
    const { result } = renderHook(() => usePlan());
    expect(result.current.canAccess('FREE')).toBe(false);
    expect(result.current.canAccess('GROWTH')).toBe(false);
    expect(result.current.canAccess('PRO')).toBe(false);
    // Refusing is the safe direction; an UNGATED surface stays reachable.
    expect(result.current.canAccess(undefined)).toBe(true);
  });

  it('a workspace record whose plan is unreadable does NOT become a tier', () => {
    // The record arrived (the Sidebar can still show its name) but useWorkspace
    // classified the entitlement as unreadable. usePlan must follow the STATUS,
    // not the object — reading `workspace.plan` here is the old bug's shape.
    asStatus(WORKSPACE_READ.NOT_REACHABLE, { workspace: { id: 'w1', plan: 'PRO' } });
    const { result } = renderHook(() => usePlan());
    expect(result.current.plan).toBeNull();
    expect(result.current.canAccess('PRO')).toBe(false);
  });

  it('REGRESSION: no status resolves to the string FREE except a read FREE plan', () => {
    for (const status of Object.values(WORKSPACE_READ)) {
      asStatus(status, { workspace: { plan: 'PRO' } });
      const { result } = renderHook(() => usePlan());
      if (status === WORKSPACE_READ.PRESENT) expect(result.current.plan).toBe('PRO');
      else expect(result.current.plan).toBeNull();
    }
  });
});
