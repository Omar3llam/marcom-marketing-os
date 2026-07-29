// ============================================================
// useDecisionLearning — null is the expected answer
// ------------------------------------------------------------
// Most campaigns have no track record, and a young workspace has none at all.
// The hook therefore has no error state: a failure and "no data yet" are the
// same thing to the user, and there is nothing they could do about either.
//
// The one thing it must never do is show one campaign's record under another.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));

import { useDecisionLearning } from './useDecisionLearning.js';

const ENTITY = 'c1c1c1c1-0000-4000-8000-000000000001';
const TALLY = { total: 12, improved: 9, unchanged: 2, worsened: 1, unscored: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { learning: TALLY } });
});

describe('fetching', () => {
  it('reads the learning route for the entity', async () => {
    const { result } = renderHook(() => useDecisionLearning(ENTITY));
    await waitFor(() => expect(result.current).toMatchObject({ total: 12, improved: 9 }));
    expect(get).toHaveBeenCalledWith(`/api/lumi/decisions/by-entity/${ENTITY}/learning`);
  });

  it('encodes the entity id', async () => {
    renderHook(() => useDecisionLearning('a/b'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/lumi/decisions/by-entity/a%2Fb/learning'));
  });

  it('starts null before anything lands', () => {
    const { result } = renderHook(() => useDecisionLearning(ENTITY));
    expect(result.current).toBeNull();
  });
});

describe('null is normal', () => {
  it.each([
    ['the route says there is no track record', { data: { learning: null } }],
    ['the payload is empty', { data: {} }],
  ])('%s → null', async (_label, res) => {
    get.mockResolvedValue(res);
    const { result } = renderHook(() => useDecisionLearning(ENTITY));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('a failed request is indistinguishable from no data', async () => {
    get.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDecisionLearning(ENTITY));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it.each([[null], [undefined], ['']])('no entity id (%s) fetches nothing', (id) => {
    const { result } = renderHook(() => useDecisionLearning(id));
    expect(get).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});

describe('never shows one campaign record under another', () => {
  it('clears immediately when the entity changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useDecisionLearning(id), {
      initialProps: { id: ENTITY },
    });
    await waitFor(() => expect(result.current).not.toBeNull());

    get.mockReturnValue(new Promise(() => {})); // never resolves
    rerender({ id: 'other-entity' });
    expect(result.current).toBeNull(); // the previous campaign's record is gone
  });

  // A slow response for a row the user already collapsed must not land.
  it('ignores a response that arrives after unmount', async () => {
    let resolve;
    get.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = renderHook(() => useDecisionLearning(ENTITY));
    unmount();
    resolve({ data: { learning: TALLY } });
    await Promise.resolve();
    // No state update on an unmounted hook — the assertion is the absence of a
    // React warning, which the test setup escalates.
    expect(get).toHaveBeenCalledTimes(1);
  });
});
