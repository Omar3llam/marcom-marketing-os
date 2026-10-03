// ============================================================
// useHome Hook Tests (Phase 9 · the two-band home)
// ------------------------------------------------------------
// Asserts the GET path, contract validation (a valid envelope hydrates `home`;
// a malformed one surfaces an honest error instead of rendering junk), the
// error passthrough, and the pure `computeStale` derivation.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useHome, computeStale } from './useHome.js';
import { api } from '@/lib/api.js';
import { READ } from '@/design-system/states/readStatus.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

const band = (items = []) => ({ title: 't', items, count: items.length, empty: items.length === 0 });

const validHome = {
  aiInsight: null, aiInsightStatus: 'EMPTY',
  role: 'STRATEGIST',
  summary: '1 to decide, 0 to steer.',
  buyerBand: band([
    { id: 'verdict:d1', band: 'BUYER', type: 'VERDICT', title: 'KILL Cold #1', rationale: 'Freq over ceiling', severity: 'HIGH', evidenceRef: 'd1', humanAction: 'confirm', entityId: 'as1', impactScore: 9 },
  ]),
  strategistBand: band([]),
  loop: {
    stageStatus: [{ stage: 'PLAN', state: 'ACTIVE', lastAt: new Date().toISOString(), count: 1 }],
    closed: false, staleStages: [], loopHealth: 'HEALTHY',
    lastRunAt: new Date().toISOString(), nextRunAt: null, intervalMs: 900000,
  },
};

describe('useHome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/lumi/home and hydrates a contract-valid home', async () => {
    api.get.mockResolvedValueOnce({ data: { workspaceId: 'ws', generatedAt: 'now', ...validHome } });
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.get).toHaveBeenCalledWith('/api/lumi/home');
    expect(result.current.home?.buyerBand.items).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current).toMatchObject({ status: READ.PRESENT, reason: null });
  });

  it('rejects a malformed envelope with an honest error (no junk render)', async () => {
    api.get.mockResolvedValueOnce({ data: { role: 'STRATEGIST' } }); // missing bands + loop
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.home).toBeNull();
    expect(result.current.error?.message).toMatch(/contract validation/i);
    expect(result.current.status).toBe(READ.NOT_REACHABLE);
  });

  it('surfaces a network error and nulls the home', async () => {
    api.get.mockRejectedValueOnce(new Error('No resolvable workspace.'));
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.home).toBeNull();
    expect(result.current.error?.message).toBe('No resolvable workspace.');
  });

  it('keeps a non-2xx HomeUnavailable distinct from genuine empty success', async () => {
    const failure = Object.assign(new Error('HomeUnavailable'), { httpStatus: 500 });
    api.get.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.home).toBeNull();
    expect(result.current.error).toBe(failure);
  });

  it.each([
    [409, 'RoleNotConfigured'],
    [503, 'RoleUnavailable'],
  ])('does not turn unresolved-role HTTP %s into an empty Home', async (httpStatus, code) => {
    const failure = Object.assign(new Error(code), { httpStatus });
    api.get.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.home).toBeNull();
    expect(result.current.error).toBe(failure);
  });

  it('accepts a genuine empty Home response without an error', async () => {
    api.get.mockResolvedValueOnce({ data: {
      ...validHome,
      summary: 'Nothing needs a decision right now — the loop is quiet.',
      buyerBand: band([]),
    } });
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.home?.buyerBand).toMatchObject({ items: [], count: 0, empty: true });
  });
});

describe('Home access read truth', () => {
  it.each([
    [{ httpStatus: 409, code: 'NoWorkspace' }, READ.NOTHING_FOUND, 'NoWorkspace'],
    [{ httpStatus: 409, code: 'RoleNotConfigured', context: { roleReason: 'ROLE_UNSET' } }, READ.NOTHING_FOUND, 'ROLE_UNSET'],
    [{ response: { status: 409, data: { error: 'RoleNotConfigured', roleReason: 'ROLE_UNSET' } } }, READ.NOTHING_FOUND, 'ROLE_UNSET'],
    [{ httpStatus: 503, context: { roleReason: 'ROLE_LOOKUP_FAILED' } }, READ.NOT_REACHABLE, 'ROLE_LOOKUP_FAILED'],
    [{ response: { status: 503, data: { error: 'RoleUnavailable', roleReason: 'ROLE_LOOKUP_FAILED' } } }, READ.NOT_REACHABLE, 'ROLE_LOOKUP_FAILED'],
    [{ httpStatus: 503, context: { roleReason: 'ROLE_UNKNOWN' } }, READ.NOT_REACHABLE, 'ROLE_UNKNOWN'],
    [{ httpStatus: 503, context: { roleReason: 'ROLE_IDENTITY_MISSING' } }, READ.NOT_REACHABLE, 'ROLE_IDENTITY_MISSING'],
    [{ httpStatus: 403 }, READ.NOT_PERMITTED, null],
    [{ response: { status: 403 } }, READ.NOT_PERMITTED, null],
    [{ httpStatus: 500 }, READ.NOT_REACHABLE, null],
    [{ code: 'NETWORK_ERROR' }, READ.NOT_REACHABLE, null],
  ])('structured error %j becomes %s / %s while retaining its failure', async (details, status, reason) => {
    const error = Object.assign(new Error('same opaque message'), details);
    api.get.mockRejectedValue(error);
    const { result } = renderHook(useHome);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ status, reason, error, home: null });
  });

  it('stale success is PRESENT with no request started merely by staleness', async () => {
    api.get.mockResolvedValue({ data: { ...validHome,
      loop: { ...validHome.loop, lastRunAt: new Date(Date.now() - 3_600_000).toISOString() },
    } });
    const { result } = renderHook(useHome);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {});
    expect(result.current).toMatchObject({ isStale: true, isLoading: false, status: READ.PRESENT, error: null });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it.each(['manual', 'focus'])('role lookup failure recovers through %s without stale error or reason', async (action) => {
    let resolve;
    api.get.mockRejectedValueOnce(Object.assign(new Error('failed'), { httpStatus: 503, context: { roleReason: 'ROLE_LOOKUP_FAILED' } }))
      .mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { result } = renderHook(useHome);
    await waitFor(() => expect(result.current.reason).toBe('ROLE_LOOKUP_FAILED'));
    act(() => { if (action === 'focus') window.dispatchEvent(new Event('focus')); else result.current.refetch(); });
    expect(result.current).toMatchObject({ status: READ.LOADING, reason: null, error: null, home: null });
    await act(async () => resolve({ data: validHome }));
    expect(result.current).toMatchObject({ status: READ.PRESENT, reason: null, error: null });
    expect(result.current.home).not.toBeNull();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it.each(['ROLE_UNKNOWN', 'ROLE_IDENTITY_MISSING'])('focus does not retry permanent role reason %s behind 503', async (roleReason) => {
    api.get.mockRejectedValue(Object.assign(new Error('failed'), { httpStatus: 503, context: { roleReason } }));
    const { result } = renderHook(useHome);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('focus after successful Home preserves the existing retract-and-reload lifecycle', async () => {
    let resolve;
    api.get.mockResolvedValueOnce({ data: validHome }).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { result } = renderHook(useHome);
    await waitFor(() => expect(result.current.home).not.toBeNull());
    act(() => window.dispatchEvent(new Event('focus')));
    expect(result.current).toMatchObject({ status: READ.LOADING, home: null, isLoading: true, error: null });
    await act(async () => resolve({ data: validHome }));
    expect(result.current.status).toBe(READ.PRESENT);
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});

describe('computeStale', () => {
  it('is false when the last sweep is within the interval', () => {
    expect(computeStale({ lastRunAt: new Date().toISOString(), intervalMs: 900000 })).toBe(false);
  });
  it('is true when the last sweep is older than the interval', () => {
    expect(computeStale({ lastRunAt: new Date(Date.now() - 3_600_000).toISOString(), intervalMs: 900000 })).toBe(true);
  });
  it('is false when timestamps are missing (never fabricate staleness)', () => {
    expect(computeStale({ lastRunAt: null, intervalMs: 900000 })).toBe(false);
    expect(computeStale(null)).toBe(false);
  });
});


describe('SC-06 useHome recovery', () => {
  it('clears the old failure while retrying and accepts fresh success', async () => {
    const failure = Object.assign(new Error('temporary'), { httpStatus: 503 });
    let resolve;
    api.get.mockRejectedValueOnce(failure).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    act(() => { result.current.refetch(); });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => { resolve({ data: { ...validHome, buyerBand: band([]) } }); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.home).not.toBeNull();
  });
});

beforeEach(() => vi.resetAllMocks());

it('SC-06 ignores an older failure arriving after a newer success', async () => {
  let rejectOld;
  api.get.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
    .mockResolvedValueOnce({ data: validHome });
  const { result } = renderHook(() => useHome());
  await act(async () => { await result.current.refetch(); });
  await act(async () => { rejectOld(new Error('old failure')); });
  expect(result.current.error).toBeNull();
  expect(result.current.home).not.toBeNull();
});
it.each([403, 409])('SC-06 focus does not retry permanent HTTP %s', async (httpStatus) => {
  api.get.mockRejectedValue(Object.assign(new Error('permanent'), { httpStatus }));
  const { result } = renderHook(() => useHome());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(api.get).toHaveBeenCalledTimes(1);
});

it('SC-06 retracts the old home while a fresh read is pending', async () => {
  let reject;
  api.get.mockResolvedValueOnce({ data: validHome }).mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
  const { result } = renderHook(useHome);
  await waitFor(() => expect(result.current.home).not.toBeNull());
  act(() => { result.current.refetch(); });
  expect(result.current.home).toBeNull();
  expect(result.current.isLoading).toBe(true);
  const current = Object.assign(new Error('current failure'), { httpStatus: 503 });
  await act(async () => reject(current));
  expect(result.current.error).toBe(current);
  expect(result.current.home).toBeNull();
});
