// ============================================================
// B8-03 — the THEN destination gets its OWN read
// ------------------------------------------------------------
// RULING (Omar, 2026-09-06): a dedicated history read. NOT an extension of
// `/decisions/recent`.
//
// WHY NOT REUSE. Measured on trunk, `/decisions/recent` is a SIDEBAR substrate:
// SIGNAL-only, `take: 20`, no cursor, no total, and `RECENT_DECISION_SELECT`
// does not even carry `decisionClass`. Its own comments say
// `// sidebar: identity of the row it renders`. Growing it would bind a whole
// destination to a narrow surface's question — which is C-12's defect exactly,
// where one surface's lens was repurposed for another's.
//
// WHY SIGNAL + GUARDRAIL AND NOTHING ELSE. Only three sites create decision
// rows on trunk:
//
//     VerdictService.js:158          decision.create      → SIGNAL
//     GuardrailSweepService.js:226   decision.createMany  → GUARDRAIL
//     AllocationService.js:192       decision.createMany  → ALLOCATION
//
// No writer creates an EXPERIMENT decision row — the `decisionClass:
// EXPERIMENT` in agenticPlanner is on an IN-MEMORY agenda item sourced from
// TestExperiment / IncrementalityTest. So the list is not "missing" Experiment;
// Experiment does not live in this substrate. ALLOCATION is excluded by R-3,
// and `/decisions/:id` already refuses it with a typed 409.
//
// This file is the STRUCTURAL half. Ordering, pagination and the total are
// asserted against real rows in decisionHistoryList.db.contract.test.js,
// because a mock would answer whatever it was handed.
// ============================================================
import { describe, it, expect } from 'vitest';
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { scopeFor } from './decisionClassScope.js';
import {
  HISTORY_PAGE_SIZE,
  HISTORY_PAGE_SELECT,
  getDecisionHistoryPage,
} from '../decision-memory/decisionHistoryList.js';

describe('B8-03 · the read declares its own jurisdiction', () => {
  it('is DECLARED in the C-10 registry — an undeclared reader throws', () => {
    expect(() => scopeFor('decisions/history')).not.toThrow();
  });

  it('admits SIGNAL and GUARDRAIL, and only those two', () => {
    const scope = scopeFor('decisions/history');
    expect([...scope.decisionClass.in].sort())
      .toEqual([DECISION_CLASS.GUARDRAIL, DECISION_CLASS.SIGNAL].sort());
  });

  it('excludes ALLOCATION — R-3, a plan artifact is not a Decision', () => {
    expect(scopeFor('decisions/history').decisionClass.in)
      .not.toContain(DECISION_CLASS.ALLOCATION);
  });

  it('excludes EXPERIMENT — no writer puts one in this table', () => {
    // Not a gap. Experiment identity lives in TestExperiment /
    // IncrementalityTest; a scope that admitted it here would promise a
    // population that cannot exist.
    expect(scopeFor('decisions/history').decisionClass.in)
      .not.toContain(DECISION_CLASS.EXPERIMENT);
  });

  it('does NOT borrow the sidebar reader\'s scope', () => {
    // They answer different questions and must be free to diverge.
    const history = [...scopeFor('decisions/history').decisionClass.in].sort();
    const sidebar = [...scopeFor('memory/recent-decisions').decisionClass.in].sort();
    expect(history).not.toEqual(sidebar);
  });
});

describe('B8-03 · the projection carries what the destination renders', () => {
  it('selects decisionClass — B8-02\'s row has a class-filled slot', () => {
    // RECENT_DECISION_SELECT omits it, which is why that read cannot serve
    // this surface.
    expect(HISTORY_PAGE_SELECT.decisionClass).toBe(true);
  });

  it('selects the fields a THEN row states', () => {
    for (const f of ['id', 'entityId', 'entityLevel', 'verdict', 'status',
      'diagnosis', 'rootCause', 'confidence', 'createdAt']) {
      expect(HISTORY_PAGE_SELECT[f], `HISTORY_PAGE_SELECT is missing ${f}`).toBe(true);
    }
  });

  it('does NOT select the whole row — a projection is a decision, not a default', () => {
    // Prisma widens a select-less read on every new column (see the
    // default-projection trap). The destination declares what it renders.
    expect(HISTORY_PAGE_SELECT.hypotheses).toBeUndefined();
    expect(HISTORY_PAGE_SELECT.counterfactuals).toBeUndefined();
  });

  it('declares a page size that is not the sidebar\'s cap', () => {
    expect(typeof HISTORY_PAGE_SIZE).toBe('number');
    expect(HISTORY_PAGE_SIZE).toBeGreaterThan(0);
  });

  it('exports the page reader', () => {
    expect(typeof getDecisionHistoryPage).toBe('function');
  });
});
