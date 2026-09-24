// ============================================================
// Spend-Window Integrity · RED — ALLOCATION
// ------------------------------------------------------------
// An allocation divides a budget that governs a PERIOD, and sizes each move as
// `recommended − current`. "Current" was whatever the last sync fetched. Measured
// before this file: two identical channels spending exactly on budget produced
//
//     "Trim a by 60000 (HOLD, blended ROAS 2.00x)."   ×2
//
// as PROPOSED REALLOCATE Decisions — a false instruction to cut real spend.
//
// THE PERIOD THE BUDGET GOVERNS is never invented here:
//   · the monthly spend cap (Reallocate Capital) governs the calendar month;
//   · a plan governs its own periodStart → periodEnd.
// A move may be sized only from spend whose declared window IS that period,
// complete. Anything else produces no number at all — not a delta, not a
// target split, not a projection — because every one of them is computed from
// the same spend.
//
// ⚠️ INSTRUMENT DISCIPLINE. A genuine August measurement against an August plan
// must still produce real, sized moves; a JULY measurement against the same
// plan must not. An implementation that refuses everything fails the first; one
// that accepts any complete month fails the second.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NOW, WINDOWS, snapshot, spendOver } from './spendWindowIntegrity.harness.js';

const io = vi.hoisted(() => ({ rows: [], created: [] }));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/evidence/index.js', () => ({
  selectOperationalSnapshots: vi.fn(async () => io.rows),
}));
vi.mock('../services/connectors/credentialStore.js', () => ({
  listConnections: vi.fn(async () => []),
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(async (callback) => callback({
      allocationPlan: { create: vi.fn(async ({ data }) => { io.created.push(data); return { id: 'alloc-1', ...data }; }) },
      decision: { createMany: vi.fn(async () => ({ count: 0 })) },
    })),
    campaign: {
      findMany: vi.fn(async () => [
        { id: 'camp-a', name: 'A', channel: 'META' },
        { id: 'camp-b', name: 'B', channel: 'META' },
      ]),
    },
    workspace: { findUnique: vi.fn(async () => ({ currency: 'USD' })) },
    decision: { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({ count: 0 })) },
    allocationPlan: {
      create: vi.fn(async ({ data }) => { io.created.push(data); return { id: 'alloc-1', ...data }; }),
    },
  },
}));

const { previewAllocation, commitAllocation, planToDecisionRows } =
  await import('../services/allocation-engine/AllocationService.js');
const { prisma } = await import('../lib/prisma.js');

beforeEach(() => {
  io.rows = [];
  io.created = [];
  vi.clearAllMocks();
});

const PER_CHANNEL_DAY = 1_000;
const SEPTEMBER_BUDGET = PER_CHANNEL_DAY * 30 * 2;
const AUGUST_BUDGET = PER_CHANNEL_DAY * 31 * 2;
const AUGUST_PERIOD = Object.freeze({ start: '2026-08-01', end: '2026-08-31' });

/** Two identical channels on one declared window. */
const twin = (window, roas = [2, 2]) => ['camp-a', 'camp-b'].map((entityId, i) => snapshot({
  entityId, window, spendMinor: spendOver(window, PER_CHANNEL_DAY), revenueMinor: spendOver(window, PER_CHANNEL_DAY) * roas[i],
}));

const SIZED = /\bby\s+-?\d/;

/** Every number an allocation derives from current spend. */
function assertNoNumbers(plan) {
  for (const a of plan.allocations) {
    expect(a.currentSpendMinor, `${a.channelId} current`).toBeNull();
    expect(a.recommendedSpendMinor, `${a.channelId} recommended`).toBeNull();
    expect(a.deltaMinor, `${a.channelId} delta`).toBeNull();
    expect(a.rationale).not.toMatch(SIZED);
  }
  expect(plan.projected?.blendedRevenueMinor ?? null).toBeNull();
  expect(plan.projected?.blendedRevenueEfficiencyAfter ?? null).toBeNull();
  for (const line of plan.reasoningTrail ?? []) expect(line).not.toMatch(SIZED);
  expect(planToDecisionRows(plan, { workspaceId: 'ws', planId: 'p' })).toEqual([]);
}

// ── CONTROLS ───────────────────────────────────────────────────────────────
describe('a genuine measurement of the governed period still sizes real moves', () => {
  it('a genuine August measurement against an August plan sizes moves', async () => {
    // Channel B earns half of A's ROAS, so the budget genuinely moves toward A.
    io.rows = twin(WINDOWS.AUGUST, [3, 1.5]);
    const plan = await previewAllocation('ws', { totalBudgetMinor: AUGUST_BUDGET, totalBudgetCurrency: 'USD', period: AUGUST_PERIOD, now: NOW });

    expect(plan.spendPeriod?.status).toBe('MEASURABLE');
    expect(plan.spendPeriod?.window).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    const a = plan.allocations.find((x) => x.channelId === 'camp-a');
    expect(a.currentSpendMinor).toBe(31_000);
    expect(a.deltaMinor).toBeGreaterThan(0);
    expect(planToDecisionRows(plan, { workspaceId: 'ws', planId: 'p' }).length).toBe(2);
  });

  it('identical channels spending exactly an August budget ask for no move — for the right reason', async () => {
    io.rows = twin(WINDOWS.AUGUST);
    const plan = await previewAllocation('ws', { totalBudgetMinor: AUGUST_BUDGET, totalBudgetCurrency: 'USD', period: AUGUST_PERIOD, now: NOW });
    expect(plan.spendPeriod?.status).toBe('MEASURABLE');
    expect(plan.allocations.map((x) => x.deltaMinor)).toEqual([0, 0]);
    expect(planToDecisionRows(plan, { workspaceId: 'ws', planId: 'p' })).toEqual([]);
  });
});

// ── 1. The measured defect ─────────────────────────────────────────────────
describe('allocation never sizes a move from spend of a different period', () => {
  it.each([
    ['a 90-day cron sync', WINDOWS.LAST_90D],
    ['an all-time Sync button', WINDOWS.MAXIMUM],
    ['the canonical 30-day window', WINDOWS.CANONICAL_30D],
    ['this month, only partly elapsed', WINDOWS.MONTH_TO_DATE],
  ])('%s against the monthly cap produces no numeric recommendation', async (_label, window) => {
    io.rows = twin(window);
    const plan = await previewAllocation('ws', { totalBudgetMinor: SEPTEMBER_BUDGET, totalBudgetCurrency: 'USD', now: NOW });

    expect(plan, 'a refusal is still an answer — never null, which already means "no channels"').not.toBeNull();
    expect(plan.spendPeriod?.status).toBe('NOT_MEASURABLE');
    expect(plan.spendPeriod?.reason).toBe('WINDOW_MISMATCH');
    expect(plan.spendPeriod?.period).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    assertNoNumbers(plan);
  });

  it('a COMPLETE month that is the wrong month is still the wrong period', async () => {
    io.rows = twin(WINDOWS.JULY);
    const plan = await previewAllocation('ws', { totalBudgetMinor: AUGUST_BUDGET, totalBudgetCurrency: 'USD', period: AUGUST_PERIOD, now: NOW });
    expect(plan.spendPeriod?.reason).toBe('WINDOW_MISMATCH');
    assertNoNumbers(plan);
  });

  it('an undeclared window is NOT_MEASURABLE, whatever the sync date', async () => {
    io.rows = ['camp-a', 'camp-b'].map((entityId) => snapshot({ entityId, window: null, spendMinor: 31_000 }));
    const plan = await previewAllocation('ws', { totalBudgetMinor: AUGUST_BUDGET, totalBudgetCurrency: 'USD', period: AUGUST_PERIOD, now: NOW });
    expect(plan.spendPeriod?.reason).toBe('WINDOW_UNKNOWN');
    assertNoNumbers(plan);
  });

  it('a channel with NO spend row for the period is unknown, not a channel that spent zero', async () => {
    // Added after the mutation battery: removing this guard survived every other
    // case, because no fixture seated a channel whose only row is a revenue
    // actual. The engine reads a missing currentSpendMinor as 0 — so camp-c
    // would be "grown by" its whole share, sized from spend nobody measured.
    io.rows = [
      ...twin(WINDOWS.AUGUST),
      snapshot({ entityId: 'camp-c', source: 'GA4', measurementWindow: 'LEGACY_UNKNOWN', window: null, spendMinor: 0, revenueMinor: 40_000 }),
    ];
    const plan = await previewAllocation('ws', { totalBudgetMinor: AUGUST_BUDGET, totalBudgetCurrency: 'USD', period: AUGUST_PERIOD, now: NOW });
    expect(plan.allocations.map((a) => a.channelId)).toContain('camp-c');
    expect(plan.spendPeriod?.status).toBe('NOT_MEASURABLE');
    expect(plan.spendPeriod?.reason).toBe('NO_SPEND_ROWS');
    assertNoNumbers(plan);
  });

  it('channels measured over different windows cannot be compared with each other', async () => {
    io.rows = [
      snapshot({ entityId: 'camp-a', window: WINDOWS.AUGUST, spendMinor: 31_000, revenueMinor: 62_000 }),
      snapshot({ entityId: 'camp-b', window: WINDOWS.LAST_90D, spendMinor: 90_000, revenueMinor: 180_000 }),
    ];
    const plan = await previewAllocation('ws', { totalBudgetMinor: AUGUST_BUDGET, totalBudgetCurrency: 'USD', period: AUGUST_PERIOD, now: NOW });
    expect(plan.spendPeriod?.reason).toBe('MIXED_WINDOWS');
    assertNoNumbers(plan);
  });
});

// ── 2. The decision rows ───────────────────────────────────────────────────
describe('only a measured move becomes a Decision', () => {
  const move = (deltaMinor) => ({
    channelId: 'camp-a', channel: 'META', verdict: 'HOLD', blendedRoas: 2,
    currentSpendMinor: 1, recommendedSpendMinor: 1, deltaMinor, rationale: 'x',
  });

  it('a null delta is not a move', () => {
    const plan = { spendPeriod: { status: 'MEASURABLE' }, allocations: [move(null)] };
    expect(planToDecisionRows(plan, { workspaceId: 'ws', planId: 'p' })).toEqual([]);
  });

  it('a numeric delta with NO recorded spend period is not a measured move', () => {
    // Every mix persisted before this slice looks exactly like this.
    const plan = { allocations: [move(-60_000)] };
    expect(planToDecisionRows(plan, { workspaceId: 'ws', planId: 'p' })).toEqual([]);
  });

  it('a numeric delta from a NOT_MEASURABLE period is not a measured move', () => {
    const plan = { spendPeriod: { status: 'NOT_MEASURABLE' }, allocations: [move(-60_000)] };
    expect(planToDecisionRows(plan, { workspaceId: 'ws', planId: 'p' })).toEqual([]);
  });

  it('control — a measured, non-zero move still becomes a Decision', () => {
    const plan = { monetaryStatus: 'MONETARY_VALID', efficiencyStatus: 'VALID', currency: 'USD', spendPeriod: { status: 'MEASURABLE', currency: 'USD' }, allocations: [move(-60_000)] };
    expect(planToDecisionRows(plan, { workspaceId: 'ws', planId: 'p' })).toHaveLength(1);
  });
});

// ── 3. The budget survives ─────────────────────────────────────────────────
describe('unavailable monetary allocation cannot be persisted', () => {
  it('refuses an unmeasurable spend period before any AllocationPlan or Decision write', async () => {
    io.rows = twin(WINDOWS.LAST_90D);
    await expect(commitAllocation('ws', { totalBudgetMinor: SEPTEMBER_BUDGET, totalBudgetCurrency: 'USD', now: NOW }))
      .rejects.toMatchObject({ code: 'AllocationMonetaryUnavailable', reason: 'WINDOW_MISMATCH' });

    expect(io.created).toEqual([]);
    expect(prisma.decision.createMany).not.toHaveBeenCalled();
  });
});
