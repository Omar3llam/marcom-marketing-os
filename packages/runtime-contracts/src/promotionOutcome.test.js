// ============================================================
// C-18 · PROMOTION_OUTCOME — a promotion says what it did
// ------------------------------------------------------------
// Before this slice `promotePlanMix` answered with a count and a boolean
// nobody read: `{ decisionsCreated, alreadyPromoted }`. Three different events
// arrived as the same shape, and the client rendered one sentence for all of
// them — including "Promoted — 0 proposed moves. Confirm them in Decisions to
// execute", which is an instruction to go somewhere and confirm nothing.
//
// C-07 proved a count cannot carry a reason. This is the same lesson one object
// over: a count cannot carry an OUTCOME either.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  PROMOTION_OUTCOME,
  PROMOTION_OUTCOME_VALUES,
  isPromotionOutcome,
} from './promotionOutcome.js';

describe('the four outcomes of a promotion', () => {
  // Three at C-18. The spend-window slice added the fourth: moves that were
  // never measured are not moves that were not needed.
  it('names exactly four, and no more', () => {
    expect(PROMOTION_OUTCOME_VALUES).toHaveLength(4);
    expect([...PROMOTION_OUTCOME_VALUES].sort()).toEqual([
      'ALREADY_PROMOTED', 'PROMOTED', 'PROMOTED_MOVES_NOT_MEASURABLE', 'PROMOTED_WITH_NO_MOVES',
    ]);
  });

  it('separates "nothing was asked for" from "nothing could be sized"', () => {
    expect(PROMOTION_OUTCOME.PROMOTED_MOVES_NOT_MEASURABLE).not.toBe(PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES);
  });

  it('separates "promoted, and it asked for nothing" from "promoted, with moves"', () => {
    // The distinction the old `decisionsCreated: 0` collapsed. An approved mix
    // that matches current spend IS a promotion — it just has nothing to confirm.
    expect(PROMOTION_OUTCOME.PROMOTED).not.toBe(PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES);
  });

  it('separates both of those from "this already happened"', () => {
    expect(PROMOTION_OUTCOME.ALREADY_PROMOTED).not.toBe(PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES);
    expect(PROMOTION_OUTCOME.ALREADY_PROMOTED).not.toBe(PROMOTION_OUTCOME.PROMOTED);
  });

  it('is frozen — a consumer cannot add a fourth outcome at runtime', () => {
    expect(Object.isFrozen(PROMOTION_OUTCOME)).toBe(true);
  });

  it('recognises its own values and nothing else', () => {
    for (const v of PROMOTION_OUTCOME_VALUES) expect(isPromotionOutcome(v)).toBe(true);
    expect(isPromotionOutcome('PROMOTED_MAYBE')).toBe(false);
    expect(isPromotionOutcome(null)).toBe(false);
    expect(isPromotionOutcome(undefined)).toBe(false);
    expect(isPromotionOutcome('')).toBe(false);
  });
});

describe('the suffix is deliberate', () => {
  it('is an _OUTCOME, not a _STATUS — it describes an act, not what Lumi knows', () => {
    // C-06's ratchet has a declared jurisdiction: _STATUS | _STATE | _REASON |
    // _RUN. This vocabulary sits outside it ON PURPOSE. Every member of that
    // jurisdiction answers "what do we know about X". These three answer "what
    // did this call do", which has no epistemic token to declare — naming it
    // PROMOTION_STATUS would drag it into a ratchet that would then demand a
    // knowledge claim it cannot honestly make.
    for (const suffix of ['_STATUS', '_STATE', '_REASON', '_RUN']) {
      expect('PROMOTION_OUTCOME'.endsWith(suffix)).toBe(false);
    }
  });
});
