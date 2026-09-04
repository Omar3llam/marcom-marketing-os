// ============================================================
// C-18 · the sentence a strategist reads after promoting
// ------------------------------------------------------------
// Master prints one sentence for every promotion:
//
//   {promoteResult && (
//     <p>Promoted — {promoteResult.decisionsCreated} proposed move{…}.
//        Confirm {…} in Decisions to execute.</p>
//   )}
//
// Two of the three things that can happen render as that sentence with a zero
// in it. "Promoted — 0 proposed moves. Confirm them in Decisions to execute" is
// worse than saying nothing: it sends a person to a queue that has nothing in
// it for them, and the plan they came from looks unfinished.
// ============================================================
import { describe, it, expect } from 'vitest';
import { PROMOTION_OUTCOME } from '@marcom/runtime-contracts';
import { promotionCopyFor, isPromoted } from './promotionCopy.js';

const at = '2026-09-01T08:00:00.000Z';

describe('one sentence per outcome', () => {
  it('moves were staged — say how many, and where to confirm them', () => {
    const copy = promotionCopyFor({ outcome: PROMOTION_OUTCOME.PROMOTED, decisionsCreated: 3, promotedAt: at });

    expect(copy.tone).toBe('success');
    expect(copy.message).toMatch(/3 proposed moves/);
    expect(copy.message).toMatch(/Decisions/);
  });

  it('reads correctly at one, not just at many', () => {
    // The trap C-07's real-row run caught: "1 campaign have never been measured".
    const one = promotionCopyFor({ outcome: PROMOTION_OUTCOME.PROMOTED, decisionsCreated: 1, promotedAt: at });
    expect(one.message).toMatch(/1 proposed move\b/);
    expect(one.message).not.toMatch(/1 proposed moves/);
  });

  it('no moves — say the mix is already in place, and send nobody anywhere', () => {
    const copy = promotionCopyFor({ outcome: PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES, decisionsCreated: 0, promotedAt: at });

    // The defect is the INSTRUCTION, not the word. "there is nothing to confirm"
    // uses it and sends nobody anywhere; the first draft of this test banned the
    // word and would have rejected the better sentence.
    expect(copy.message).not.toMatch(/in Decisions/i);
    expect(copy.message).not.toMatch(/\b0\b/);
    expect(copy.message).toMatch(/already/i);
  });

  it('already promoted — say when, and that nothing happened just now', () => {
    const copy = promotionCopyFor({ outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, decisionsCreated: 0, promotedAt: at });

    expect(copy.tone).toBe('neutral');
    expect(copy.message).not.toMatch(/Confirm/i);
    expect(copy.message).toMatch(/already promoted/i);
  });

  it('an unrecognised outcome says a promotion happened and claims nothing else', () => {
    // C-07's degradation rule: silence about the next step is honest; a
    // confident wrong next step is not.
    const copy = promotionCopyFor({ outcome: 'PROMOTED_SIDEWAYS', decisionsCreated: 4, promotedAt: at });

    expect(copy.message).not.toMatch(/Confirm/i);
    expect(copy.message).not.toMatch(/4/);
  });

  it('answers null for no result at all, rather than an empty banner', () => {
    expect(promotionCopyFor(null)).toBeNull();
    expect(promotionCopyFor(undefined)).toBeNull();
  });
});

describe('what marks a plan as promoted', () => {
  it('a promoted plan with no moves has no allocationPlanId — and is still promoted', () => {
    // The button disabled on `detail.allocationPlanId` would re-arm here, and a
    // second promote would run against a plan already in force.
    expect(isPromoted({ promotedAt: at, allocationPlanId: null })).toBe(true);
  });

  it('recognises a plan promoted before this slice, which has no promotedAt', () => {
    expect(isPromoted({ promotedAt: null, allocationPlanId: 'alloc-old' })).toBe(true);
  });

  it('an unpromoted plan is not promoted', () => {
    expect(isPromoted({ promotedAt: null, allocationPlanId: null })).toBe(false);
    expect(isPromoted(null)).toBe(false);
  });
});
