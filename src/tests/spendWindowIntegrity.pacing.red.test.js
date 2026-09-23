// ============================================================
// Spend-Window Integrity · RED — PACING
// ------------------------------------------------------------
// Pacing answers "is this month's budget burning too fast?". That question has
// exactly one honest input: spend over THIS MONTH, TO DATE. PortfolioService
// used to write, in its own words, "treat the lookback spend as month-to-date",
// and divide whatever the last sync had fetched by the day of the month.
//
// Measured before this file existed, against the shipped modules: an account
// spending EXACTLY its budget was published on Attention as
//   "META over-pacing — Exhausts ~25.7 days early at the current run rate."
// after a cron sync, and ~28.9 days early after a Sync button. It stayed OVER
// on the last day of the month.
//
// ⚠️ INSTRUMENT DISCIPLINE. The cases below are paired so a wrong
// implementation cannot pass by accident:
//   · a 90-day row whose SPEND is exactly what a healthy month-to-date would be
//     — an implementation that judges by value, not window, passes pacing there
//     and must fail here;
//   · a genuine month-to-date row that is badly OVER — an implementation that
//     simply refuses everything, or suppresses the Attention card, fails here;
//   · a sync timestamp inside the month on a row with NO declared window — an
//     implementation that infers the window from `date` fails here.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NOW, PER_DAY, MONTHLY_BUDGET, WINDOWS, snapshot, spendOver, daysIn,
} from './spendWindowIntegrity.harness.js';

const io = vi.hoisted(() => ({ rows: [], budget: null }));

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
    campaign: {
      findMany: vi.fn(async () => [
        { id: 'camp-1', name: 'Campaign one', channel: 'META' },
        { id: 'camp-2', name: 'Campaign two', channel: 'META' },
      ]),
    },
    workspace: { findUnique: vi.fn(async () => ({ currency: 'USD' })) },
    allocationPlan: {
      findFirst: vi.fn(async () => (io.budget == null ? null : { totalBudgetMinor: io.budget, currency: 'USD' })),
    },
  },
}));

const { getPortfolio } = await import('../services/portfolio/PortfolioService.js');
const { planAgenda } = await import('../services/agentic-loop/agenticPlanner.js');

beforeEach(() => {
  io.rows = [];
  io.budget = MONTHLY_BUDGET;
});

/** Two campaigns on one declared window, splitting the account's real spend. */
const account = (window, perDay = PER_DAY, measurementWindow = 'ROLLING_WINDOW') => [
  snapshot({ entityId: 'camp-1', window, measurementWindow, spendMinor: spendOver(window, perDay / 2) }),
  snapshot({ entityId: 'camp-2', window, measurementWindow, spendMinor: spendOver(window, perDay / 2) }),
];

/**
 * The Attention seam, taken from the SHIPPED module. A copy of its body in this
 * file could not notice the day somebody edits the original to drop an alarm.
 */
async function attentionPacing(view) {
  let mod = null;
  try {
    mod = await import('../services/agentic-loop/AgenticLoopService.js');
  } catch (err) {
    throw new Error(`AgenticLoopService could not be imported under this harness: ${err.message}`);
  }
  expect(typeof mod.pacingFromPortfolio,
    'the function that turns portfolio pacing into Attention items must be exported, so Attention is tested and not a copy of it')
    .toBe('function');
  const agenda = planAgenda({ pacing: mod.pacingFromPortfolio(view), now: NOW });
  return [...agenda.buyerBand, ...agenda.strategistBand].filter((i) => i.type === 'PACING');
}

// ── CONTROLS — the instrument, before any claim about the product ─────────
describe('control — the fixtures say what they claim', () => {
  it('each named window has the length its preset implies', () => {
    expect(daysIn(WINDOWS.LAST_90D)).toBe(90);
    expect(daysIn(WINDOWS.MONTH_TO_DATE)).toBe(12);
    expect(daysIn(WINDOWS.AUGUST)).toBe(31);
    expect(daysIn(WINDOWS.MAXIMUM)).toBeGreaterThan(365);
  });

  it('the month-to-date window really starts on the first of NOW\'s month and ends before NOW', () => {
    expect(WINDOWS.MONTH_TO_DATE.start).toBe(NOW.toISOString().slice(0, 8) + '01');
    expect(new Date(`${WINDOWS.MONTH_TO_DATE.end}T00:00:00Z`).getTime()).toBeLessThan(NOW.getTime());
  });

  it('the "coincidental" 90-day row carries EXACTLY a healthy month-to-date spend', () => {
    // If these two numbers differ, the value-based trap below proves nothing.
    expect(PER_DAY * daysIn(WINDOWS.MONTH_TO_DATE)).toBe(12_000);
  });

  it('no budget → no pacing at all (the precondition is real, and unchanged)', async () => {
    io.budget = null;
    io.rows = account(WINDOWS.MONTH_TO_DATE);
    const v = await getPortfolio('ws', { now: NOW });
    expect(v.pacing).toBeNull();
  });
});

// ── 1. Spend from a window that is not this month, to date ─────────────────
describe('pacing refuses spend whose window is not month-to-date', () => {
  it.each([
    ['a 90-day cron sync', WINDOWS.LAST_90D],
    ['an all-time Sync button', WINDOWS.MAXIMUM],
    ['the canonical 30-day verdict window', WINDOWS.CANONICAL_30D],
    ['LAST month\'s month-to-date (a stale substitute)', WINDOWS.PRIOR_MONTH_TO_DATE],
  ])('%s is NOT_MEASURABLE, never a run rate', async (_label, window) => {
    io.rows = account(window);
    const v = await getPortfolio('ws', { now: NOW });

    expect(v.pacing, 'no projection may be built from this spend').toBeNull();
    expect(v.channels.every((c) => c.pacing === null)).toBe(true);
    expect(v.spendPeriod?.status).toBe('NOT_MEASURABLE');
    expect(v.spendPeriod?.reason).toBe('WINDOW_MISMATCH');
    // No fake zero, no stale number: the spend for this period is unknown.
    expect(v.spendPeriod?.spendMinor).toBeNull();
  });

  it('the VALUE never decides: a 90-day row holding a healthy MTD-sized spend is still refused', async () => {
    io.rows = [snapshot({ entityId: 'camp-1', window: WINDOWS.LAST_90D, spendMinor: 12_000 })];
    const v = await getPortfolio('ws', { now: NOW });
    expect(v.pacing).toBeNull();
    expect(v.spendPeriod?.reason).toBe('WINDOW_MISMATCH');
  });

  it('Attention raises no over-pacing alarm from a mismatched window', async () => {
    io.rows = account(WINDOWS.LAST_90D);
    const v = await getPortfolio('ws', { now: NOW });
    expect(await attentionPacing(v)).toEqual([]);
  });
});

// ── 2. A window that cannot be established ─────────────────────────────────
describe('pacing refuses spend whose window is unknown', () => {
  it('a row with no declared window, synced INSIDE this month, is not month-to-date', async () => {
    // The sync timestamp is 2026-09-13. Inferring the period from it is the
    // exact inference this slice exists to forbid.
    io.rows = [snapshot({ entityId: 'camp-1', window: null, spendMinor: 12_000 })];
    const v = await getPortfolio('ws', { now: NOW });
    expect(v.pacing).toBeNull();
    expect(v.spendPeriod?.status).toBe('NOT_MEASURABLE');
    expect(v.spendPeriod?.reason).toBe('WINDOW_UNKNOWN');
    expect(v.spendPeriod?.spendMinor).toBeNull();
  });

  it('LEGACY_UNKNOWN provenance is unknown even when its dates look like month-to-date', async () => {
    io.rows = account(WINDOWS.MONTH_TO_DATE, PER_DAY, 'LEGACY_UNKNOWN');
    const v = await getPortfolio('ws', { now: NOW });
    expect(v.pacing).toBeNull();
    expect(v.spendPeriod?.reason).toBe('WINDOW_UNKNOWN');
  });

  it('streams that disagree about their window cannot be summed into one period', async () => {
    io.rows = [
      snapshot({ entityId: 'camp-1', window: WINDOWS.MONTH_TO_DATE, spendMinor: 6_000 }),
      snapshot({ entityId: 'camp-2', window: WINDOWS.LAST_90D, spendMinor: 45_000 }),
    ];
    const v = await getPortfolio('ws', { now: NOW });
    expect(v.pacing).toBeNull();
    // A per-campaign share of a budget is a ratio of spends — meaningless across windows.
    expect(v.channels.every((c) => c.pacing === null)).toBe(true);
    expect(v.spendPeriod?.reason).toBe('MIXED_WINDOWS');
  });

  it('no spend rows at all is not a measurement of zero', async () => {
    io.rows = [];
    const v = await getPortfolio('ws', { now: NOW });
    expect(v.pacing).toBeNull();
    expect(v.spendPeriod?.status).toBe('NOT_MEASURABLE');
    expect(v.spendPeriod?.spendMinor).toBeNull();
  });
});

// ── 3. A genuine month-to-date measurement ─────────────────────────────────
describe('a genuine month-to-date window produces a real comparison', () => {
  it('on-budget spend paces ON_TRACK, at the rate the WINDOW implies', async () => {
    io.rows = account(WINDOWS.MONTH_TO_DATE);
    const v = await getPortfolio('ws', { now: NOW });

    expect(v.spendPeriod?.status).toBe('MEASURABLE');
    expect(v.spendPeriod?.spendMinor).toBe(12_000);
    expect(v.spendPeriod?.window).toEqual({ start: '2026-09-01', end: '2026-09-12' });
    expect(v.spendPeriod?.daysCovered).toBe(12);
    // 12 declared days, not "it is the 13th": the rate comes from the period the
    // spend covers.
    expect(v.pacing?.runRateMinor).toBe(PER_DAY);
    expect(v.pacing?.status).toBe('ON_TRACK');
    expect(await attentionPacing(v)).toEqual([]);
  });

  it('really over-pacing spend is still OVER — and still reaches Attention', async () => {
    io.rows = account(WINDOWS.MONTH_TO_DATE, PER_DAY * 2.4);
    const v = await getPortfolio('ws', { now: NOW });

    expect(v.spendPeriod?.status).toBe('MEASURABLE');
    expect(v.pacing?.status).toBe('OVER');
    expect(v.pacing?.runRateMinor).toBe(2_400);
    const items = await attentionPacing(v);
    expect(items.length, 'a real alarm must not be suppressed').toBeGreaterThan(0);
  });

  it('revenue-only actuals beside the spend rows do not poison the window', async () => {
    io.rows = [
      ...account(WINDOWS.MONTH_TO_DATE),
      snapshot({ entityId: 'camp-1', source: 'GA4', measurementWindow: 'LEGACY_UNKNOWN', window: null, spendMinor: 0, revenueMinor: 50_000 }),
    ];
    const v = await getPortfolio('ws', { now: NOW });
    expect(v.spendPeriod?.status).toBe('MEASURABLE');
    expect(v.pacing?.status).toBe('ON_TRACK');
  });
});
