// ============================================================
// B4-E5 — DAILY observations persist, against a REAL PostgreSQL
// ============================================================
// The proof this whole track exists for, driven through the real chain:
//
//     Meta-shaped daily insights
//        → metaDailyNormalize      (the real normalizer)
//        → landDailySnapshots      (the real sink)
//        → Prisma                  (no mock anywhere in it)
//        → PostgreSQL
//
// Prisma is deliberately not mocked. B4-E2 measured that a three-day batch
// raised P2002 and rolled back ALL THREE rows — while three green unit tests
// asserted the sink's behaviour, because a mock cannot hold a unique index. A
// mocked version of this suite would pass just as happily on the day the
// migration is reverted.
//
// Skips when no migrated database is reachable (src/tests/dbProbe.js).
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { metaDailyNormalize } from './normalize/metaDailyNormalize.js';
import { landDailySnapshots } from './dailySnapshotSink.js';
import { landSnapshots } from './snapshotSink.js';
import { upsertNonDailyMetricSnapshot } from './nonDailySnapshotWrite.js';
import { CHANNEL, MEASUREMENT_WINDOW, detId } from './connectorTypes.js';
import { readDailyObservations, ROW_REJECTION } from '../daily-observations/dailyObservationReader.js';

const DB_OK = await dbAvailable();

const WS = '00000000-0000-4000-8000-0000b4e50101';
const ACCOUNT_EXT = 'act_b4e5';
const CAMPAIGN_EXT = 'c_b4e5_1';
const CAMPAIGN_ID = detId(WS, CHANNEL.META, 'CAMPAIGN', CAMPAIGN_EXT);

/** One sync instant, shared by every row it produces. That sharing IS the bug. */
const SYNC_1 = new Date('2026-08-24T05:00:00.000Z');
const SYNC_2 = new Date('2026-08-25T05:00:00.000Z');

const DAYS = ['2026-08-20', '2026-08-21', '2026-08-22'];

/** A raw Meta daily insight, in the shape /insights returns under time_increment=1. */
const rawDay = (day, over = {}) => ({
  campaign_id: CAMPAIGN_EXT,
  campaign_name: 'Eid Retargeting',
  date_start: day,
  date_stop: day,
  spend: '310.50',
  impressions: '12000',
  clicks: '340',
  actions: [{ action_type: 'omni_purchase', value: '7' }],
  action_values: [{ action_type: 'omni_purchase', value: '2100.00' }],
  ...over,
});

/** The real normalizer, on a real-shaped payload. */
const normalizeDays = (days, date = SYNC_1, over = () => ({})) => metaDailyNormalize({
  accountExternalId: ACCOUNT_EXT, currency: 'EGP', date,
  rows: days.map((d, i) => rawDay(d, over(d, i))),
});

const dailyRows = () => prisma.metricSnapshot.findMany({
  where: { workspaceId: WS, measurementWindow: MEASUREMENT_WINDOW.DAILY },
  orderBy: { windowStart: 'asc' },
});
const nonDailyRows = () => prisma.metricSnapshot.findMany({
  where: { workspaceId: WS, measurementWindow: { not: MEASUREMENT_WINDOW.DAILY } },
  orderBy: [{ source: 'asc' }, { measurementWindow: 'asc' }],
});
const day = (r) => r.windowStart.toISOString().slice(0, 10);

/** Mint the entity graph the way a real sync does: the operational sink runs
 *  first, and the daily sink only ever DECORATES entities that already exist. */
async function seedGraph() {
  await landSnapshots(WS, CHANNEL.META, [
    {
      externalId: ACCOUNT_EXT, entityLevel: 'ACCOUNT', name: 'B4E5 Account',
      channel: CHANNEL.META, source: 'META', date: SYNC_1,
      measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
      currency: 'EGP', spendMinor: 100000, revenueMinor: 300000,
    },
    {
      externalId: CAMPAIGN_EXT, entityLevel: 'CAMPAIGN', parentExternalId: ACCOUNT_EXT,
      name: 'Eid Retargeting', channel: CHANNEL.META, source: 'META', date: SYNC_1,
      measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
      currency: 'EGP', spendMinor: 100000, revenueMinor: 300000,
    },
  ]);
}

async function wipe() {
  await prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } });
  await prisma.campaign.deleteMany({ where: { workspaceId: WS } });
  await prisma.account.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspace.deleteMany({ where: { id: WS } });
}

describe.skipIf(!DB_OK)('B4-E5 · DAILY observations persist, on real PostgreSQL', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.workspace.create({ data: { id: WS, name: 'b4e5-daily' } });
    await seedGraph();
  });
  afterAll(wipe);
  beforeEach(() => prisma.metricSnapshot.deleteMany({
    where: { workspaceId: WS, measurementWindow: MEASUREMENT_WINDOW.DAILY },
  }));

  // ── E5-T3 · the headline ──────────────────────────────────────────────────
  describe('E5-T3 · three days from one sync', () => {
    it('normalizes to three rows carrying three distinct periods', () => {
      const { snapshots, rejected } = normalizeDays(DAYS);
      expect(rejected).toEqual([]);
      expect(snapshots).toHaveLength(3);
      expect(new Set(snapshots.map((s) => s.windowStart.toISOString())).size).toBe(3);
      // The premise of the whole defect: ONE observation instant across all three.
      expect(new Set(snapshots.map((s) => s.date.getTime())).size).toBe(1);
    });

    it('lands all three, and PostgreSQL keeps them apart', async () => {
      const { snapshots } = normalizeDays(DAYS);

      const result = await landDailySnapshots(WS, CHANNEL.META, snapshots);
      expect(result).toMatchObject({ created: 3, restated: 0, skippedUnknownEntity: 0 });

      const rows = await dailyRows();
      expect(rows).toHaveLength(3);
      expect(rows.map(day)).toEqual(DAYS);
      // Every row still carries the sync instant it was observed at. The days are
      // separated by `windowStart`, which is what a day actually is.
      expect(new Set(rows.map((r) => r.date.getTime())).size).toBe(1);
      expect(rows.every((r) => r.entityId === CAMPAIGN_ID)).toBe(true);
    });

    it('keeps each day\'s own measurements — not one day repeated', async () => {
      const { snapshots } = normalizeDays(DAYS, SYNC_1,
        (d, i) => ({ spend: `${100 + i}`, impressions: `${1000 + i}`, clicks: `${10 + i}` }));
      await landDailySnapshots(WS, CHANNEL.META, snapshots);

      const rows = await dailyRows();
      expect(rows.map((r) => r.spendMinor)).toEqual([10000, 10100, 10200]);
      expect(rows.map((r) => r.impressions)).toEqual([1000, 1001, 1002]);
      expect(rows.map((r) => r.clicks)).toEqual([10, 11, 12]);
    });
  });

  // ── E5-T4 · what a repeat sync means ──────────────────────────────────────
  // Determined by reading the sink, not assumed: landDailySnapshots resolves
  // (workspaceId, entityId, entityLevel, source, windowStart) by a read-then-
  // write, so a re-observed day is RESTATED — Meta revises a day after the fact.
  // It is idempotent by hand, not append-only, so id stability is the invariant.
  describe('E5-T4 · re-observing the same days', () => {
    beforeEach(async () => {
      await landDailySnapshots(WS, CHANNEL.META, normalizeDays(DAYS).snapshots);
    });

    it('creates nothing and restates everything', async () => {
      const before = await dailyRows();
      const result = await landDailySnapshots(WS, CHANNEL.META, normalizeDays(DAYS, SYNC_2).snapshots);

      expect(result).toMatchObject({ created: 0, restated: 3, skippedUnknownEntity: 0 });
      const after = await dailyRows();
      expect(after).toHaveLength(3);                                  // no duplicate observations
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id)); // the same three rows
      expect(after.map(day)).toEqual(DAYS);
    });

    it('advances the observation instant and takes the revised numbers', async () => {
      await landDailySnapshots(WS, CHANNEL.META,
        normalizeDays(DAYS, SYNC_2, () => ({ spend: '999.00' })).snapshots);

      const rows = await dailyRows();
      expect(rows.map((r) => r.date.toISOString())).toEqual(Array(3).fill(SYNC_2.toISOString()));
      expect(rows.map((r) => r.spendMinor)).toEqual([99900, 99900, 99900]);
      // Identity is never restated — the day a row measures cannot change.
      expect(rows.map(day)).toEqual(DAYS);
    });

    it('a fourth day arriving later is created, not folded into the others', async () => {
      const result = await landDailySnapshots(WS, CHANNEL.META,
        normalizeDays([...DAYS, '2026-08-23'], SYNC_2).snapshots);

      expect(result).toMatchObject({ created: 1, restated: 3 });
      expect((await dailyRows()).map(day)).toEqual([...DAYS, '2026-08-23']);
    });
  });

  // ── E5-T10 · the batch is still one transaction ───────────────────────────
  it('E5-T10 · one bad row in a daily batch persists none of it', async () => {
    const { snapshots } = normalizeDays(DAYS);
    // 3_000_000_000 minor units overflows int4 at the column, so the failure is
    // PostgreSQL's and lands mid-batch — the shape a real bad row takes.
    snapshots[2].spendMinor = 3_000_000_000;

    await expect(landDailySnapshots(WS, CHANNEL.META, snapshots)).rejects.toThrow();
    expect(await dailyRows()).toHaveLength(0);
  });

  // ── E5-T9 · the two populations do not participate in each other ──────────
  describe('E5-T9 · DAILY and non-DAILY isolation', () => {
    const nonDaily = (over = {}) => ({
      workspaceId: WS, entityId: CAMPAIGN_ID, entityLevel: 'CAMPAIGN', date: SYNC_1,
      source: 'META', granularity: 'DAILY', measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
      windowStart: null, windowEnd: null, spendMinor: 5000, revenueMinor: 15000,
      impressions: 100, clicks: 10, conversions: 1, currency: 'EGP', ...over,
    });

    beforeEach(async () => {
      await prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } });
      await prisma.$transaction([
        upsertNonDailyMetricSnapshot(prisma, nonDaily()),
        upsertNonDailyMetricSnapshot(prisma, nonDaily({ measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D, windowStart: new Date('2026-07-26T00:00:00Z') })),
        upsertNonDailyMetricSnapshot(prisma, nonDaily({ source: 'GA4', measurementWindow: MEASUREMENT_WINDOW.LEGACY_UNKNOWN })),
      ]);
      await landDailySnapshots(WS, CHANNEL.META, normalizeDays(DAYS).snapshots);
    });

    it('starts from a genuinely mixed population', async () => {
      expect(await dailyRows()).toHaveLength(3);
      expect(await nonDailyRows()).toHaveLength(3);
    });

    it('a non-DAILY write leaves every DAILY row untouched', async () => {
      const before = await dailyRows();
      await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, nonDaily({ spendMinor: 77777 }))]);

      expect(await dailyRows()).toEqual(before);
      const rolling = (await nonDailyRows()).find((r) => r.measurementWindow === 'ROLLING_WINDOW' && r.source === 'META');
      expect(rolling.spendMinor).toBe(77777);      // updated, not duplicated
      expect(await nonDailyRows()).toHaveLength(3);
    });

    it('a DAILY write leaves every non-DAILY row untouched', async () => {
      const before = await nonDailyRows();
      await landDailySnapshots(WS, CHANNEL.META,
        normalizeDays(['2026-08-23'], SYNC_2, () => ({ spend: '1.00' })).snapshots);

      expect(await nonDailyRows()).toEqual(before);
      expect(await dailyRows()).toHaveLength(4);
    });

    it('a DAILY row and a non-DAILY row may share every identity column', async () => {
      // The precise thing the full-table index forbade. Same entity, same level,
      // same source, same granularity, same sync instant — separated only by the
      // window, which the partial index no longer arbitrates.
      await prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } });
      await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, nonDaily({ date: SYNC_1 }))]);
      await landDailySnapshots(WS, CHANNEL.META, normalizeDays(['2026-08-20'], SYNC_1).snapshots);

      const all = await prisma.metricSnapshot.findMany({ where: { workspaceId: WS, date: SYNC_1 } });
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.measurementWindow).sort()).toEqual(['DAILY', 'ROLLING_WINDOW']);
    });
  });

  // ── E5-T11 · the reader still reads what it read before ───────────────────
  describe('E5-T11 · dailyObservationReader over the migrated topology', () => {
    // Six days, one gap. The boundary sits INSIDE 2026-08-23, so that day
    // straddles it and must be excluded rather than assigned to a side.
    const SPAN = ['2026-08-20', '2026-08-21', '2026-08-23', '2026-08-25', '2026-08-26'];
    const BOUNDARY = new Date('2026-08-23T13:00:00.000Z');

    const read = () => readDailyObservations(WS, {
      entityId: CAMPAIGN_ID, entityLevel: 'CAMPAIGN', source: 'META',
      interventionAt: BOUNDARY, beforeDays: 3, afterDays: 3,
    });

    beforeEach(async () => {
      await landDailySnapshots(WS, CHANNEL.META,
        normalizeDays(SPAN, SYNC_1, (d, i) => ({ spend: `${10 + i}` })).snapshots);
    });

    it('keeps the distinct days distinct', async () => {
      const out = await read();
      expect(out.rowCount).toBe(5);
      expect(out.before.map((o) => o.day)).toEqual(['2026-08-20', '2026-08-21']);
      expect(out.after.map((o) => o.day)).toEqual(['2026-08-25', '2026-08-26']);
    });

    it('still excludes the day that straddles the boundary', async () => {
      const out = await read();
      // Excluded rows are reported as { id, reason } — by name, never silently.
      expect(out.excluded.map((e) => e.reason)).toEqual([ROW_REJECTION.CROSSES_BOUNDARY]);
      expect([...out.before, ...out.after].map((o) => o.day)).not.toContain('2026-08-23');
    });

    it('still reports the unobserved days as absent, never as zero', async () => {
      const out = await read();
      expect(out.notObserved.after).toContain('2026-08-24');
      expect(out.after.map((o) => o.day)).not.toContain('2026-08-24');
    });

    it('a restated day is read at its latest reading, and stays one day', async () => {
      await landDailySnapshots(WS, CHANNEL.META,
        normalizeDays(['2026-08-21'], SYNC_2, () => ({ spend: '500.00' })).snapshots);

      const out = await read();
      expect(out.before.map((o) => o.day)).toEqual(['2026-08-20', '2026-08-21']);
      const restated = out.before.find((o) => o.day === '2026-08-21');
      expect(restated.spendMinor).toBe(50000);
      expect(out.rowCount).toBe(5); // restated in place — not a sixth row
    });
  });
});
