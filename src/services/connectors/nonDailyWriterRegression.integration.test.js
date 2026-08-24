// ============================================================
// B4-E5 — the three non-DAILY writers, after the identity became partial
// ============================================================
// B4-E4 proved these three write correctly through `upsertNonDailyMetricSnapshot`
// against the FULL index that shipped at the time. That proof does not carry
// over on its own: a full unique index satisfies a predicated ON CONFLICT
// trivially, so every one of those tests would have passed even if the predicate
// were wrong. The predicate only has to be RIGHT once the index is partial —
// which is now.
//
// So this suite runs the real writers — not the helper — end to end against the
// migrated topology:
//
//     landSnapshots      (snapshotSink       · META, ROLLING_WINDOW + CUMULATIVE_30D)
//     landActuals        (actualsSink        · GA4,  LEGACY_UNKNOWN)
//     processRevenueCsv  (RevenueCsvService  · MANUAL, LEGACY_UNKNOWN)
//
// Each gets the same five questions: insert, retry, update, null period, and
// whether a bad row still takes its whole batch down with it.
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { landSnapshots } from './snapshotSink.js';
import { landActuals } from './actualsSink.js';
import { processRevenueCsv } from '../revenue/RevenueCsvService.js';
import { upsertNonDailyMetricSnapshot } from './nonDailySnapshotWrite.js';
import { CHANNEL, MEASUREMENT_WINDOW, detId } from './connectorTypes.js';

const DB_OK = await dbAvailable();

const WS = '00000000-0000-4000-8000-0000b4e50201';
const ACCOUNT_EXT = 'act_e5reg';
const CAMPAIGN_EXT = 'c_e5reg_1';
const CAMPAIGN_NAME = 'Ramadan Prospecting';
const CAMPAIGN_ID = detId(WS, CHANNEL.META, 'CAMPAIGN', CAMPAIGN_EXT);
const SYNC = new Date('2026-08-24T09:00:00.000Z');

/** A normalized descriptor, as a connector normalizer hands it to landSnapshots. */
const norm = (over = {}) => ({
  externalId: CAMPAIGN_EXT, entityLevel: 'CAMPAIGN', parentExternalId: ACCOUNT_EXT,
  name: CAMPAIGN_NAME, channel: CHANNEL.META, source: 'META', date: SYNC,
  measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW, windowStart: null, windowEnd: null,
  currency: 'EGP', spendMinor: 120000, revenueMinor: 480000,
  impressions: 90000, clicks: 2100, conversions: 24, ...over,
});
const account = (over = {}) => norm({
  externalId: ACCOUNT_EXT, entityLevel: 'ACCOUNT', parentExternalId: undefined,
  name: 'E5 Regression Account', ...over,
});

/** A GA4 actuals descriptor, as the actuals connector produces one. */
const actual = (over = {}) => ({
  channel: CHANNEL.META, campaignName: CAMPAIGN_NAME, source: 'GA4',
  date: SYNC, revenueMinor: 660000, conversions: 31, currency: 'EGP', ...over,
});

/** A revenue CSV row, in the shape the upload route parses to. */
const csvRow = (over = {}) => ({
  campaignIdentifier: CAMPAIGN_NAME, revenueAmount: '9105.00', conversions: '18', ...over,
});

/**
 * Sorted in JS, on purpose. Prisma orders an enum column by its DECLARATION
 * order (META, GOOGLE, …, GA4, …, MANUAL), not alphabetically, so a DB `orderBy`
 * here would make every expectation below depend on the order the enum happens
 * to be written in schema.prisma.
 */
const key = (r) => `${r.source}/${r.measurementWindow}/${r.entityLevel}`;
const rowsWhere = async (where) => (
  await prisma.metricSnapshot.findMany({ where: { workspaceId: WS, ...where } })
).sort((a, b) => key(a).localeCompare(key(b)));
const oneRow = async (where) => {
  const rows = await rowsWhere(where);
  expect(rows, `expected exactly one row for ${JSON.stringify(where)}`).toHaveLength(1);
  return rows[0];
};

async function wipe() {
  await prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } });
  await prisma.campaign.deleteMany({ where: { workspaceId: WS } });
  await prisma.account.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspace.deleteMany({ where: { id: WS } });
}

describe.skipIf(!DB_OK)('B4-E5 · the non-DAILY writers against the partial identity', () => {
  beforeAll(async () => {
    await wipe();
    await prisma.workspace.create({ data: { id: WS, name: 'b4e5-regression' } });
  });
  afterAll(wipe);

  // ── E5-T5 · snapshotSink ──────────────────────────────────────────────────
  describe('E5-T5 · snapshotSink', () => {
    beforeEach(() => prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } }));

    it('R1 · inserts one row per entity per window', async () => {
      await landSnapshots(WS, CHANNEL.META, [account(), norm()]);

      expect(await rowsWhere({})).toHaveLength(2);
      const campaign = await oneRow({ entityLevel: 'CAMPAIGN' });
      expect(campaign.entityId).toBe(CAMPAIGN_ID);
      expect(campaign.spendMinor).toBe(120000);
      expect(campaign.measurementWindow).toBe('ROLLING_WINDOW');
    });

    it('R2 · a repeated sync updates in place, with a stable id', async () => {
      await landSnapshots(WS, CHANNEL.META, [account(), norm()]);
      const before = await oneRow({ entityLevel: 'CAMPAIGN' });

      await landSnapshots(WS, CHANNEL.META, [account(), norm()]);
      const after = await oneRow({ entityLevel: 'CAMPAIGN' });

      expect(after.id).toBe(before.id);
      expect(after).toEqual(before);
    });

    it('R3 · a changed payload updates the same row', async () => {
      await landSnapshots(WS, CHANNEL.META, [account(), norm()]);
      const before = await oneRow({ entityLevel: 'CAMPAIGN' });

      await landSnapshots(WS, CHANNEL.META, [account(), norm({ spendMinor: 555000, conversions: 40 })]);
      const after = await oneRow({ entityLevel: 'CAMPAIGN' });

      expect(after.id).toBe(before.id);
      expect(after.spendMinor).toBe(555000);
      expect(after.conversions).toBe(40);
    });

    it('R4 · a null period survives insert, repeat and update', async () => {
      for (const spend of [120000, 120000, 999000]) {
        await landSnapshots(WS, CHANNEL.META, [account(), norm({ spendMinor: spend })]);
        const row = await oneRow({ entityLevel: 'CAMPAIGN' });
        expect(row.windowStart).toBeNull();
        expect(row.windowEnd).toBeNull();
      }
    });

    it('the two canonical windows are separate rows, not a collision', async () => {
      // The reason measurementWindow entered the identity in the first place —
      // and still the reason, now that the index is partial.
      await landSnapshots(WS, CHANNEL.META, [
        account(),
        norm(),
        norm({ measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D, windowStart: new Date('2026-07-26T00:00:00Z'), windowEnd: SYNC, spendMinor: 340000 }),
      ]);

      const campaign = await rowsWhere({ entityLevel: 'CAMPAIGN' });
      expect(campaign.map((r) => r.measurementWindow)).toEqual(['CUMULATIVE_30D', 'ROLLING_WINDOW']);
      expect(campaign.map((r) => r.spendMinor)).toEqual([340000, 120000]);
      expect(campaign.map((r) => r.windowStart && r.windowStart.toISOString().slice(0, 10)))
        .toEqual(['2026-07-26', null]);
    });

    it('R5 · one bad row persists none of the batch', async () => {
      await landSnapshots(WS, CHANNEL.META, [account(), norm()]);
      const before = await rowsWhere({});

      // 3_000_000_000 minor units overflows int4 at the column. The bad row gets
      // its own externalId AND its own name: entity upserts happen before the
      // snapshot batch and are not rolled back with it (unchanged by B4-E5), and
      // two campaigns sharing a name would make later actuals ambiguous.
      await expect(landSnapshots(WS, CHANNEL.META, [
        account(),
        norm({ spendMinor: 777000 }),
        norm({ externalId: 'c_e5reg_bad', name: 'Overflow Campaign', spendMinor: 3_000_000_000 }),
      ])).rejects.toThrow();

      // Not merely "nothing new" — the sibling update in the same batch is gone too.
      expect(await rowsWhere({})).toEqual(before);
    });
  });

  // ── E5-T6 · actualsSink ───────────────────────────────────────────────────
  describe('E5-T6 · actualsSink', () => {
    beforeEach(async () => {
      await prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } });
      await landSnapshots(WS, CHANNEL.META, [account(), norm()]); // the graph it decorates
    });

    const ga4 = () => oneRow({ source: 'GA4' });

    it('R1 · lands a GA4 actual on the existing campaign', async () => {
      expect(await landActuals(WS, [actual()])).toMatchObject({ snapshots: 1, attached: 1, dropped: 0 });

      const row = await ga4();
      expect(row.entityId).toBe(CAMPAIGN_ID);
      expect(row.revenueMinor).toBe(660000);
      expect(row.measurementWindow).toBe('LEGACY_UNKNOWN');
      expect(row.spendMinor).toBe(0);
    });

    it('R2 · a repeat is idempotent, with a stable id', async () => {
      await landActuals(WS, [actual()]);
      const before = await ga4();

      await landActuals(WS, [actual()]);
      const after = await ga4();

      expect(after.id).toBe(before.id);
      expect(after).toEqual(before);
    });

    it('R3 · revised revenue updates the same row', async () => {
      await landActuals(WS, [actual()]);
      const before = await ga4();

      await landActuals(WS, [actual({ revenueMinor: 810000, conversions: 44 })]);
      const after = await ga4();

      expect(after.id).toBe(before.id);
      expect(after.revenueMinor).toBe(810000);
      expect(after.conversions).toBe(44);
    });

    it('R4 · null period preserved, and the columns it never sets stay untouched', async () => {
      await landActuals(WS, [actual()]);
      await landActuals(WS, [actual({ revenueMinor: 810000 })]);

      const row = await ga4();
      expect(row.windowStart).toBeNull();
      expect(row.windowEnd).toBeNull();
      // This writer omits reach / actionMetrics / dailyBudgetMinor entirely. An
      // absent key must keep its default on insert and be LEFT ALONE on update —
      // a fixed DO UPDATE SET over all columns would null them on every repeat.
      expect(row.reach).toBeNull();
      expect(row.actionMetrics).toBeNull();
      expect(row.dailyBudgetMinor).toBeNull();
    });

    it('R5 · one bad row persists none of the batch', async () => {
      await expect(landActuals(WS, [
        actual(), actual({ campaignName: undefined, revenueMinor: 3_000_000_000 }),
      ])).rejects.toThrow();

      expect(await rowsWhere({ source: 'GA4' })).toHaveLength(0);
    });

    it('the GA4 row sits BESIDE the META rows, never on top of one', async () => {
      await landActuals(WS, [actual()]);
      const all = await rowsWhere({ entityLevel: 'CAMPAIGN' });
      expect(all.map((r) => `${r.source}/${r.measurementWindow}`))
        .toEqual(['GA4/LEGACY_UNKNOWN', 'META/ROLLING_WINDOW']);
    });
  });

  // ── E5-T7 · RevenueCsvService ─────────────────────────────────────────────
  describe('E5-T7 · RevenueCsvService', () => {
    beforeEach(async () => {
      await prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } });
      // A MANUAL row aligns to the latest OPERATIONAL row's date and currency,
      // so the platform sync has to have happened first.
      await landSnapshots(WS, CHANNEL.META, [account(), norm()]);
    });

    const manual = () => oneRow({ source: 'MANUAL' });

    it('R1 · lands a MANUAL revenue row against the matched campaign', async () => {
      expect(await processRevenueCsv(WS, [csvRow()])).toMatchObject({ matched: 1, updated: 1 });

      const row = await manual();
      expect(row.entityId).toBe(CAMPAIGN_ID);
      expect(row.revenueMinor).toBe(910500);
      expect(row.conversions).toBe(18);
      expect(row.date.toISOString()).toBe(SYNC.toISOString()); // borrowed from the platform row
    });

    it('R2 · re-uploading the same file is idempotent, with a stable id', async () => {
      await processRevenueCsv(WS, [csvRow()]);
      const before = await manual();

      await processRevenueCsv(WS, [csvRow()]);
      const after = await manual();

      expect(after.id).toBe(before.id);
      expect(after).toEqual(before);
    });

    it('R3 · a corrected figure updates the same row', async () => {
      await processRevenueCsv(WS, [csvRow()]);
      const before = await manual();

      await processRevenueCsv(WS, [csvRow({ revenueAmount: '12000.00', conversions: '25' })]);
      const after = await manual();

      expect(after.id).toBe(before.id);
      expect(after.revenueMinor).toBe(1200000);
      expect(after.conversions).toBe(25);
    });

    it('R4 · null period preserved across insert and update', async () => {
      await processRevenueCsv(WS, [csvRow()]);
      await processRevenueCsv(WS, [csvRow({ revenueAmount: '12000.00' })]);

      const row = await manual();
      expect(row.windowStart).toBeNull();
      expect(row.windowEnd).toBeNull();
      expect(row.reach).toBeNull();
      expect(row.actionMetrics).toBeNull();
    });

    it('R5 · one bad row persists none of the batch', async () => {
      await landSnapshots(WS, CHANNEL.META, [
        account(), norm({ externalId: 'c_e5reg_2', name: 'Second Campaign' }),
      ]);

      await expect(processRevenueCsv(WS, [
        csvRow(), csvRow({ campaignIdentifier: 'Second Campaign', revenueAmount: '99999999999.00' }),
      ])).rejects.toThrow();

      expect(await rowsWhere({ source: 'MANUAL' })).toHaveLength(0);
    });

    it('MANUAL and GA4 revenue for one campaign are two rows, not one', async () => {
      await landActuals(WS, [actual()]);
      await processRevenueCsv(WS, [csvRow()]);

      const all = await rowsWhere({ entityLevel: 'CAMPAIGN' });
      expect(all.map((r) => r.source)).toEqual(['GA4', 'MANUAL', 'META']);
      // Same entity, same level, same window, same date — separated by `source`
      // alone, which is exactly what the identity is for.
      const legacy = all.filter((r) => r.measurementWindow === 'LEGACY_UNKNOWN');
      expect(legacy).toHaveLength(2);
      expect(new Set(legacy.map((r) => r.date.getTime())).size).toBe(1);
    });
  });

  // ── E5-T13 · the timestamp identity, under a skewed session ───────────────
  it('E5-T13 · a non-UTC session still resolves to the same identity', async () => {
    // `date` is `timestamp WITHOUT time zone` AND part of the write identity. If
    // a raw parameter were coerced in the session timezone, a retry would land a
    // DUPLICATE instead of matching the row — and against a PARTIAL index that
    // duplicate is admitted silently rather than rejected, so the failure would
    // be invisible. This is the test that says the cast still holds after E5.
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } });
    await landSnapshots(WS, CHANNEL.META, [account(), norm()]);

    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('options', '-c timezone=Africa/Cairo');
    const skewed = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
      const row = {
        workspaceId: WS, entityId: CAMPAIGN_ID, entityLevel: 'CAMPAIGN', date: SYNC,
        source: 'META', granularity: 'DAILY', measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
        windowStart: null, windowEnd: null, spendMinor: 424242, revenueMinor: 480000,
        impressions: 90000, clicks: 2100, conversions: 24, currency: 'EGP',
      };
      const before = await oneRow({ entityLevel: 'CAMPAIGN', source: 'META' });
      await skewed.$transaction([upsertNonDailyMetricSnapshot(skewed, row)]);

      const after = await oneRow({ entityLevel: 'CAMPAIGN', source: 'META' });
      expect(after.id).toBe(before.id);                              // matched, not duplicated
      expect(after.spendMinor).toBe(424242);                         // and it was the update
      expect(after.date.toISOString()).toBe(SYNC.toISOString());     // stored at the same instant
    } finally {
      await skewed.$disconnect();
    }
  });
});
