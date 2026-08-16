// ============================================================
// R8 — the daily identity the shared unique key cannot express
// ============================================================
// MetricSnapshot's unique key carries `date`, the SYNC timestamp, so seven days
// landed by one sync share it and would collide. This sink therefore owns the
// LOGICAL identity of a daily observation:
//
//     (workspaceId, entityId, entityLevel, source, windowStart)  within DAILY
//
// enforced by a read-then-write. These tests pin that identity from every side
// that could collapse it — two days, two entities, two sources — plus the two
// rules that keep the population honest: this sink never mints an entity, and it
// never accepts a row that is not a day.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    campaign:       { findMany: vi.fn() },
    metricSnapshot: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction:   vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma.js';
import { landDailySnapshots, dailyKey, restatementData } from './dailySnapshotSink.js';
import { detId, CHANNEL, DATA_SOURCE, MEASUREMENT_WINDOW } from './connectorTypes.js';

const WS = 'ws-1';
const OBSERVED = new Date('2026-08-16T09:00:00.000Z');
const DAY = (d) => new Date(`2026-08-${d}T00:00:00.000Z`);

// A normalized daily snapshot, as metaDailyNormalize emits it.
const daily = (over = {}) => ({
  externalId: 'c1',
  entityLevel: 'CAMPAIGN',
  parentExternalId: 'act_123',
  name: 'Eid — Cold',
  channel: CHANNEL.META,
  source: DATA_SOURCE.META,
  date: OBSERVED,
  measurementWindow: MEASUREMENT_WINDOW.DAILY,
  windowStart: DAY('10'),
  windowEnd: DAY('10'),
  currency: 'EGP',
  spendMinor: 42050,
  revenueMinor: 210000,
  impressions: 15000,
  clicks: 300,
  conversions: 12,
  reach: null,
  frequency: null,
  actionMetrics: { purchase: 12, purchaseValue: 2100 },
  dailyBudgetMinor: null,
  ...over,
});

const idOf = (externalId) => detId(WS, CHANNEL.META, 'CAMPAIGN', externalId);
const created = () => prisma.metricSnapshot.create.mock.calls.map((c) => c[0].data);
const updated = () => prisma.metricSnapshot.update.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  // Every entity in these fixtures already exists unless a test says otherwise.
  prisma.campaign.findMany.mockImplementation(async ({ where }) => where.id.in.map((id) => ({ id })));
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
  prisma.metricSnapshot.create.mockImplementation((args) => args);
  prisma.metricSnapshot.update.mockImplementation((args) => args);
  prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
});

describe('R8 — one row per entity per day', () => {
  it('creates a row carrying the day it measured and the moment it was observed', async () => {
    const out = await landDailySnapshots(WS, CHANNEL.META, [daily()]);

    expect(out).toEqual({ created: 1, restated: 0, skippedUnknownEntity: 0 });
    const [row] = created();
    expect(row.workspaceId).toBe(WS);
    expect(row.entityId).toBe(idOf('c1'));
    expect(row.measurementWindow).toBe('DAILY');
    expect(row.windowStart).toEqual(DAY('10'));
    expect(row.date).toBe(OBSERVED);
    expect(row.spendMinor).toBe(42050);
  });

  it('keeps three days of one campaign as three rows', async () => {
    // The collision the shared unique key would have caused: one `date`, three
    // periods. If the identity were the schema's, a week would fold into a day.
    await landDailySnapshots(WS, CHANNEL.META, [
      daily({ windowStart: DAY('08'), windowEnd: DAY('08') }),
      daily({ windowStart: DAY('09'), windowEnd: DAY('09') }),
      daily({ windowStart: DAY('10'), windowEnd: DAY('10') }),
    ]);
    expect(created()).toHaveLength(3);
    expect(new Set(created().map((r) => r.windowStart.toISOString())).size).toBe(3);
    expect(new Set(created().map((r) => r.date)).size).toBe(1);
  });

  it('keeps two entities on the same day apart', async () => {
    await landDailySnapshots(WS, CHANNEL.META, [daily(), daily({ externalId: 'c2' })]);
    expect(created()).toHaveLength(2);
    expect(new Set(created().map((r) => r.entityId)).size).toBe(2);
  });

  it('keeps two SOURCES measuring the same entity on the same day apart', async () => {
    // Two platforms measuring one campaign on one day are two measurements, for
    // the same reason Phase F put measurementWindow into the shared key.
    expect(dailyKey({ entityId: 'e', entityLevel: 'CAMPAIGN', source: 'META', windowStart: DAY('10') }))
      .not.toBe(dailyKey({ entityId: 'e', entityLevel: 'CAMPAIGN', source: 'GOOGLE', windowStart: DAY('10') }));
  });

  // ── The identity, tested from the side that can actually collapse ────────
  // A key that dropped a component would not show up above: with no existing
  // rows everything is created either way. It shows up HERE — when a row that
  // should be new finds an existing row it does not belong to and rewrites it.
  describe('a new row never lands on an existing row it does not belong to', () => {
    const existingC1Day10 = () => prisma.metricSnapshot.findMany.mockResolvedValue([{
      id: 'snap-c1-10', entityId: idOf('c1'), entityLevel: 'CAMPAIGN',
      source: DATA_SOURCE.META, windowStart: DAY('10'),
    }]);

    it('a DIFFERENT ENTITY on the same day is created, not restated', async () => {
      existingC1Day10();
      const out = await landDailySnapshots(WS, CHANNEL.META, [daily({ externalId: 'c2' })]);
      expect(out).toMatchObject({ created: 1, restated: 0 });
      expect(created()[0].entityId).toBe(idOf('c2'));
    });

    it('a DIFFERENT DAY for the same entity is created, not restated', async () => {
      existingC1Day10();
      const out = await landDailySnapshots(WS, CHANNEL.META, [
        daily({ windowStart: DAY('11'), windowEnd: DAY('11') }),
      ]);
      expect(out).toMatchObject({ created: 1, restated: 0 });
      expect(created()[0].windowStart).toEqual(DAY('11'));
    });

    it('a DIFFERENT SOURCE measuring the same entity and day is created, not restated', async () => {
      existingC1Day10();
      const out = await landDailySnapshots(WS, CHANNEL.GOOGLE, [
        daily({ source: DATA_SOURCE.GOOGLE, channel: CHANNEL.GOOGLE }),
      ]);
      expect(out).toMatchObject({ created: 1, restated: 0 });
    });
  });

  it('never lands a roster-only row — an entity that did not deliver has no day', async () => {
    // The shared row builder drops these, and the daily path inherits that for
    // free. A campaign with no delivery data must produce "—", never a zero day
    // that a future consumer would sum.
    const out = await landDailySnapshots(WS, CHANNEL.META, [daily({ rosterOnly: true })]);
    expect(out).toEqual({ created: 0, restated: 0, skippedUnknownEntity: 0 });
    expect(prisma.metricSnapshot.create).not.toHaveBeenCalled();
  });

  it('names its projection — the identity read is not a SELECT *', async () => {
    await landDailySnapshots(WS, CHANNEL.META, [daily()]);
    const args = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(args.select).toEqual({
      id: true, entityId: true, entityLevel: true, source: true, windowStart: true,
    });
    expect(args.where.measurementWindow).toBe('DAILY');
    expect(args.where.workspaceId).toBe(WS);
  });

  it('scopes the identity read to this workspace and these days only', async () => {
    await landDailySnapshots(WS, CHANNEL.META, [
      daily({ windowStart: DAY('09'), windowEnd: DAY('09') }),
      daily({ windowStart: DAY('10'), windowEnd: DAY('10') }),
    ]);
    const { where } = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(where.windowStart.in.map((d) => d.toISOString()).sort())
      .toEqual([DAY('09').toISOString(), DAY('10').toISOString()]);
  });
});

describe('R8 — running the same sync twice', () => {
  it('restates the existing day instead of creating a second one', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([{
      id: 'snap-1', entityId: idOf('c1'), entityLevel: 'CAMPAIGN',
      source: DATA_SOURCE.META, windowStart: DAY('10'),
    }]);

    const out = await landDailySnapshots(WS, CHANNEL.META, [daily({ spendMinor: 45000 })]);

    expect(out).toEqual({ created: 0, restated: 1, skippedUnknownEntity: 0 });
    expect(prisma.metricSnapshot.create).not.toHaveBeenCalled();
    expect(updated()[0].where).toEqual({ id: 'snap-1' });
    expect(updated()[0].data.spendMinor).toBe(45000);
  });

  it('advances the observation instant on a restatement, and says so', async () => {
    // Meta revises a day as attribution matures. The row then says what the day
    // is NOW believed to have been, and when we last looked — never a new day.
    const later = new Date('2026-08-17T09:00:00.000Z');
    prisma.metricSnapshot.findMany.mockResolvedValue([{
      id: 'snap-1', entityId: idOf('c1'), entityLevel: 'CAMPAIGN',
      source: DATA_SOURCE.META, windowStart: DAY('10'),
    }]);
    await landDailySnapshots(WS, CHANNEL.META, [daily({ date: later, conversions: 15 })]);
    expect(updated()[0].data.date).toBe(later);
    expect(updated()[0].data.conversions).toBe(15);
  });

  it('never rewrites the identity or the measured day', async () => {
    // A restatement may change what we believe about a day. It may not change
    // WHICH day, which entity, or which population the row belongs to — those
    // are what make it that row.
    const data = restatementData(daily());
    expect(data).not.toHaveProperty('windowStart');
    expect(data).not.toHaveProperty('entityId');
    expect(data).not.toHaveProperty('entityLevel');
    expect(data).not.toHaveProperty('source');
    expect(data).not.toHaveProperty('measurementWindow');
    expect(data).not.toHaveProperty('workspaceId');
  });

  it('writes both halves of a mixed batch in one transaction', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([{
      id: 'snap-1', entityId: idOf('c1'), entityLevel: 'CAMPAIGN',
      source: DATA_SOURCE.META, windowStart: DAY('10'),
    }]);
    const out = await landDailySnapshots(WS, CHANNEL.META, [
      daily(),                                                     // known → restate
      daily({ windowStart: DAY('11'), windowEnd: DAY('11') }),      // new    → create
    ]);
    expect(out).toMatchObject({ created: 1, restated: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('R8 — this sink decorates; it never mints', () => {
  it('drops a daily row for an entity the graph does not contain', async () => {
    // The actualsSink rule. A population that cannot create entities cannot
    // create phantoms — and a campaign that exists only in a daily response is
    // a campaign nothing else in the system has ever seen.
    prisma.campaign.findMany.mockResolvedValue([{ id: idOf('c1') }]);
    const out = await landDailySnapshots(WS, CHANNEL.META, [daily(), daily({ externalId: 'ghost' })]);

    expect(out).toEqual({ created: 1, restated: 0, skippedUnknownEntity: 1 });
    expect(created()).toHaveLength(1);
    expect(created()[0].entityId).toBe(idOf('c1'));
  });

  it('writes nothing at all when no entity is known', async () => {
    prisma.campaign.findMany.mockResolvedValue([]);
    const out = await landDailySnapshots(WS, CHANNEL.META, [daily()]);
    expect(out).toEqual({ created: 0, restated: 0, skippedUnknownEntity: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('touches no entity table — no upsert, no create', async () => {
    await landDailySnapshots(WS, CHANNEL.META, [daily()]);
    expect(prisma.campaign.findMany).toHaveBeenCalledTimes(1); // read only
    expect(prisma.campaign.upsert).toBeUndefined();
  });
});

describe('R8 — what this sink refuses to land', () => {
  it('refuses a ROLLING_WINDOW row — relabelling an aggregate as a day', async () => {
    // The failure with the largest blast radius in this phase: every future
    // consumer of the daily population is entitled to sum it.
    await expect(landDailySnapshots(WS, CHANNEL.META, [
      daily({ measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW }),
    ])).rejects.toThrow(/DAILY population only/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a CUMULATIVE_30D row for the same reason', async () => {
    await expect(landDailySnapshots(WS, CHANNEL.META, [
      daily({ measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D }),
    ])).rejects.toThrow(/DAILY population only/);
  });

  it('refuses a row with no period — it would have no identity and no meaning', async () => {
    await expect(landDailySnapshots(WS, CHANNEL.META, [daily({ windowStart: null })]))
      .rejects.toThrow(/must carry the day it measured/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does nothing, quietly and successfully, for an empty batch', async () => {
    const out = await landDailySnapshots(WS, CHANNEL.META, []);
    expect(out).toEqual({ created: 0, restated: 0, skippedUnknownEntity: 0 });
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
  });

  it('refuses to run without a workspace', async () => {
    await expect(landDailySnapshots('', CHANNEL.META, [daily()])).rejects.toThrow(/workspaceId/);
  });
});
