// ============================================================
// overviewPlan — the ordering IS the product decision
// ------------------------------------------------------------
// The page used to render one fixed stack for every account, so a LEARNING
// workspace got the same furniture as a bleeding one. These pin the two rules
// that make a state-ordered layout safe to ship:
//
//   1. a state may REORDER and DEFER, never DELETE
//   2. the hero is always first — a nudge or a number must not outrank the
//      account's own answer
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildSurfacePlan, SLOT } from './overviewPlan.js';
import { ACCOUNT_STATE } from './overviewState.js';

const plan = (over = {}) => buildSurfacePlan({
  accountState: ACCOUNT_STATE.ACTION_REQUIRED, hasAnyData: true, showCopilot: true, ...over,
});

const ALL_STATES = Object.values(ACCOUNT_STATE);

describe('the hero leads, always', () => {
  it.each(ALL_STATES)('%s puts the hero first', (accountState) => {
    expect(plan({ accountState }).main[0]).toBe(SLOT.HERO);
  });

  it('a null state (still loading) renders the hero slot and no bands', () => {
    expect(plan({ accountState: null }).main).toEqual([SLOT.HERO]);
  });
});

describe('nothing is deleted by state', () => {
  // The rule that makes reordering safe: every deferrable slot is either
  // promoted into main or present in deferred. A state can rank a block lower;
  // it cannot make it unreachable.
  const DEFERRABLE = [
    SLOT.REVENUE_NOTICES, SLOT.PACING, SLOT.KPIS, SLOT.AGENDA, SLOT.BRIEFING, SLOT.COPILOT,
  ];

  it.each(ALL_STATES)('%s loses no slot', (accountState) => {
    const p = plan({ accountState });
    const shown = new Set([...p.main, ...p.deferred]);
    for (const slot of DEFERRABLE) expect(shown.has(slot), `${slot} vanished`).toBe(true);
  });

  // The first draft dropped KPIs/pacing/agenda on LEARNING on the theory that
  // they would all read "—". False: LEARNING means the engine scored nothing,
  // not that there is no data — spend and CPA are real, and the agenda reads a
  // different substrate entirely.
  it('LEARNING still reaches the KPI strip and the agenda', () => {
    const p = plan({ accountState: ACCOUNT_STATE.LEARNING });
    expect([...p.main, ...p.deferred]).toEqual(expect.arrayContaining([SLOT.KPIS, SLOT.AGENDA]));
  });
});

describe('urgency decides what is above the fold', () => {
  it('ACTION_REQUIRED leads with the decisions and defers the numbers', () => {
    const p = plan({ accountState: ACCOUNT_STATE.ACTION_REQUIRED });
    expect(p.main[1]).toBe(SLOT.ACT_NOW);
    expect(p.main).not.toContain(SLOT.KPIS);
    expect(p.deferred).toContain(SLOT.KPIS);
  });

  // Nothing to decide → "how is it going" becomes the real question.
  it('PERFORMING_WELL promotes the numbers instead', () => {
    const p = plan({ accountState: ACCOUNT_STATE.PERFORMING_WELL });
    expect(p.main).toContain(SLOT.KPIS);
    expect(p.deferred).not.toContain(SLOT.KPIS);
  });

  it('WATCH_CLOSELY leads with the watch band, not an empty act-now', () => {
    const p = plan({ accountState: ACCOUNT_STATE.WATCH_CLOSELY });
    expect(p.main[1]).toBe(SLOT.WATCH);
    expect(p.main).not.toContain(SLOT.ACT_NOW);
  });

  // A CLIENT can read spend and CPA even though verdicts are hidden from it,
  // so the numbers are the most useful thing that seat has.
  it('SCORING_HIDDEN keeps the readable numbers above the fold', () => {
    expect(plan({ accountState: ACCOUNT_STATE.SCORING_HIDDEN }).main)
      .toEqual(expect.arrayContaining([SLOT.KPIS, SLOT.PACING]));
  });
});

describe('slots that need something to describe', () => {
  it('drops the agenda and briefing when no substrate carries campaigns', () => {
    const p = plan({ accountState: ACCOUNT_STATE.LEARNING, hasAnyData: false });
    expect(p.deferred).not.toContain(SLOT.AGENDA);
    expect(p.deferred).not.toContain(SLOT.BRIEFING);
  });

  it('drops the copilot for the read-only seat', () => {
    expect(plan({ showCopilot: false }).deferred).not.toContain(SLOT.COPILOT);
    expect(plan({ showCopilot: true }).deferred).toContain(SLOT.COPILOT);
  });

  // Loading withholds the STATE-dependent claims only. Blanking the page while
  // one fetch lands would be a worse lie than the flash the gate prevents.
  it('a null state still renders the supporting detail', () => {
    const p = plan({ accountState: null });
    expect(p.deferred).toEqual(expect.arrayContaining([SLOT.KPIS, SLOT.AGENDA]));
  });
});

describe('the rail', () => {
  it.each([...ALL_STATES, null])('is the same for %s — it explains, it does not react', (accountState) => {
    expect(plan({ accountState }).rail).toEqual([SLOT.CHANNELS, SLOT.CALIBRATION]);
  });

  it('never carries a decision band', () => {
    for (const accountState of ALL_STATES) {
      const { rail } = plan({ accountState });
      expect(rail).not.toContain(SLOT.ACT_NOW);
      expect(rail).not.toContain(SLOT.WATCH);
    }
  });
});

describe('robustness', () => {
  it('no argument at all is a plan, not a throw', () => {
    const p = buildSurfacePlan();
    expect(p.main).toEqual([SLOT.HERO]);
    expect(p.rail).toHaveLength(2);
  });

  it('an unknown state falls back to LEARNING rather than rendering nothing', () => {
    expect(plan({ accountState: 'SOMETHING_NEW' }).main).toEqual([SLOT.HERO]);
  });

  it('carries the interrupt through untouched', () => {
    expect(plan({ interrupt: 'revenue' }).interrupt).toBe('revenue');
    expect(plan().interrupt).toBeNull();
  });
});
