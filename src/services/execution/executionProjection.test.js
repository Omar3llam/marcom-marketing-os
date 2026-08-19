// ============================================================
// executionProjection — the rules that keep a receipt from reading as a result
// ============================================================
// Pure functions, so these are cheap and can be exhaustive. Each block below
// pins one way the projection could quietly overstate what happened on an ad
// account.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  EXECUTION_STATE,
  TERMINAL_STATUSES,
  executionStateOf,
  isTerminalStatus,
  lifecycleTimestamps,
  failureFrom,
  retryLineage,
  toExecutionDetail,
  summarizeExecutionState,
} from './executionProjection.js';

const t = (toStatus, iso, metadata = null) => ({ toStatus, createdAt: new Date(iso), metadata });

describe('status → state', () => {
  it.each([
    ['PENDING',          EXECUTION_STATE.REQUESTED],
    ['QUEUED',           EXECUTION_STATE.QUEUED],
    ['EXECUTING',        EXECUTION_STATE.EXECUTING],
    ['EXECUTED_SUCCESS', EXECUTION_STATE.SUCCEEDED],
    ['EXECUTED_FAILED',  EXECUTION_STATE.FAILED],
    ['TIMED_OUT',        EXECUTION_STATE.TIMED_OUT],
    ['CANCELLED',        EXECUTION_STATE.CANCELLED],
  ])('%s → %s', (status, state) => {
    expect(executionStateOf(status)).toBe(state);
  });

  it('no status at all is NONE — a measured zero, not a failure', () => {
    expect(executionStateOf(null)).toBe(EXECUTION_STATE.NONE);
    expect(executionStateOf(undefined)).toBe(EXECUTION_STATE.NONE);
  });

  it('an unknown status reads as still running, NEVER as succeeded', () => {
    // If a status is added and this map is not updated, the safe failure is
    // "we think it is still going".
    expect(executionStateOf('SOMETHING_NEW')).toBe(EXECUTION_STATE.EXECUTING);
    expect(executionStateOf('SOMETHING_NEW')).not.toBe(EXECUTION_STATE.SUCCEEDED);
  });

  it('keeps every §6 distinction separate — none collapsed into another', () => {
    const states = ['PENDING', 'QUEUED', 'EXECUTING', 'EXECUTED_SUCCESS', 'EXECUTED_FAILED']
      .map(executionStateOf);
    expect(new Set(states).size).toBe(5);
  });

  it('a timeout is not a platform refusal', () => {
    // Meta may well have accepted the mutation; we simply never heard.
    expect(executionStateOf('TIMED_OUT')).not.toBe(EXECUTION_STATE.FAILED);
    expect(executionStateOf('CANCELLED')).not.toBe(EXECUTION_STATE.FAILED);
  });

  it('terminal set matches the model vocabulary', () => {
    expect(TERMINAL_STATUSES).toEqual(['EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED']);
    expect(isTerminalStatus('QUEUED')).toBe(false);
    expect(isTerminalStatus('EXECUTED_SUCCESS')).toBe(true);
  });
});

describe('lifecycle timestamps are read, never computed', () => {
  const log = [
    t('QUEUED',           '2026-08-19T10:00:00Z'),
    t('EXECUTING',        '2026-08-19T10:00:05Z'),
    t('EXECUTED_SUCCESS', '2026-08-19T10:00:09Z'),
  ];

  it('takes each moment from its transition', () => {
    const got = lifecycleTimestamps(log);
    expect(got.queuedAt).toEqual(new Date('2026-08-19T10:00:00Z'));
    expect(got.startedAt).toEqual(new Date('2026-08-19T10:00:05Z'));
    expect(got.succeededAt).toEqual(new Date('2026-08-19T10:00:09Z'));
    expect(got.failedAt).toBeNull();
  });

  it('an absent transition is null, not a substituted neighbour', () => {
    // The failure mode worth pinning: filling startedAt from queuedAt would
    // make every queued execution look like it had begun.
    const got = lifecycleTimestamps([t('QUEUED', '2026-08-19T10:00:00Z')]);
    expect(got.queuedAt).toBeTruthy();
    expect(got.startedAt).toBeNull();
    expect(got.succeededAt).toBeNull();
  });

  it('no transitions ⇒ all null', () => {
    expect(lifecycleTimestamps([])).toEqual({
      queuedAt: null, startedAt: null, succeededAt: null, failedAt: null,
    });
    expect(lifecycleTimestamps()).toEqual({
      queuedAt: null, startedAt: null, succeededAt: null, failedAt: null,
    });
  });

  it('EARLIEST wins when a status is re-entered', () => {
    // A BullMQ retry re-enters EXECUTING. "When did work start" means the first
    // time, not the most recent.
    const got = lifecycleTimestamps([
      t('EXECUTING', '2026-08-19T10:00:05Z'),
      t('EXECUTING', '2026-08-19T10:09:00Z'),
    ]);
    expect(got.startedAt).toEqual(new Date('2026-08-19T10:00:05Z'));
  });

  it('a bad ending is reported whichever way it ended', () => {
    expect(lifecycleTimestamps([t('TIMED_OUT', '2026-08-19T11:00:00Z')]).failedAt).toBeTruthy();
    expect(lifecycleTimestamps([t('CANCELLED', '2026-08-19T11:00:00Z')]).failedAt).toBeTruthy();
  });
});

describe('failure detail is whitelisted, never a blob', () => {
  const transitions = [t('EXECUTED_FAILED', '2026-08-19T10:00:09Z', {
    platformStatus: 400, reason: 'non_retriable', workerId: 99, secret: 'do-not-publish',
  })];

  it('extracts message, code, status and reason by name', () => {
    const f = failureFrom({
      status: 'EXECUTED_FAILED',
      response: { error: 'Invalid parameter', code: 100 },
      transitions,
    });
    expect(f).toEqual({
      message: 'Invalid parameter', code: 100, platformStatus: 400, reason: 'non_retriable',
    });
  });

  it('carries nothing else out of the metadata', () => {
    const f = failureFrom({ status: 'EXECUTED_FAILED', response: { error: 'x' }, transitions });
    expect(JSON.stringify(f)).not.toMatch(/do-not-publish|workerId/);
  });

  it('a non-failure state has NO failure object', () => {
    // An empty failure would make "nothing went wrong yet" and "something went
    // wrong but we have no detail" look identical.
    for (const status of ['PENDING', 'QUEUED', 'EXECUTING', 'EXECUTED_SUCCESS']) {
      expect(failureFrom({ status, response: { error: 'x' }, transitions })).toBeNull();
    }
  });

  it('missing pieces are null rather than guessed', () => {
    const f = failureFrom({ status: 'TIMED_OUT', response: null, transitions: [] });
    expect(f).toEqual({ message: null, code: null, platformStatus: null, reason: null });
  });

  it('a non-object response cannot smuggle a value through', () => {
    const f = failureFrom({ status: 'EXECUTED_FAILED', response: 'boom', transitions: [] });
    expect(f.message).toBeNull();
    expect(f.code).toBeNull();
  });
});

describe('retry lineage', () => {
  it('an original carries none', () => {
    expect(retryLineage(null)).toEqual({ retryOf: null, retryDepth: 0 });
    expect(retryLineage({})).toEqual({ retryOf: null, retryDepth: 0 });
  });

  it('a retry names its parent and its depth', () => {
    expect(retryLineage({ retryOf: 'exec_1', retryDepth: 2 })).toEqual({ retryOf: 'exec_1', retryDepth: 2 });
  });

  it('a non-numeric depth falls back to 0 rather than propagating garbage', () => {
    expect(retryLineage({ retryOf: 'e', retryDepth: 'two' }).retryDepth).toBe(0);
  });
});

describe('toExecutionDetail', () => {
  const execution = {
    id: 'exec_1', decisionId: 'dec_1', status: 'QUEUED',
    actionType: 'PAUSE_CAMPAIGN', targetId: '23851234567',
    createdAt: new Date('2026-08-19T10:00:00Z'),
    updatedAt: new Date('2026-08-19T10:00:01Z'),
    correlationId: 'corr_1', retryMetadata: null, version: 1,
    payload: { secret: 'do-not-publish' },
    response: null,
  };

  it('never publishes the payload, even though the row carries one', () => {
    const out = toExecutionDetail({ execution, transitions: [], decision: null });
    expect(JSON.stringify(out)).not.toMatch(/do-not-publish/);
  });

  it('reports hasResponse without publishing the response', () => {
    const out = toExecutionDetail({
      execution: { ...execution, response: { token: 'do-not-publish' } },
      transitions: [], decision: null,
    });
    expect(out.hasResponse).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/do-not-publish/);
  });

  it('names the last state change for what it is', () => {
    const out = toExecutionDetail({ execution, transitions: [], decision: null });
    expect(out.lastTransitionAt).toEqual(execution.updatedAt);
    // updatedAt presented as a completion time is the exact lie to avoid.
    expect(out).not.toHaveProperty('executedAt');
  });

  it('a decision is projected as ids and enums only', () => {
    const out = toExecutionDetail({
      execution, transitions: [],
      decision: {
        id: 'dec_1', entityId: 'ent_1', entityLevel: 'CAMPAIGN',
        verdict: 'KILL', status: 'PROPOSED',
        executedAt: new Date('2026-08-19T09:00:00Z'), dismissedAt: null,
      },
    });
    expect(out.decision.entityId).toBe('ent_1');
    // The self-report axis, under a name that cannot be mistaken for proof.
    expect(out.decision.selfReportedOrExecutedAt).toBeTruthy();
    expect(out.decision).not.toHaveProperty('executedAt');
    // And it did not turn a queued execution into a successful one.
    expect(out.state).toBe(EXECUTION_STATE.QUEUED);
  });

  it('no decision ⇒ null on both fields', () => {
    const out = toExecutionDetail({
      execution: { ...execution, decisionId: null }, transitions: [], decision: null,
    });
    expect(out.decisionId).toBeNull();
    expect(out.decision).toBeNull();
  });
});

describe('summarizeExecutionState', () => {
  const row = (status) => ({ status });

  it('an empty history is NONE with a real zero', () => {
    expect(summarizeExecutionState([])).toEqual({
      state: EXECUTION_STATE.NONE, count: 0, succeeded: false, terminal: false,
    });
  });

  it('the newest row gives the state', () => {
    // Rows arrive newest-first from both read paths.
    const s = summarizeExecutionState([row('QUEUED'), row('EXECUTED_FAILED')]);
    expect(s.state).toBe(EXECUTION_STATE.QUEUED);
    expect(s.count).toBe(2);
  });

  it('succeeded is true ONLY on a persisted EXECUTED_SUCCESS', () => {
    expect(summarizeExecutionState([row('EXECUTED_SUCCESS')]).succeeded).toBe(true);
    for (const s of ['QUEUED', 'EXECUTING', 'PENDING', 'EXECUTED_FAILED', 'TIMED_OUT']) {
      expect(summarizeExecutionState([row(s)]).succeeded).toBe(false);
    }
  });

  it('does not collapse a retry chain into one execution', () => {
    // Three rows are three rows. Reporting count 1 would make a twice-retried
    // action indistinguishable from a single clean one.
    const s = summarizeExecutionState([row('QUEUED'), row('EXECUTED_FAILED'), row('EXECUTED_FAILED')]);
    expect(s.count).toBe(3);
  });
});
