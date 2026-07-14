// ============================================================
// usePlan — feature-gating entitlement derivation
// ------------------------------------------------------------
// Pins the hierarchy (FREE < GROWTH < PRO): canAccess is monotonic, an absent
// plan floors to FREE (never fabricated as unlocked), and an undefined
// requirement is ungated. useWorkspace is mocked so no network/auth is needed.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: vi.fn() }));

import { usePlan } from './usePlan.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';

const asPlan = (plan, loading = false) =>
  useWorkspace.mockReturnValue({ workspace: plan === undefined ? null : { plan }, loading });

beforeEach(() => vi.clearAllMocks());

describe('usePlan', () => {
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

  it('an absent workspace/plan floors to FREE (never unlocked by default)', () => {
    asPlan(undefined);
    const { result } = renderHook(() => usePlan());
    expect(result.current.plan).toBe('FREE');
    expect(result.current.canAccess('GROWTH')).toBe(false);
  });

  it('an unknown plan value floors to FREE (no accidental access)', () => {
    asPlan('LEGENDARY');
    const { result } = renderHook(() => usePlan());
    expect(result.current.canAccess('GROWTH')).toBe(false);
    expect(result.current.canAccess('PRO')).toBe(false);
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
});
