// ============================================================
// useDecisionJudgment — which server answers are failures
// ------------------------------------------------------------
// The request is trivial. The judgement is not: axios rejects on every 4xx, so
// three true statements (already recorded / superseded / not in this workspace)
// arrive looking exactly like a server error. Classifying them wrong is how a
// surface teaches an operator to distrust it — and this is the one write whose
// entire value is being believed.
//
// The other property pinned here is the absence of an optimistic write: the UI
// must not show a recorded judgement before Postgres has confirmed one.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const recordJudgment = vi.hoisted(() => vi.fn());
vi.mock('./judgmentSignals.js', () => ({ recordJudgment }));

const { useDecisionJudgment, judgmentOutcomeFor, judgmentFrom } = await import('./useDecisionJudgment.js');

const ID = 'dec_1';
const AT = '2026-08-19T12:41:00.000Z';
const err = (status, data) => ({ response: { status, data } });

beforeEach(() => recordJudgment.mockReset());

describe('judgmentOutcomeFor — pure, and the whole judgement', () => {
  it('reads the CODE, so a 409 that is a conflict and one that is staleness differ', () => {
    expect(judgmentOutcomeFor(err(409, { error: 'JudgmentAlreadyRecorded' }))).toBe('conflict');
    expect(judgmentOutcomeFor(err(409, { error: 'DecisionNotActionable' }))).toBe('superseded');
  });

  it('separates the four remaining answers', () => {
    expect(judgmentOutcomeFor(err(404, { error: 'DecisionNotFound' }))).toBe('unavailable');
    expect(judgmentOutcomeFor(err(403, {}))).toBe('denied');
    expect(judgmentOutcomeFor(err(401, {}))).toBe('denied');
    expect(judgmentOutcomeFor(err(400, { error: 'ReasonRequired' }))).toBe('invalid');
  });

  it('treats a 5xx and a transport failure as the one retryable state', () => {
    expect(judgmentOutcomeFor(err(500, {}))).toBe('error');
    expect(judgmentOutcomeFor(new Error('network down'))).toBe('error');
  });
});

describe('judgmentFrom — a judgement needs a date to be a judgement', () => {
  it('reads all four fields off a server payload', () => {
    expect(judgmentFrom({
      ok: true, recorded: true, humanResponse: 'OVERRIDE',
      humanReasonCode: 'TOF_ROLE', humanReasonNote: 'n', humanRespondedAt: AT,
    })).toEqual({
      humanResponse: 'OVERRIDE', humanReasonCode: 'TOF_ROLE', humanReasonNote: 'n', humanRespondedAt: AT,
    });
  });

  it('returns null for an unjudged row — never a blank judgement', () => {
    expect(judgmentFrom({ humanResponse: null, humanRespondedAt: null })).toBeNull();
    expect(judgmentFrom({})).toBeNull();
    expect(judgmentFrom(null)).toBeNull();
  });
});

describe('submit', () => {
  it('records what the SERVER returned, not what was typed', async () => {
    recordJudgment.mockResolvedValueOnce({
      data: { ok: true, recorded: true, humanResponse: 'CONFIRM', humanReasonCode: null, humanReasonNote: null, humanRespondedAt: AT },
    });
    const { result } = renderHook(() => useDecisionJudgment());

    await act(() => result.current.submit(ID, { response: 'CONFIRM' }));

    expect(result.current.states[ID]).toBe('recorded');
    expect(result.current.recorded[ID]).toEqual({
      humanResponse: 'CONFIRM', humanReasonCode: null, humanReasonNote: null, humanRespondedAt: AT,
    });
  });

  it('treats a 200 with recorded:false as success, keeping the ORIGINAL timestamp', async () => {
    // The identical-repeat path. The operator's claim is on record, which is the
    // only thing they asked about; which click wrote it is our bookkeeping.
    recordJudgment.mockResolvedValueOnce({
      data: { ok: true, recorded: false, humanResponse: 'ADJUST', humanReasonCode: 'SEASONALITY', humanReasonNote: null, humanRespondedAt: AT },
    });
    const { result } = renderHook(() => useDecisionJudgment());
    await act(() => result.current.submit(ID, { response: 'ADJUST', reasonCode: 'SEASONALITY' }));

    expect(result.current.states[ID]).toBe('recorded');
    expect(result.current.recorded[ID].humanRespondedAt).toBe(AT);
  });

  it('NEVER shows a judgement before the server confirms one', async () => {
    let release;
    recordJudgment.mockReturnValueOnce(new Promise((res) => { release = res; }));
    const { result } = renderHook(() => useDecisionJudgment());

    act(() => { result.current.submit(ID, { response: 'CONFIRM' }); });
    // Mid-flight: saving, and nothing on record. An optimistic write here would
    // render a recorded judgement over a row that may never exist.
    await waitFor(() => expect(result.current.states[ID]).toBe('saving'));
    expect(result.current.recorded[ID]).toBeUndefined();

    await act(async () => {
      release({ data: { ok: true, recorded: true, humanResponse: 'CONFIRM', humanRespondedAt: AT } });
    });
    expect(result.current.states[ID]).toBe('recorded');
  });

  it('reconciles a 409 to the judgement the server says is stored', async () => {
    recordJudgment.mockRejectedValueOnce(err(409, {
      error: 'JudgmentAlreadyRecorded',
      humanResponse: 'OVERRIDE', humanReasonCode: 'BRAND_ROLE',
      humanReasonNote: 'brand push', humanRespondedAt: AT,
    }));
    const { result } = renderHook(() => useDecisionJudgment());
    await act(() => result.current.submit(ID, { response: 'CONFIRM' }));

    // Not "couldn't record", and not the CONFIRM that was attempted.
    expect(result.current.states[ID]).toBe('conflict');
    expect(result.current.recorded[ID]).toEqual({
      humanResponse: 'OVERRIDE', humanReasonCode: 'BRAND_ROLE', humanReasonNote: 'brand push', humanRespondedAt: AT,
    });
  });

  it('never claims a judgement on any other failure', async () => {
    for (const [status, data, state] of [
      [400, { error: 'ReasonRequired', message: 'OVERRIDE requires a structured reasonCode' }, 'invalid'],
      [403, {}, 'denied'],
      [404, { error: 'DecisionNotFound' }, 'unavailable'],
      [409, { error: 'DecisionNotActionable' }, 'superseded'],
      [500, {}, 'error'],
    ]) {
      recordJudgment.mockRejectedValueOnce(err(status, data));
      const { result } = renderHook(() => useDecisionJudgment());
      await act(() => result.current.submit(ID, { response: 'OVERRIDE' }));
      expect(result.current.states[ID]).toBe(state);
      expect(result.current.recorded[ID]).toBeUndefined();
    }
  });

  it('surfaces the server VALIDATION message, so a 400 is actionable', async () => {
    recordJudgment.mockRejectedValueOnce(err(400, {
      error: 'ReasonRequired', message: 'OVERRIDE requires a structured reasonCode',
    }));
    const { result } = renderHook(() => useDecisionJudgment());
    await act(() => result.current.submit(ID, { response: 'OVERRIDE' }));
    expect(result.current.messages[ID]).toMatch(/requires a structured reasonCode/);
  });

  it('drops a second click while the first is in flight', async () => {
    let release;
    recordJudgment.mockReturnValueOnce(new Promise((res) => { release = res; }));
    const { result } = renderHook(() => useDecisionJudgment());

    act(() => { result.current.submit(ID, { response: 'CONFIRM' }); });
    await waitFor(() => expect(result.current.states[ID]).toBe('saving'));
    await act(async () => { await result.current.submit(ID, { response: 'CONFIRM' }); });

    expect(recordJudgment).toHaveBeenCalledTimes(1);
    await act(async () => { release({ data: { humanResponse: 'CONFIRM', humanRespondedAt: AT } }); });
  });

  it('keys state by decisionId, so one row never echoes another', async () => {
    recordJudgment
      .mockResolvedValueOnce({ data: { humanResponse: 'CONFIRM', humanRespondedAt: AT } })
      .mockRejectedValueOnce(err(500, {}));
    const { result } = renderHook(() => useDecisionJudgment());

    await act(() => result.current.submit('dec_a', { response: 'CONFIRM' }));
    await act(() => result.current.submit('dec_b', { response: 'CONFIRM' }));

    expect(result.current.states.dec_a).toBe('recorded');
    expect(result.current.states.dec_b).toBe('error');
    expect(result.current.recorded.dec_b).toBeUndefined();
  });

  it('does nothing at all without a decisionId', async () => {
    const { result } = renderHook(() => useDecisionJudgment());
    await act(() => result.current.submit(null, { response: 'CONFIRM' }));
    expect(recordJudgment).not.toHaveBeenCalled();
  });
});
