// ============================================================
// B8-02 — an exported `error` state is not an error path
// ------------------------------------------------------------
// THE MEASURED DEFECT (b6-01-f4-corrected, still live at origin/master 443b29b)
//
//   fetchCampaigns()  catch → return { campaigns: [] }   ← every non-cancel error
//   refresh()         catch → setError(...)              ← reachable ONLY for a
//                                                          cancel, which returns
//                                                          one line earlier
//
// So `error` is declared, initialised, cleared, returned — and structurally
// always null. A backend outage arrives at four live surfaces shaped exactly
// like a successful read of an empty account.
//
// This is the same class as the contract fields the B7 consumer sweep found:
// something PRODUCED that nothing can ever receive. The close-out gate applied
// to the error path.
//
// THE RULING: a failure is a MEASURED semantic state. The hook may report it or
// rethrow it, but it may not convert it into data.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const get = vi.fn();
vi.mock('@/lib/api.js', () => ({ api: { get: (...a) => get(...a) } }));

const { useIntelligenceData } = await import('./useIntelligenceData.js');

beforeEach(() => { get.mockReset(); });

describe('B8-02 · a failed feed read reaches the caller as a failure', () => {
  it('sets `error` when the read fails — today it never can', async () => {
    get.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => useIntelligenceData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('does not present the failure as an empty account', async () => {
    // campaigns MAY be empty — what must not happen is empty WITHOUT an error,
    // which is indistinguishable from a real empty account.
    get.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => useIntelligenceData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(
      result.current.campaigns.length === 0 && !result.current.error,
      'empty campaigns with no error is the false-empty this slice removes',
    ).toBe(false);
  });

  it('still reports a genuinely empty account as empty, with NO error', async () => {
    // Non-vacuity: the assertions above must not pass by making everything an
    // error. `failure ≠ empty` has to hold in BOTH directions.
    get.mockResolvedValue({ data: { campaigns: [] } });
    const { result } = renderHook(() => useIntelligenceData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.campaigns).toEqual([]);
    expect(result.current.error).toBeFalsy();
  });

  it('a cancellation is neither a failure nor an empty account', async () => {
    const cancel = new Error('canceled');
    cancel.name = 'CanceledError';
    get.mockRejectedValue(cancel);
    const { result } = renderHook(() => useIntelligenceData());
    // A cancel must not set an error — it is not a fact about the account.
    await waitFor(() => expect(result.current.error).toBeFalsy());
  });
});
