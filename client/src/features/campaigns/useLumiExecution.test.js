// ============================================================
// useLumiExecution — a receipt is not a result
// ------------------------------------------------------------
// The one rule worth a whole test file: the producer's 202 says a request was
// accepted and queued. It does NOT say Meta did anything. Rendering success
// from it would show an operator "Paused" over a campaign that is still
// spending, with the failure visible nowhere.
//
// So every path here is checked for what it does NOT claim as much as for what
// it does.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const post = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ api: { post, get } }));

const { useLumiExecution, EXEC_STATE, stateFromStatus, rejectionFor } = await import('./useLumiExecution.js');

const DEC = 'dec_1';
const EXEC = { actionType: 'PAUSE_CAMPAIGN', targetId: '2385', targetType: 'campaign' };

/** The read-path envelope, as routes/lumi/executions.js returns it. */
const envelope = (status, over = {}) => ({
  data: {
    decisionId: DEC, executedAt: null, count: status ? 1 : 0,
    current: status ? { executionId: 'e1', status, terminal: false, retryOf: null, retryDepth: 0 } : null,
    executions: status ? [{ executionId: 'e1', status }] : [],
    ...over,
  },
});

const err = (status, code) => Object.assign(new Error('req failed'), { response: { status, data: { code } } });

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ data: { executionId: 'e1', status: 'QUEUED' } });
  get.mockResolvedValue(envelope('QUEUED'));
});
afterEach(() => vi.useRealTimers());

describe('the 202 is a receipt, never a result', () => {
  it('a successful POST settles on QUEUED — not EXECUTED_SUCCESS', async () => {
    const { result } = renderHook(() => useLumiExecution());
    await act(async () => { await result.current.run(DEC, EXEC); });

    expect(result.current.states[DEC]).toBe(EXEC_STATE.QUEUED);
    expect(result.current.states[DEC]).not.toBe(EXEC_STATE.EXECUTED_SUCCESS);
  });

  it('success arrives only when the persisted row says so', async () => {
    get.mockResolvedValue(envelope('EXECUTED_SUCCESS'));
    const { result } = renderHook(() => useLumiExecution());
    await act(async () => { await result.current.run(DEC, EXEC); });

    await waitFor(() => expect(result.current.states[DEC]).toBe(EXEC_STATE.EXECUTED_SUCCESS));
  });

  it('a platform refusal settles on EXECUTED_FAILED, never on success', async () => {
    get.mockResolvedValue(envelope('EXECUTED_FAILED'));
    const { result } = renderHook(() => useLumiExecution());
    await act(async () => { await result.current.run(DEC, EXEC); });

    await waitFor(() => expect(result.current.states[DEC]).toBe(EXEC_STATE.EXECUTED_FAILED));
  });
});

describe('a refused REQUEST is not a failed EXECUTION', () => {
  it('422 attribution → REJECTED with its own reason, and nothing was queued', async () => {
    post.mockRejectedValue(err(422, 'ATTRIBUTION_UNRESOLVED'));
    const { result } = renderHook(() => useLumiExecution());
    await act(async () => { await result.current.run(DEC, EXEC); });

    expect(result.current.states[DEC]).toBe(EXEC_STATE.REJECTED);
    expect(result.current.rejections[DEC]).toBe('ATTRIBUTION_UNRESOLVED');
    // The distinction the whole state vocabulary exists for: Meta never said
    // no, because we never asked it.
    expect(result.current.states[DEC]).not.toBe(EXEC_STATE.EXECUTED_FAILED);
  });

  it.each([
    [403, null, 'NOT_PERMITTED'],
    [401, null, 'NOT_AUTHENTICATED'],
    [429, 'QUEUE_FULL', 'BUSY'],
    [400, null, 'INVALID_REQUEST'],
    [500, null, 'REQUEST_FAILED'],
  ])('%s → %s', async (status, code, reason) => {
    expect(rejectionFor(err(status, code))).toBe(reason);
  });

  it('409 means an execution already exists — it reads that one back', async () => {
    post.mockRejectedValue(err(409, 'DUPLICATE'));
    get.mockResolvedValue(envelope('EXECUTING'));
    const { result } = renderHook(() => useLumiExecution());
    await act(async () => { await result.current.run(DEC, EXEC); });

    expect(result.current.rejections[DEC]).toBe('ALREADY_QUEUED');
    // Turning the refusal into the truth about what is already running, rather
    // than leaving the operator with a dead end.
    await waitFor(() => expect(result.current.states[DEC]).toBe(EXEC_STATE.EXECUTING));
  });
});

describe('it never invents a state', () => {
  it('preserves a present Outcome with unavailable money without substituting zeros or currency', async () => {
    const outcome = {
      available: true, outcomeId: 'o1', measuredAt: '2026-08-10T00:00:00Z',
      recordedAt: '2026-08-12T00:00:00Z',
      window: { start: '2026-08-01T00:00:00Z', end: '2026-08-08T00:00:00Z' }, sustained: false,
      monetary: { status: 'INSUFFICIENT_EVIDENCE', reason: 'OUTCOME_MONETARY_BASIS_UNPROVEN',
        knowledge: 'NOT_ENOUGH', spendDeltaMinor: null, revenueDeltaMinor: null, currency: null },
      deltas: { spendMinor: null, revenueMinor: null, roas: 0.4 },
    };
    get.mockResolvedValue(envelope('EXECUTED_SUCCESS', { outcome }));
    const { result } = renderHook(() => useLumiExecution());
    await act(async () => { await result.current.refresh(DEC); });
    expect(result.current.executions[DEC].outcome).toEqual(outcome);
    expect(result.current.states[DEC]).toBe(EXEC_STATE.EXECUTED_SUCCESS);
    expect(JSON.stringify(result.current.executions[DEC].outcome)).not.toContain('USD');
  });

  it('a failed READ leaves the state where it was', async () => {
    // A polling hiccup says nothing about the execution. Reporting
    // EXECUTED_FAILED here would claim a platform refusal that never happened.
    const { result } = renderHook(() => useLumiExecution());
    await act(async () => { await result.current.run(DEC, EXEC); });
    get.mockRejectedValue(new Error('network'));

    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.states[DEC]).toBe(EXEC_STATE.QUEUED);
  });

  it('no executions at all reads as READY, not as a failure', async () => {
    get.mockResolvedValue(envelope(null));
    const { result } = renderHook(() => useLumiExecution());
    await act(async () => { await result.current.refresh(DEC); });

    expect(result.current.states[DEC]).toBe(EXEC_STATE.READY);
  });

  it('an unrecognised status reads as still running, never as success', async () => {
    expect(stateFromStatus('SOMETHING_NEW')).toBe(EXEC_STATE.EXECUTING);
    expect(stateFromStatus('SOMETHING_NEW')).not.toBe(EXEC_STATE.EXECUTED_SUCCESS);
    expect(stateFromStatus(null)).toBe(EXEC_STATE.READY);
  });

  it('PENDING and QUEUED are both "accepted, not started"', () => {
    expect(stateFromStatus('PENDING')).toBe(EXEC_STATE.QUEUED);
    expect(stateFromStatus('QUEUED')).toBe(EXEC_STATE.QUEUED);
  });
});

describe('a second click cannot queue a second mutation', () => {
  it('drops a concurrent click on the same decision', async () => {
    // React batches state updates, so a busy-check that read the state map
    // would let a double-click through — and this is the one place in the
    // product where that costs real money on an ad account.
    let release;
    post.mockImplementation(() => new Promise((r) => { release = () => r({ data: {} }); }));

    const { result } = renderHook(() => useLumiExecution());
    act(() => { result.current.run(DEC, EXEC); result.current.run(DEC, EXEC); });
    await act(async () => { release(); });

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('two different decisions are independent', async () => {
    const { result } = renderHook(() => useLumiExecution());
    await act(async () => {
      await Promise.all([result.current.run('d1', EXEC), result.current.run('d2', EXEC)]);
    });
    expect(post).toHaveBeenCalledTimes(2);
  });
});
