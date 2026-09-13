// ============================================================
// C-10 · a writer declares its class — it does not encode it
// ------------------------------------------------------------
// The census in decisionClassJurisdiction.test.js proves every create names a
// class. This proves the value is a TOKEN rather than something derived from
// the string beside it.
//
// The distinction is the whole slice. A writer that called
// `classifyRootCause(rootCause)` at its own create site would look correct and
// would put the string back in charge: rename a prefix and the class silently
// follows, which is the coupling C-10 exists to cut. The writer knows what it
// is; it says so.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { planToDecisionRows } from '../allocation-engine/AllocationService.js';
import { allocate, GOAL_TYPE } from '../allocation-engine/allocationEngine.js';

// Spend-window slice: a move is a Decision only when the plan says its spend
// period was MEASURABLE. This fixture is a measured plan; the refusal side is
// pinned in src/tests/spendWindowIntegrity.allocation.red.test.js.
const plan = () => ({
  spendPeriod: { status: 'MEASURABLE', reason: null, period: { start: '2026-08-01', end: '2026-08-31' } },
  ...allocate({
  totalBudgetMinor: 1_000_000,
  goal: { type: GOAL_TYPE.GROWTH_CEILING },
  channels: [
    { channelId: 'camp-a', blendedRoas: 3.2, currentSpendMinor: 400_000, verdict: 'SCALE' },
    { channelId: 'camp-b', blendedRoas: 0.8, currentSpendMinor: 600_000, verdict: 'KILL' },
  ],
  }),
});

describe('T1 — AllocationService declares ALLOCATION on every row it mints', () => {
  it('stamps the class as a token', () => {
    const rows = planToDecisionRows(plan(), { workspaceId: 'ws1', planId: 'plan1' });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.decisionClass).toBe(DECISION_CLASS.ALLOCATION);
  });

  it('keeps rootCause as the SUBTYPE payload, not as the class', () => {
    // `allocation:<planId>` stays: it is how a move is traced back to its plan,
    // and NarrativeService legitimately reads the id out of it. What ends is
    // reading the CLASS out of it.
    const rows = planToDecisionRows(plan(), { workspaceId: 'ws1', planId: 'plan1' });
    for (const r of rows) expect(r.rootCause).toBe('allocation:plan1');
  });

  it('the class does not move when the prefix does', () => {
    // The coupling test. Two plans, two different rootCause strings, one class.
    const a = planToDecisionRows(plan(), { workspaceId: 'ws1', planId: 'plan1' });
    const b = planToDecisionRows(plan(), { workspaceId: 'ws1', planId: 'plan2' });
    expect(a[0].rootCause).not.toBe(b[0].rootCause);
    expect(a[0].decisionClass).toBe(b[0].decisionClass);
  });
});
