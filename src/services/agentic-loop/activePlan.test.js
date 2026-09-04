// ============================================================
// C-18 · "the active plan" must mean the plan that is active
// ------------------------------------------------------------
// Master:
//
//   const activePlan = plans.find((p) => p.status === 'ACTIVE') ?? plans[0] ?? null;
//
// The fallback names ANY plan `activePlan` — the newest row, whatever its
// status — and `trackPlan` then computes goal landings for it, which reach the
// strategist band on /lumi/home.
//
// That fallback was survivable while ACTIVE was permanent: `find` almost always
// hit. C-18 makes CLOSED reachable, so a promoted plan whose period ended now
// leaves ACTIVE — and the fallback starts firing, for exactly the workspaces
// whose plan just expired. Making closure real without removing it would end
// with Lumi tracking the goals of a finished plan and calling it the current
// one. That is this slice's own consequence, so it is this slice's to close.
// ============================================================
import { describe, it, expect } from 'vitest';
import { activePlanOf } from './AgenticLoopService.js';

const plan = (id, status, createdAt) => ({ id, status, createdAt: new Date(createdAt) });

describe('activePlanOf', () => {
  it('returns the ACTIVE plan', () => {
    const plans = [plan('p-new', 'DRAFT', '2026-09-03'), plan('p-live', 'ACTIVE', '2026-06-01')];
    expect(activePlanOf(plans)?.id).toBe('p-live');
  });

  it('returns null when nothing is active — never the newest row instead', () => {
    const plans = [plan('p-draft', 'DRAFT', '2026-09-03'), plan('p-done', 'CLOSED', '2026-06-01')];
    expect(activePlanOf(plans)).toBeNull();
  });

  it('does not promote a CLOSED plan back into the present', () => {
    // The exact case C-18 creates: yesterday this workspace had an ACTIVE plan.
    // The closure sweep ended it. Nothing about that means its goals are still
    // the account's goals.
    expect(activePlanOf([plan('p-done', 'CLOSED', '2026-09-03')])).toBeNull();
  });

  it('does not treat an unpromoted draft as the plan in force', () => {
    expect(activePlanOf([plan('p-draft', 'DRAFT', '2026-09-03')])).toBeNull();
  });

  it('handles an empty list and a missing list', () => {
    expect(activePlanOf([])).toBeNull();
    expect(activePlanOf(undefined)).toBeNull();
    expect(activePlanOf(null)).toBeNull();
  });
});
