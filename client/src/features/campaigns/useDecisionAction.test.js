// ============================================================
// useDecisionAction — which server answers are failures
// ============================================================
// The hook's request is trivial. Its judgement is not: axios rejects on every
// 4xx, so the obvious catch-all turns three honest answers into "couldn't
// record — try again". Two of those retries can never succeed, and the third
// chases a decision that no longer exists.
//
// This matters more here than almost anywhere else in the product. Execute and
// dismiss are the ONLY writes that populate the Proof Engine, so an operator who
// gives up after a bogus retry prompt removes their decision from the accuracy
// numbers entirely — and the surface goes back to reporting on nothing, which is
// the exact condition PR #327 existed to end.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('./decisionSignals.js', () => ({
  recordExecute: vi.fn(),
  recordDismiss: vi.fn(),
}));

import { recordExecute, recordDismiss } from './decisionSignals.js';
import { useDecisionAction, terminalStateFor } from './useDecisionAction.js';

const httpError = (status, code) => ({ response: { status, data: { error: code } } });

beforeEach(() => {
  vi.clearAllMocks();
  recordExecute.mockResolvedValue({ data: { ok: true, recorded: true } });
  recordDismiss.mockResolvedValue({ data: { ok: true, recorded: true } });
});

describe('terminalStateFor — pure, and the whole judgement', () => {
  it('a 409 reports what is TRUE, not what was clicked', () => {
    // AlreadyDismissed comes back from an execute attempt. The row is dismissed;
    // saying so beats insisting on the button the operator happened to press.
    expect(terminalStateFor(httpError(409, 'AlreadyDismissed'))).toBe('dismissed');
    expect(terminalStateFor(httpError(409, 'AlreadyExecuted'))).toBe('executed');
  });

  it('a 404 is stale, not broken — the verdict was replaced mid-click', () => {
    expect(terminalStateFor(httpError(404, 'NoLiveDecision'))).toBe('stale');
  });

  it('the by-id superseded refusal is stale too', () => {
    // Unreachable through the by-entity adapter (its lookup filters on PROPOSED,
    // so a superseded row 404s first). Mapped anyway so repointing at the by-id
    // routes later cannot silently reclassify it as retryable.
    expect(terminalStateFor(httpError(409, 'DecisionNotActionable'))).toBe('stale');
  });

  it('only a real failure offers a retry', () => {
    expect(terminalStateFor(httpError(500, 'DecisionUnavailable'))).toBe('error');
    expect(terminalStateFor(httpError(403, 'Forbidden'))).toBe('error');
    expect(terminalStateFor(new Error('Network Error'))).toBe('error');
    expect(terminalStateFor(undefined)).toBe('error');
  });

  it('an unknown 409 code is an error, not a guessed terminal state', () => {
    // Claiming "already dismissed" from a code we do not recognise would put a
    // sentence on screen that no server response supports.
    expect(terminalStateFor(httpError(409, 'SomethingNew'))).toBe('error');
  });
});

describe('the happy paths', () => {
  it('execute: pending → executed, and sends the entity id', async () => {
    const { result } = renderHook(() => useDecisionAction());

    await act(async () => { await result.current.execute('ent-1'); });

    expect(recordExecute).toHaveBeenCalledWith('ent-1');
    expect(result.current.states['ent-1']).toBe('executed');
  });

  it('dismiss: pending → dismissed', async () => {
    const { result } = renderHook(() => useDecisionAction());
    await act(async () => { await result.current.dismiss('ent-1'); });

    expect(recordDismiss).toHaveBeenCalledWith('ent-1');
    expect(result.current.states['ent-1']).toBe('dismissed');
  });

  it('shows a pending state while the request is in flight', async () => {
    let release;
    recordExecute.mockReturnValue(new Promise((r) => { release = r; }));
    const { result } = renderHook(() => useDecisionAction());

    act(() => { result.current.execute('ent-1'); });
    await waitFor(() => expect(result.current.states['ent-1']).toBe('executing'));

    await act(async () => { release({ data: {} }); });
    expect(result.current.states['ent-1']).toBe('executed');
  });

  // The server reports recorded:false when the claim was already on file. That
  // is a SUCCESS from the operator's side — they asked whether it is on record,
  // and it is. Which click wrote it is our bookkeeping.
  it('an idempotent 200 still reads as recorded', async () => {
    recordExecute.mockResolvedValue({ data: { ok: true, recorded: false } });
    const { result } = renderHook(() => useDecisionAction());
    await act(async () => { await result.current.execute('ent-1'); });
    expect(result.current.states['ent-1']).toBe('executed');
  });
});

describe('state is per entity', () => {
  // ConnectorCampaignsPanel renders every row from ONE hook instance. A scalar
  // would make all of them echo whichever row was clicked last — every campaign
  // on screen claiming an action taken against one of them.
  it('one row settling does not move its siblings', async () => {
    const { result } = renderHook(() => useDecisionAction());

    await act(async () => { await result.current.execute('ent-1'); });
    await act(async () => { await result.current.dismiss('ent-2'); });

    expect(result.current.states['ent-1']).toBe('executed');
    expect(result.current.states['ent-2']).toBe('dismissed');
    expect(result.current.states['ent-3']).toBeUndefined();
  });
});

describe('failures', () => {
  it('a 409 settles on the true terminal state, never on error', async () => {
    recordExecute.mockRejectedValue(httpError(409, 'AlreadyDismissed'));
    const { result } = renderHook(() => useDecisionAction());
    await act(async () => { await result.current.execute('ent-1'); });
    expect(result.current.states['ent-1']).toBe('dismissed');
  });

  it('a transport failure is retryable and says so', async () => {
    recordExecute.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => useDecisionAction());
    await act(async () => { await result.current.execute('ent-1'); });
    expect(result.current.states['ent-1']).toBe('error');
  });

  it('never throws out of the hook — a rejected write must not blank the page', async () => {
    recordDismiss.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDecisionAction());
    await expect(act(async () => { await result.current.dismiss('ent-1'); })).resolves.not.toThrow();
  });

  it('sends nothing without an entity id', async () => {
    const { result } = renderHook(() => useDecisionAction());
    await act(async () => { await result.current.execute(null); });
    expect(recordExecute).not.toHaveBeenCalled();
  });
});
