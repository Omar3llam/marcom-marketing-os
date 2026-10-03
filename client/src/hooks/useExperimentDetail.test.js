// ============================================================
// B8-05 — the detail hooks map REAL errors, not axios-shaped ones
// ------------------------------------------------------------
// Found while building this slice, in B8-04's hook rather than in a new one.
//
// `useDecisionDetail` read the status like this:
//
//     const status = err?.response?.status;
//     if (status === 404) setRefusal(DETAIL_REFUSAL.NOT_FOUND);
//     else if (status === 409) setRefusal(DETAIL_REFUSAL.NOT_DESTINATION);
//     else setRefusal(DETAIL_REFUSAL.UNREADABLE);
//
// But `api.js` does not reject with the axios error. Its response interceptor
// rejects with `mapTransportError(error)` — an `AppError`, which carries
// `httpStatus` and has NO `response` property at all. So in production
// `status` was ALWAYS `undefined`, every branch fell to `else`, and the three
// refusals C-11 fought to keep apart arrived as one. The 404 and 409 copy that
// B8-04 wrote could not be reached by any request.
//
// It passed review because `DecisionDetailView.test.jsx` mocks the whole hook
// and asserts on `DETAIL_REFUSAL` values handed to it directly — so the
// mapping, the only part that was wrong, was never executed. That is B8-04b's
// lesson exactly one slice later: a test can name the right principle and still
// never run the line that violates it.
//
// So this file tests the HOOKS, against the shape `api.js` actually rejects
// with, and it covers all three of them — the class, not the caught instance.
// `useIncrementality` already read `err?.httpStatus ?? err?.response?.status`;
// the two hooks that did not now do, and this is what keeps it that way.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get: (...a) => get(...a) } }));

import { useTestDetail, useHoldoutDetail, DETAIL_REFUSAL } from './useExperimentDetail.js';
import { useDecisionDetail, DETAIL_REFUSAL as DECISION_REFUSAL } from './useDecisionDetail.js';

/**
 * What `api.js` really rejects with: an AppError carrying `httpStatus`.
 * Deliberately built WITHOUT a `response` property — reproducing the axios
 * shape here would reproduce the blind spot instead of catching it.
 */
function appError(httpStatus, code) {
  const err = new Error(`HTTP ${httpStatus}`);
  err.httpStatus = httpStatus;
  if (code) err.code = code;
  return err;
}

beforeEach(() => { get.mockReset(); });

describe('B8-05 — an AppError’s status is read, so the refusals stay apart', () => {
  it('useTestDetail: 404 is NOT_FOUND, not a failed read', async () => {
    get.mockRejectedValue(appError(404));
    const { result } = renderHook(() => useTestDetail('t1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.refusal).toBe(DETAIL_REFUSAL.NOT_FOUND);
  });

  it('useTestDetail: a plan 403 is NOT_PERMITTED, and says which entitlement', async () => {
    get.mockRejectedValue(appError(403, 'PLAN_REQUIRED'));
    const { result } = renderHook(() => useTestDetail('t1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.refusal).toBe(DETAIL_REFUSAL.NOT_PERMITTED);
    expect(result.current.reason).toBe('PLAN_REQUIRED');
  });

  it('useHoldoutDetail: a tier 403 is NOT_PERMITTED with the OTHER reason', async () => {
    // Both are 403 and both are NOT_PERMITTED. C-07: the token cannot carry the
    // instruction, so the reason travels beside it.
    get.mockRejectedValue(Object.assign(appError(403, 'AUTH_ACCESS_DENIED'), { message: 'MeasurementGated' }));
    const { result } = renderHook(() => useHoldoutDetail('h1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.refusal).toBe(DETAIL_REFUSAL.NOT_PERMITTED);
    expect(result.current.reason).toBe('NOT_ENTITLED');
  });

  it('useHoldoutDetail: a 500 is UNREADABLE, and never a holdout', async () => {
    get.mockRejectedValue(appError(500));
    const { result } = renderHook(() => useHoldoutDetail('h1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.refusal).toBe(DETAIL_REFUSAL.UNREADABLE);
    expect(result.current.test).toBeNull();
  });

  it.each([
    { httpStatus: 403, code: 'AUTH_ACCESS_DENIED' },
    { response: { status: 403, data: { error: 'RoleForbidden' } } },
  ])('useHoldoutDetail: generic refusal %j carries no tier diagnosis', async (err) => {
    get.mockRejectedValue(err);
    const { result } = renderHook(() => useHoldoutDetail('h1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.refusal).toBe(DETAIL_REFUSAL.NOT_PERMITTED);
    expect(result.current.reason).toBe('NOT_PERMITTED');
  });

  it('a body that fails the contract is UNREADABLE, not an empty experiment', async () => {
    get.mockResolvedValue({ data: { workspaceId: 'w1', test: { nope: true } } });
    const { result } = renderHook(() => useTestDetail('t1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.refusal).toBe(DETAIL_REFUSAL.UNREADABLE);
    expect(result.current.test).toBeNull();
  });
});

describe('B8-05 — the same defect, fixed in B8-04’s hook', () => {
  it('useDecisionDetail: 404 is NOT_FOUND', async () => {
    get.mockRejectedValue(appError(404));
    const { result } = renderHook(() => useDecisionDetail('d1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.refusal).toBe(DECISION_REFUSAL.NOT_FOUND);
  });

  it('useDecisionDetail: 409 is NOT_DESTINATION — the distinction C-11 chose', async () => {
    // C-11 picked 409 over 404 precisely BECAUSE the row exists, and saying
    // "not found" would be a false statement about the account. Collapsing it
    // into UNREADABLE undid that choice at the last step.
    get.mockRejectedValue(appError(409));
    const { result } = renderHook(() => useDecisionDetail('d1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.refusal).toBe(DECISION_REFUSAL.NOT_DESTINATION);
  });

  it('useDecisionDetail: a 500 is still UNREADABLE', async () => {
    get.mockRejectedValue(appError(500));
    const { result } = renderHook(() => useDecisionDetail('d1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.refusal).toBe(DECISION_REFUSAL.UNREADABLE);
  });
});
