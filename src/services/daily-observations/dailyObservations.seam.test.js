// ============================================================
// R9 — the seam: rows in the table become a comparable pair, or a refusal
// ============================================================
// The two unit files hold the reader and the contract to their own contracts.
// This one runs the whole chain with nothing mocked but the database client:
//
//     rows as Phase E writes them
//       → readDailyObservations   (the real query, the real classification)
//         → latest-per-day reduction
//           → areComparable        (the real I20 contract)
//             → additiveDifference (the real family rules)
//               → the exact rows consumed
//
// Nothing here hand-types a provenance literal for the reader to agree with: the
// refs are read back out of the same rows the fixtures put in, which is what
// makes "these are the rows it used" a claim rather than a restatement.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { metricSnapshot: { findMany: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import { readDailyObservations, OBSERVATION_STATUS } from './dailyObservationReader.js';
import { additiveDifference, areComparable, COMPARABILITY } from './observationComparability.js';

const WS = 'ws-1';
const ENTITY = 'e1';
const DAY = (d) => new Date(`2026-08-${d}T00:00:00.000Z`);
const EXECUTED_AT = new Date('2026-08-10T14:20:00.000Z');

/**
 * A row exactly as the Phase E sink writes one: `date` is the sync instant,
 * windowStart === windowEnd is the platform's own day, reach and frequency are
 * null because a daily observation does not carry them.
 */
const stored = (day, over = {}) => ({
  id: `snap-${day}`,
  workspaceId: WS,
  entityId: ENTITY,
  entityLevel: 'CAMPAIGN',
  source: 'META',
  measurementWindow: 'DAILY',
  date: new Date('2026-08-13T09:00:00.000Z'),
  windowStart: DAY(day),
  windowEnd: DAY(day),
  spendMinor: 40000,
  revenueMinor: 200000,
  impressions: 12000,
  clicks: 240,
  conversions: 10,
  ctr: 0.02,
  roas: 5,
  reach: null,
  frequency: null,
  currency: 'EGP',
  ...over,
});

const read = (over = {}) => readDailyObservations(WS, {
  entityId: ENTITY, entityLevel: 'CAMPAIGN', source: 'META', executedAt: EXECUTED_AT, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
});

describe('R9 seam — stored rows to a comparable pair', () => {
  it('reads, reduces, compares and names the two rows it used', async () => {
    const rows = [
      stored('08', { spendMinor: 30000 }),
      stored('09', { spendMinor: 40000, clicks: 240, conversions: 10 }),   // the day before
      stored('11', { spendMinor: 12000, clicks: 90, conversions: 3 }),     // the day after
      stored('12', { spendMinor: 11000 }),
    ];
    prisma.metricSnapshot.findMany.mockResolvedValue(rows);

    const res = await read();

    expect(res.status).toBe(OBSERVATION_STATUS.MEASURABLE);
    expect(res.pair.before.day).toBe('2026-08-09');
    expect(res.pair.after.day).toBe('2026-08-11');
    expect(res.pair.comparable).toBe(true);

    // The rows it used, read back out of the fixtures rather than retyped.
    const usedIds = [res.pair.before.id, res.pair.after.id];
    expect(usedIds).toEqual(['snap-09', 'snap-11']);
    for (const id of usedIds) {
      const source = rows.find((r) => r.id === id);
      const observation = [...res.before, ...res.after].find((o) => o.id === id);
      expect(observation.windowStart).toBe(source.windowStart);
      expect(observation.observedAt).toBe(source.date);
      expect(observation.spendMinor).toBe(source.spendMinor);
    }
    // …and every observation it exposed is named in refs, so the read is
    // reproducible from the result alone.
    expect(res.refs.map((r) => r.id).sort())
      .toEqual([...res.before, ...res.after].map((o) => o.id).sort());
  });

  it('hands the pair to the difference, which respects the metric families', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([
      stored('09', { spendMinor: 40000, revenueMinor: 200000, impressions: 12000, clicks: 240, conversions: 10 }),
      stored('11', { spendMinor: 12000, revenueMinor: 30000, impressions: 4000, clicks: 90, conversions: 3 }),
    ]);

    const { pair } = await read();
    const diff = additiveDifference(pair.before, pair.after);

    expect(diff.ok).toBe(true);
    expect(diff.metrics).toEqual({
      spendMinor: -28000,
      revenueMinor: -170000,
      impressions: -8000,
      clicks: -150,
      conversions: -7,
    });
    // The two families that must never appear in a cross-day difference.
    expect(Object.keys(diff.metrics)).not.toContain('reach');
    expect(Object.keys(diff.metrics)).not.toContain('frequency');
    expect(Object.keys(diff.metrics)).not.toContain('roas');
  });

  it('says nothing about what the difference means', async () => {
    // Spend fell to a third and revenue collapsed with it — which is either a
    // successful KILL or a disaster, and this layer is not the one that knows.
    prisma.metricSnapshot.findMany.mockResolvedValue([stored('09'), stored('11', { spendMinor: 1000, revenueMinor: 0, roas: null })]);
    const res = await read();
    const diff = additiveDifference(res.pair.before, res.pair.after);
    const json = JSON.stringify({ res, diff });
    for (const word of ['outcome', 'success', 'improved', 'worsened', 'correct', 'sustained', 'caused']) {
      expect(json).not.toContain(word);
    }
  });
});

describe('R9 seam — the refusals a real table can produce', () => {
  it('refuses when the only pre-execution row is the day of the execution itself', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([stored('10'), stored('11')]);
    const res = await read();
    expect(res.status).toBe(OBSERVATION_STATUS.NOT_OBSERVED);
    expect(res.pair.reason).toBe(COMPARABILITY.MISSING_OBSERVATION);
    expect(res.excluded).toEqual([{ id: 'snap-10', reason: 'CROSSES_BOUNDARY' }]);
  });

  it('refuses a trailing aggregate that somehow carries the DAILY label', async () => {
    // A producer bug rather than a query bug: the row says DAILY and its dates say
    // three days. The label alone never makes a row a day.
    prisma.metricSnapshot.findMany.mockResolvedValue([
      stored('09'), stored('11', { windowEnd: DAY('13') }),
    ]);
    const res = await read();
    expect(res.after).toEqual([]);
    expect(res.excluded).toEqual([{ id: 'snap-11', reason: 'MALFORMED_PERIOD' }]);
    expect(res.status).toBe(OBSERVATION_STATUS.NOT_OBSERVED);
  });

  it('refuses a day whose duplicate readings disagree at the same instant', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([
      stored('09'),
      stored('11', { id: 'a', spendMinor: 12000 }),
      stored('11', { id: 'b', spendMinor: 90000 }),
    ]);
    const res = await read();
    expect(res.status).toBe(OBSERVATION_STATUS.AMBIGUOUS);
    expect(res.pair.reason).toBe(COMPARABILITY.AMBIGUOUS_OBSERVATION);
    expect(additiveDifference(res.pair.before, res.pair.after).ok).toBe(false);
  });

  it('takes the newest reading when a day was restated, and the arithmetic follows it', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([
      stored('09', { spendMinor: 40000 }),
      stored('11', { id: 'first', date: new Date('2026-08-12T09:00:00Z'), spendMinor: 9000, conversions: 1 }),
      stored('11', { id: 'restated', date: new Date('2026-08-16T09:00:00Z'), spendMinor: 9000, conversions: 4 }),
    ]);
    const res = await read();
    expect(res.pair.after.id).toBe('restated');
    expect(additiveDifference(res.pair.before, res.pair.after).metrics.conversions).toBe(-6);
  });

  it('a caller pairing its own observations gets the same contract', async () => {
    // The reader answers for the adjacent pair; any other pairing is the
    // caller's, and it must go through the same gate rather than around it.
    prisma.metricSnapshot.findMany.mockResolvedValue([stored('08'), stored('09'), stored('11'), stored('12')]);
    const res = await read();

    expect(areComparable(res.before[0], res.after[1]).ok).toBe(true);   // 08 → 12, still fine
    expect(areComparable(res.after[1], res.before[0]).reason).toBe(COMPARABILITY.WRONG_ORDER);
    expect(areComparable(res.before[0], res.before[0]).reason).toBe(COMPARABILITY.OVERLAPPING_PERIODS);
  });
});
