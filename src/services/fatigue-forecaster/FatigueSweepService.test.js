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
    fatiguePrediction: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    decisionMemoryEntry: { create: vi.fn() }, // resolvePrediction writes the learning row here
    $queryRaw:         vi.fn(),
    $transaction:      vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (ops) => typeof ops === 'function' ? ops(prisma) : Promise.all(ops));
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
  prisma.fatiguePrediction.findMany.mockResolvedValue([]); // default: nothing to resolve
  prisma.fatiguePrediction.deleteMany.mockResolvedValue({ count: 0 });
  prisma.fatiguePrediction.createMany.mockResolvedValue({ count: 0 });
  prisma.$queryRaw.mockResolvedValue([{ id: 'p1' }]);
  prisma.$transaction.mockImplementation(async (ops) => typeof ops === 'function' ? ops(prisma) : Promise.all(ops));
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

describe('sweepFatigue — resolving a now-breached prediction (the learning loop)', () => {
  const ENT = 'b2c3d4e5-0000-0000-0000-000000000002';

  it('resolves an unresolved prediction whose entity crossed the ceiling — scores accuracy + writes FATIGUE_FORECAST memory', async () => {
    // Entity at/above ceiling 3.5 across 05-01..05-02 → actual breach 05-01.
    prisma.metricSnapshot.findMany.mockResolvedValue(dailyFreq(ENT, 'ADSET', [3.5, 3.6]));
    prisma.fatiguePrediction.findMany.mockResolvedValue([
      { id: 'p1', entityId: ENT, entityLevel: 'ADSET', ceiling: 3.5, createdAt: new Date('2026-04-30T00:00:00Z') },
    ]);
    // resolvePrediction re-reads the row, then updates + writes the memory row.
    prisma.fatiguePrediction.findFirst.mockResolvedValue({
      id: 'p1', workspaceId: 'ws-1', entityId: ENT, entityLevel: 'ADSET',
      metric: 'frequency', ceiling: 3.5, projectedBreachDate: new Date('2026-05-02T00:00:00Z'), resolvedAt: null,
    });
    prisma.fatiguePrediction.update.mockResolvedValue({ id: 'p1', resolvedAt: new Date() });
    prisma.decisionMemoryEntry.create.mockResolvedValue({ id: 'm1' });

    const res = await sweepFatigue('ws-1');

    expect(res.resolved).toBe(1);
    // R9 — the re-read is WORKSPACE-SCOPED. resolvePrediction does not just read:
    // it writes a DecisionMemoryEntry stamped with the row's own workspaceId, so
    // an unscoped lookup would file this account's learning under another one.
    expect(prisma.fatiguePrediction.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', workspaceId: 'ws-1' },
    });
    // a real resolution: resolvedAt + a numeric accuracy are written
    expect(prisma.fatiguePrediction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1', workspaceId: 'ws-1' },
      data: expect.objectContaining({ resolvedAt: expect.any(Date), accuracy: expect.any(Number) }),
    }));
    // the learning loop fires: a FATIGUE_FORECAST memory row keyed to the entity
    expect(prisma.decisionMemoryEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionType: 'FATIGUE_FORECAST', entityId: ENT, workspaceId: 'ws-1' }),
    }));
  });

  it('leaves an unbreached prediction unresolved — never a fabricated outcome', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(dailyFreq(ENT, 'ADSET', [2.0, 2.1])); // stays below 3.5
    prisma.fatiguePrediction.findMany.mockResolvedValue([
      { id: 'p2', entityId: ENT, entityLevel: 'ADSET', ceiling: 3.5, createdAt: new Date('2026-04-30T00:00:00Z') },
    ]);
    const res = await sweepFatigue('ws-1');
    expect(res.resolved).toBe(0);
    expect(prisma.fatiguePrediction.update).not.toHaveBeenCalled();
    expect(prisma.decisionMemoryEntry.create).not.toHaveBeenCalled();
  });

  it('skips a prediction whose entity is no longer observable this window', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(dailyFreq('other', 'ADSET', [3.5, 3.6])); // different entity
    prisma.fatiguePrediction.findMany.mockResolvedValue([
      { id: 'p3', entityId: ENT, entityLevel: 'ADSET', ceiling: 3.5, createdAt: new Date('2026-04-30T00:00:00Z') },
    ]);
    const res = await sweepFatigue('ws-1');
    expect(res.resolved).toBe(0);
    expect(prisma.fatiguePrediction.update).not.toHaveBeenCalled();
  });
});
