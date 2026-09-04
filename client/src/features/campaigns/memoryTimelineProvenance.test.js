// ============================================================
// C-12 · T3–T5 — the lens must not un-do B4-A (RED)
// ------------------------------------------------------------
// The live defect this slice exists for:
//
//     /** What a human did about it. */
//     function actionLabel(item) {
//       if (item?.executedAt) return 'Executed';
//
// `executedAt` is the DERIVED union `platformExecutedAt ?? humanExecutedAt`. So
// when Lumi's worker landed the mutation on Meta, this timeline tells the
// operator a human did it — and the function says "a human" in its own
// docstring. B4-A spent a slice splitting those two facts apart precisely
// because "was this acted on" and "did LUMI act" are different questions; the
// campaign lens is where they were quietly rejoined.
//
// This file's whole subject is that ONE label, so every case is a label.
// ============================================================
import { describe, it, expect } from 'vitest';
import { EXECUTION_PROVENANCE } from '@marcom/runtime-contracts';
import { buildMemoryTimelineViewModel } from './memoryTimelineViewModel.js';

const item = (over = {}) => ({
  id: 'd1', verdict: 'KILL', status: 'PROPOSED', createdAt: '2026-08-01T00:00:00.000Z',
  executionProvenance: EXECUTION_PROVENANCE.NONE,
  executedAt: null, dismissedAt: null, resolution: null, confidenceDelta: null, ...over,
});
const actionOf = (over) => buildMemoryTimelineViewModel({ count: 1, items: [item(over)] }).items[0].action;

describe('C-12 · T3 — a mutation Lumi performed is never reported as a human\'s', () => {
  it('PLATFORM does not read as something the operator did', () => {
    const label = actionOf({
      executionProvenance: EXECUTION_PROVENANCE.PLATFORM,
      executedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(label).toMatch(/lumi/i);
    expect(label).not.toMatch(/\byou\b|yourself/i);
  });

  it('and it is decided by the token, not by the derived timestamp', () => {
    // The union is present on both rows below and points the same way. Only the
    // token separates them, which is the entire point of publishing it.
    const platform = actionOf({
      executionProvenance: EXECUTION_PROVENANCE.PLATFORM, executedAt: '2026-08-02T00:00:00.000Z',
    });
    const human = actionOf({
      executionProvenance: EXECUTION_PROVENANCE.HUMAN, executedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(platform).not.toBe(human);
  });
});

describe('C-12 · T4 — three executions, three labels', () => {
  it('HUMAN, PLATFORM and BOTH are all distinguishable', () => {
    const labels = [EXECUTION_PROVENANCE.HUMAN, EXECUTION_PROVENANCE.PLATFORM, EXECUTION_PROVENANCE.BOTH]
      .map((p) => actionOf({ executionProvenance: p, executedAt: '2026-08-02T00:00:00.000Z' }));
    expect(new Set(labels).size).toBe(3);
  });

  it('BOTH names both, rather than picking the stronger one', () => {
    // Neither write clears the other and neither implies the other. A label
    // that showed only the platform fact would delete the operator's own
    // record of what they did.
    const label = actionOf({
      executionProvenance: EXECUTION_PROVENANCE.BOTH, executedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(label).toMatch(/lumi/i);
    expect(label).toMatch(/\byou\b/i);
  });
});

describe('C-12 · T5 — NONE still falls through, unchanged', () => {
  it('a dismissal is still a dismissal', () => {
    expect(actionOf({ dismissedAt: '2026-08-02T00:00:00.000Z' })).toBe('Dismissed');
  });

  it('a superseded row still reads as replaced', () => {
    expect(actionOf({ status: 'SUPERSEDED' })).toBe('Replaced by a later call');
  });

  it('and an untouched decision still records no answer', () => {
    expect(actionOf({})).toBe('No answer recorded');
  });

  it('a payload with no token says it happened, and does not say who', () => {
    // A cached response, or a row from before this slice. It would be easy to
    // fall through to "No answer recorded" here — and that is a NEW falsehood,
    // worse than the one this slice is fixing: the row WAS acted on. The
    // unattributed label is the honest one, and it is exactly what shipped
    // before, so an old payload renders as it always did.
    expect(actionOf({ executionProvenance: undefined, executedAt: '2026-08-02T00:00:00.000Z' }))
      .toBe('Executed');
  });
});
