// ============================================================
// FatigueSweepService — the write organ's correctness gate
// ============================================================
// The sweep is a WRITE into a system with four live readers (feed, Growth
// board, agentic planner, resolution). A wrong entityId namespace or bad
// series math fails SILENTLY as real-looking predictions, so this gate proves:
//   1. entityId is the exact MetricSnapshot entity-graph UUID (the join seam).
//   2. the series→projection math is right against a KNOWN rising campaign
//      (the real forecaster runs — only the DB is mocked).
//   3. a flat/declining entity yields NO row (never a fabricated breach).
//   4. idempotent reconcile: unresolved predictions are replaced in one txn.
//   5. day-dedup + finite-frequency filtering build a clean series.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => {
  const prisma = {
    metricSnapshot:    { findMany: vi.fn() },
    fatiguePrediction: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction:      vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
  return { prisma };
});

import { prisma } from '../../lib/prisma.js';
import { sweepFatigue, buildEntitySeries } from './FatigueSweepService.js';

const DAY = 86_400_000;
function snap(entityId, entityLevel, date, frequency, ctr) {
  return { entityId, entityLevel, date: new Date(date), frequency, ctr };
}
function dailyFreq(entityId, level, freqs, start = '2026-05-01T00:00:00Z', ctrs = null) {
  return freqs.map((f, i) =>
    snap(entityId, level, new Date(Date.parse(start) + i * DAY).toISOString(), f, ctrs ? ctrs[i] : undefined));
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.fatiguePrediction.deleteMany.mockResolvedValue({ count: 0 });
  prisma.fatiguePrediction.createMany.mockResolvedValue({ count: 0 });
  prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
});

describe('buildEntitySeries — clean per-entity series', () => {
  it('dedupes multiple snapshots on the same day (last write wins)', () => {
    const out = buildEntitySeries([
      snap('e', 'ADSET', '2026-05-01T01:00:00Z', 2.0),
      snap('e', 'ADSET', '2026-05-01T20:00:00Z', 2.2), // same day, later
      snap('e', 'ADSET', '2026-05-02T10:00:00Z', 2.5),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].series).toHaveLength(2);        // 2 days, not 3
    expect(out[0].series[0].frequency).toBe(2.2); // last-of-day
  });
  it('filters non-finite / negative frequency points', () => {
    const out = buildEntitySeries([
      snap('e', 'ADSET', '2026-05-01', 2.0),
      snap('e', 'ADSET', '2026-05-02', null),
      snap('e', 'ADSET', '2026-05-03', -1),
      snap('e', 'ADSET', '2026-05-04', 2.6),
    ]);
    expect(out[0].series).toHaveLength(2);
  });
  it('separates groups by entityId AND entityLevel', () => {
    const out = buildEntitySeries([
      ...dailyFreq('e', 'CAMPAIGN', [2.0, 2.3]),
      ...dailyFreq('e', 'ADSET', [1.0, 1.2]),
    ]);
    expect(out).toHaveLength(2);
  });
  it('drops an entity with fewer than 2 distinct days', () => {
    expect(buildEntitySeries([snap('e', 'ADSET', '2026-05-01', 2.0)])).toHaveLength(0);
  });
});

describe('sweepFatigue — correctness against a known rising entity', () => {
  const ENT = 'a1b2c3d4-0000-0000-0000-000000000001'; // an entity-graph UUID

  it('writes ONE prediction whose entityId is the exact snapshot UUID (the join seam)', async () => {
    // 2.0→2.3→2.6→2.9 (+0.3/day), ceiling 3.5 → breach ~2 days after 2026-05-04.
    prisma.metricSnapshot.findMany.mockResolvedValue(dailyFreq(ENT, 'ADSET', [2.0, 2.3, 2.6, 2.9]));

    const res = await sweepFatigue('ws-1');

    expect(prisma.fatiguePrediction.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.fatiguePrediction.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    // 1. namespace preserved — entityId is the snapshot's UUID, not a remapped/guessed id
    expect(rows[0].entityId).toBe(ENT);
    expect(rows[0].entityLevel).toBe('ADSET');
    expect(rows[0].workspaceId).toBe('ws-1');
    expect(rows[0].metric).toBe('frequency');
    // 2. math: a real forward projection ~2 days past the last snapshot (05-04)
    const breach = new Date(rows[0].projectedBreachDate).getTime();
    expect(breach).toBeGreaterThan(Date.parse('2026-05-05'));
    expect(breach).toBeLessThan(Date.parse('2026-05-08'));
    expect(rows[0].confidence).toBeGreaterThan(0.8); // near-perfect linear fit
    expect(res.written).toBe(1);
  });

  it('replaces unresolved predictions in one transaction (idempotent reconcile)', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(dailyFreq(ENT, 'ADSET', [2.0, 2.3, 2.6, 2.9]));
    await sweepFatigue('ws-1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.fatiguePrediction.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', resolvedAt: null },
    });
  });
});

describe('sweepFatigue — honesty + safety', () => {
  it('writes NO row for a flat/declining entity (no fabricated breach), but clears stale', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(dailyFreq('flat', 'ADSET', [1.5, 1.4, 1.5, 1.3]));
    const res = await sweepFatigue('ws-1');
    expect(prisma.fatiguePrediction.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', resolvedAt: null },
    });
    expect(prisma.fatiguePrediction.createMany).not.toHaveBeenCalled();
    expect(res.breaching).toBe(0);
  });

  it('a cold read (no snapshots) touches nothing — never wipes on a transient empty', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    const res = await sweepFatigue('ws-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.fatiguePrediction.deleteMany).not.toHaveBeenCalled();
    expect(res.scanned).toBe(0);
  });

  it('skips entities with fewer than 2 daily points (forecaster needs a trend)', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([
      snap('e1', 'ADSET', '2026-05-01', 2.0),
      snap('e2', 'ADSET', '2026-05-01', 3.0),
    ]);
    const res = await sweepFatigue('ws-1');
    expect(res.forecastable).toBe(0);
    expect(prisma.fatiguePrediction.createMany).not.toHaveBeenCalled();
  });

  it('throws without a workspaceId', async () => {
    await expect(sweepFatigue()).rejects.toThrow('workspaceId required');
  });
});
