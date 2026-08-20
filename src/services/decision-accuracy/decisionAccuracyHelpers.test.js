// ============================================================
// decisionAccuracyHelpers — one definition of "actioned"
// ============================================================
// These four functions are the whole reason the Proof Engine can see any rows at
// all. Before them the surface asked `status === 'EXECUTED'`, nothing wrote that
// status, and every gate matched an empty set — a report on zero decisions that
// raised no error and looked exactly like a young workspace.
//
// The property worth protecting is that the definition lives in ONE place: when
// provenance gets stricter (a Meta action id, a verifiedAt), that is a change
// here and nowhere else.
import { describe, it, expect } from 'vitest';
import {
  isExecuted, isDismissed, isActioned, deriveAccuracyStatus,
} from './decisionAccuracyHelpers.js';

const at = new Date('2026-08-01T10:00:00.000Z');

describe('isExecuted / isDismissed', () => {
  it('reads the timestamp, not the status', () => {
    // The human-signal routes leave status PROPOSED on purpose. A predicate that
    // consulted status would report false on every decision anyone ever acted on.
    expect(isExecuted({ status: 'PROPOSED', humanExecutedAt: at })).toBe(true);
    expect(isExecuted({ status: 'EXECUTED', humanExecutedAt: null })).toBe(false);
    expect(isDismissed({ status: 'PROPOSED', dismissedAt: at })).toBe(true);
    expect(isDismissed({ status: 'DISMISSED', dismissedAt: null })).toBe(false);
  });

  it('treats null and undefined alike — an unselected column must not read as a signal', () => {
    expect(isExecuted({ humanExecutedAt: null })).toBe(false);
    expect(isExecuted({})).toBe(false);
    expect(isDismissed({ dismissedAt: null })).toBe(false);
    expect(isDismissed({})).toBe(false);
  });

  it('survives a null row rather than throwing inside a filter', () => {
    expect(isExecuted(null)).toBe(false);
    expect(isDismissed(undefined)).toBe(false);
    expect(isActioned(null)).toBe(false);
  });
});

describe('isActioned — the union, not "executed"', () => {
  it('counts a dismissal', () => {
    // A dismissal is survivorship data the coverage report needs. Treating it as
    // no-signal would quietly shrink the denominator the accuracy claim rests on.
    expect(isActioned({ dismissedAt: at })).toBe(true);
    expect(isActioned({ humanExecutedAt: at })).toBe(true);
    expect(isActioned({ humanExecutedAt: null, dismissedAt: null })).toBe(false);
  });
});

describe('deriveAccuracyStatus — status becomes a view of the timestamps', () => {
  it('projects each signal onto the vocabulary the engine speaks', () => {
    expect(deriveAccuracyStatus({ status: 'PROPOSED', humanExecutedAt: at })).toBe('EXECUTED');
    expect(deriveAccuracyStatus({ status: 'PROPOSED', dismissedAt: at })).toBe('DISMISSED');
  });

  it('passes the raw status through when no signal landed', () => {
    // Load-bearing: the engine's "PROPOSED is not a realized prediction" branch
    // depends on an un-actioned row still reporting PROPOSED.
    expect(deriveAccuracyStatus({ status: 'PROPOSED' })).toBe('PROPOSED');
    expect(deriveAccuracyStatus({ status: 'SUPERSEDED' })).toBe('SUPERSEDED');
    // And a row that genuinely holds EXECUTED (none do today, but the enum is
    // real and a future writer may set it) is still honoured.
    expect(deriveAccuracyStatus({ status: 'EXECUTED' })).toBe('EXECUTED');
  });

  it('ignores the status once a signal exists — a superseded row keeps its action', () => {
    // The common case: acted on while live, replaced by the next sweep. The
    // action still happened, and scoping this on status would have discarded
    // nearly every decision anyone ever acted on.
    expect(deriveAccuracyStatus({ status: 'SUPERSEDED', humanExecutedAt: at })).toBe('EXECUTED');
  });

  it('executed wins if a row somehow carries both', () => {
    // The routes 409 the second signal, so this is unreachable through the API.
    // Pinned anyway: an action taken is a stronger fact about the world than an
    // intention not to, and an undefined tiebreak would resolve by field order.
    expect(deriveAccuracyStatus({ humanExecutedAt: at, dismissedAt: at })).toBe('EXECUTED');
  });
});
