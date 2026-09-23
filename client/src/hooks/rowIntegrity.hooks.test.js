// ============================================================
// Tier 2b · the three ordinary-list hooks stop dropping rows
// ------------------------------------------------------------
// One file for three hooks because the defect and the ruling are one:
//
//     useGoals   usePlans   useTests
//
// each built `Array.isArray(res.data?.X) ? … : []` and then kept only the rows
// that parsed. A dropped row survived nowhere: the list was shorter than the
// truth while claiming to be complete, and a wholly unreadable collection
// rendered an empty state — "No goals set yet", "No plans yet", "No experiments
// yet". `useTests` called it "honest seam, resilient to one bad row".
//
// RULING (Omar): an unreadable row is never equivalent to an absent row.
// Ordinary lists PRESERVE + MARK; the mechanism is lib/rowIntegrity.js, proved
// on its own in lib/rowIntegrity.test.js. This proves each hook uses it, and
// that `X` (readable-only) never gains a marker — a false presence would be
// worse than the false absence it replaces.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api.js';
import { useGoals } from './useGoals.js';
import { usePlans } from './usePlans.js';
import { useTests } from './useTests.js';
import { ROW } from '@/lib/rowIntegrity.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const goal = (over = {}) => ({
  id: 'g1', workspaceId: 'w1', name: 'Cut CAC', metric: 'CAC', comparator: 'LTE',
  targetValue: 40, currency: 'USD', periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-09-30T00:00:00.000Z', status: 'ON_TRACK', ...over,
});
const plan = (over = {}) => ({
  id: 'p1', workspaceId: 'w1', name: 'Q3 plan',
  periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-09-30T00:00:00.000Z',
  totalBudgetMinor: 5000000, currency: 'USD', status: 'DRAFT',
  channelMix: [], testingAgenda: [],
  projections: { scenario: null, economics: null, goalLanding: null },
  memoryBasis: [],
  ...over,
});
const experiment = (over = {}) => ({
  id: 't1', workspaceId: 'w1', dimension: 'HOOK', hypothesis: 'Hook A beats B',
  metric: 'CTR', expectedSignal: 'CTR up 10%', status: 'RUNNING', ...over,
});

const run = async (hook, data, settle) => {
  api.get.mockResolvedValue({ data });
  const { result } = renderHook(hook);
  await waitFor(() => expect(settle(result.current)).toBe(false));
  return result;
};

const CASES = [
  {
    label: 'useGoals', hook: useGoals, collection: 'goals', rowsKey: 'goalRows',
    row: goal, settle: (c) => c.isLoading,
  },
  {
    label: 'usePlans', hook: usePlans, collection: 'plans', rowsKey: 'planRows',
    row: plan, settle: (c) => c.isLoading,
  },
  {
    label: 'useTests', hook: useTests, collection: 'experiments', rowsKey: 'experimentRows',
    row: experiment, settle: (c) => c.loading,
  },
];

describe.each(CASES)('$label · an unreadable row keeps its place', (c) => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves the row IN POSITION rather than closing the gap', async () => {
    const rows = [c.row({ id: 'a' }), { broken: true }, c.row({ id: 'c' })];
    const r = await run(c.hook, { [c.collection]: rows }, c.settle);
    expect(r.current[c.rowsKey].map((e) => e.state))
      .toEqual([ROW.READABLE, ROW.UNREADABLE, ROW.READABLE]);
    expect(r.current[c.rowsKey].map((e) => e.index)).toEqual([0, 1, 2]);
  });

  it('a wholly unreadable collection is NOT an empty one', async () => {
    const r = await run(c.hook, { [c.collection]: [{ broken: true }, { alsoBroken: true }] }, c.settle);
    expect(r.current[c.rowsKey]).toHaveLength(2);
    expect(r.current[c.rowsKey].every((e) => e.state === ROW.UNREADABLE)).toBe(true);
  });

  it('the readable collection never gains a marker', async () => {
    // A marker counted as a goal, a plan or an experiment would be a false
    // PRESENCE — the worse trade.
    const r = await run(c.hook, { [c.collection]: [c.row({ id: 'a' }), { broken: true }] }, c.settle);
    expect(r.current[c.collection]).toHaveLength(1);
    expect(r.current[c.collection][0].id).toBe('a');
  });

  it('a MISSING collection is an error, not an empty list', async () => {
    const r = await run(c.hook, { workspaceId: 'w1' }, c.settle);
    expect(r.current.error).toBeTruthy();
    expect(r.current.error.message).toMatch(/contract validation/i);
    expect(r.current[c.rowsKey]).toEqual([]);
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('a genuinely empty collection is empty, with no error and nothing marked', async () => {
    const r = await run(c.hook, { [c.collection]: [] }, c.settle);
    expect(r.current.error).toBeNull();
    expect(r.current[c.rowsKey]).toEqual([]);
    expect(r.current[c.collection]).toEqual([]);
  });

  it('…and valid rows still arrive intact', async () => {
    const r = await run(c.hook, { [c.collection]: [c.row({ id: 'a' })] }, c.settle);
    expect(r.current.error).toBeNull();
    expect(r.current[c.collection]).toHaveLength(1);
    expect(r.current[c.rowsKey][0].state).toBe(ROW.READABLE);
  });
});
