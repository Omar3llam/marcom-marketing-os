// ============================================================
// B4-E4 — the non-DAILY write mechanism, against a REAL PostgreSQL
// ============================================================
// This suite is deliberately an integration suite and not a mocked one. The
// whole reason B4-E4 exists is a property no mock can hold: whether PostgreSQL
// matches a predicated `ON CONFLICT` to an index, and whether a raw parameter
// lands the same instant the Prisma client would. Mocking Prisma here would
// assert that the code calls the code, which is exactly how the DAILY collision
// (B4-E2) survived into production behind three green unit tests.
//
// It skips when no migrated database is reachable, the same contract every other
// DB suite in this repo uses (src/tests/dbProbe.js).
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { upsertNonDailyMetricSnapshot, NON_DAILY_IDENTITY } from './nonDailySnapshotWrite.js';
import { MEASUREMENT_WINDOW, CHANNEL } from './connectorTypes.js';
import { landSnapshots } from './snapshotSink.js';

const DB_OK = await dbAvailable();

const WS  = '00000000-0000-4000-8000-0000b4e40001';
const ACC = '00000000-0000-4000-8000-0000b4e40002';
const C1  = '00000000-0000-4000-8000-0000b4e40011';
const C2  = '00000000-0000-4000-8000-0000b4e40012';
const SYNC = new Date('2026-08-23T09:00:00.000Z');

/** Every persisted column, so comparisons are field-level rather than vibes. */
const ALL = ['id', 'workspaceId', 'entityId', 'entityLevel', 'date', 'source', 'granularity',
  'measurementWindow', 'windowStart', 'windowEnd', 'spendMinor', 'revenueMinor', 'cpaMinor',
  'impressions', 'clicks', 'conversions', 'reach', 'ctr', 'roas', 'frequency', 'actionMetrics',
  'dailyBudgetMinor', 'currency'];

const rowsFor = async (where = {}) => (await prisma.metricSnapshot.findMany({
  where: { workspaceId: WS, ...where }, orderBy: [{ source: 'asc' }, { entityId: 'asc' }],
}));

/** A snapshotSink-shaped row: every column present, canonical or rolling. */
const platformRow = (over = {}) => ({
  workspaceId: WS, entityId: C1, entityLevel: 'CAMPAIGN', date: SYNC, source: 'META',
  granularity: 'DAILY', measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
  windowStart: null, windowEnd: null,
  spendMinor: 10000, revenueMinor: 30000, cpaMinor: 3333, impressions: 5000, clicks: 100,
  conversions: 3, ctr: 0.02, roas: 3, reach: 4000, frequency: 1.25,
  actionMetrics: { purchase: 3, purchaseValue: 300 }, dailyBudgetMinor: 5000, currency: 'USD',
  ...over,
});

/** A normalized descriptor, as a connector normalizer hands it to landSnapshots. */
const norm = (externalId, over = {}) => ({
  externalId, entityLevel: 'CAMPAIGN', parentExternalId: 'act_e4', name: `C-${externalId}`,
  channel: CHANNEL.META, source: 'META', date: SYNC,
  measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW, windowStart: null, windowEnd: null,
  currency: 'USD', spendMinor: 10000, revenueMinor: 30000, impressions: 5000, clicks: 100,
  conversions: 3, ...over,
});

/**
 * An actualsSink / RevenueCsvService-shaped row. `reach`, `actionMetrics` and
 * `dailyBudgetMinor` are ABSENT, not null — those writers never set them, and
 * Prisma skipped `undefined` on both halves of `{ create: r, update: r }`.
 */
const actualRow = (over = {}) => ({
  workspaceId: WS, entityId: C1, entityLevel: 'CAMPAIGN', date: SYNC, source: 'GA4',
  granularity: 'DAILY', measurementWindow: MEASUREMENT_WINDOW.LEGACY_UNKNOWN,
  windowStart: null, windowEnd: null,
  spendMinor: 0, revenueMinor: 55000, cpaMinor: null, impressions: 0, clicks: 0,
  conversions: 7, ctr: null, roas: null, frequency: null, currency: 'USD',
  ...over,
});

async function seed() {
  await prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } });
  await prisma.campaign.deleteMany({ where: { workspaceId: WS } });
  await prisma.account.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspace.deleteMany({ where: { id: WS } });
  await prisma.workspace.create({ data: { id: WS, name: 'b4e4' } });
  await prisma.account.create({ data: { id: ACC, workspaceId: WS, channel: 'META', name: 'acct' } });
  for (const id of [C1, C2]) {
    await prisma.campaign.create({ data: { id, workspaceId: WS, accountId: ACC, channel: 'META', name: `c-${id.slice(-4)}` } });
  }
}

describe.skipIf(!DB_OK)('B4-E4 · the non-DAILY write mechanism, on real PostgreSQL', () => {
  beforeAll(seed);
  afterAll(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } });
    await prisma.campaign.deleteMany({ where: { workspaceId: WS } });
    await prisma.account.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });
  beforeEach(() => prisma.metricSnapshot.deleteMany({ where: { workspaceId: WS } }));

  // ── E4-T1 · insert ────────────────────────────────────────────────────────
  it('E4-T1 · inserts a full non-DAILY row with every field intact', async () => {
    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, platformRow())]);

    const rows = await rowsFor();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.date.toISOString()).toBe(SYNC.toISOString());
    expect(r.measurementWindow).toBe('ROLLING_WINDOW');
    expect(r.spendMinor).toBe(10000);
    expect(r.revenueMinor).toBe(30000);
    expect(r.impressions).toBe(5000);
    expect(r.clicks).toBe(100);
    expect(r.conversions).toBe(3);
    expect(r.reach).toBe(4000);
    expect(r.frequency).toBeCloseTo(1.25, 6);
    expect(r.ctr).toBeCloseTo(0.02, 6);
    expect(r.roas).toBeCloseTo(3, 6);
    expect(r.cpaMinor).toBe(3333);
    expect(r.dailyBudgetMinor).toBe(5000);
    expect(r.actionMetrics).toEqual({ purchase: 3, purchaseValue: 300 });
    expect(r.currency).toBe('USD');
  });

  it('E4-T1b · two entities, and both canonical windows, coexist', async () => {
    await prisma.$transaction([
      upsertNonDailyMetricSnapshot(prisma, platformRow()),
      upsertNonDailyMetricSnapshot(prisma, platformRow({ entityId: C2 })),
      upsertNonDailyMetricSnapshot(prisma, platformRow({ measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D })),
    ]);
    // The measurementWindow half of the identity still separates a canonical row
    // from the operational row landed by the same sync, with the same `date`.
    expect(await rowsFor()).toHaveLength(3);
  });

  // ── E4-T2 · exact retry ───────────────────────────────────────────────────
  it('E4-T2 · an exact retry updates in place — no duplicate, same id, same values', async () => {
    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, platformRow())]);
    const first = (await rowsFor())[0];

    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, platformRow())]);
    const rows = await rowsFor();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    for (const k of ALL) expect(rows[0][k]).toEqual(first[k]);
  });

  // ── E4-T3 · update ────────────────────────────────────────────────────────
  it('E4-T3 · the same identity with a new payload replaces the values, keeping the id', async () => {
    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, platformRow())]);
    const first = (await rowsFor())[0];

    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, platformRow({
      spendMinor: 77777, clicks: 999, roas: null, actionMetrics: null,
    }))]);
    const rows = await rowsFor();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].spendMinor).toBe(77777);
    expect(rows[0].clicks).toBe(999);
    // An EXPLICIT null is a real value and must land — distinct from an absent key.
    expect(rows[0].roas).toBeNull();
    expect(rows[0].actionMetrics).toBeNull();
  });

  // ── E4-T4 · NULL preservation, and absent-key preservation ────────────────
  it('E4-T4 · a GA4 row keeps windowStart null through insert, repeat and update', async () => {
    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, actualRow())]);
    const first = (await rowsFor({ source: 'GA4' }))[0];
    expect(first.windowStart).toBeNull();
    expect(first.windowEnd).toBeNull();

    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, actualRow())]);
    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, actualRow({ revenueMinor: 99000 }))]);
    const rows = await rowsFor({ source: 'GA4' });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].revenueMinor).toBe(99000);
    // Never a sentinel, never NOW(), never the epoch.
    expect(rows[0].windowStart).toBeNull();
    expect(rows[0].windowEnd).toBeNull();
  });

  it('E4-T4b · a key the writer never sets is left alone on update, not nulled', async () => {
    // The exact shape of `{ create: r, update: r }` with `undefined`: actualsSink
    // omits reach/actionMetrics/dailyBudgetMinor. A fixed DO UPDATE SET naming
    // them would overwrite a value this writer never owned.
    const seeded = { ...actualRow(), reach: 1234, dailyBudgetMinor: 4321 };
    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, seeded)]);

    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, actualRow({ revenueMinor: 1 }))]);
    const rows = await rowsFor({ source: 'GA4' });

    expect(rows).toHaveLength(1);
    expect(rows[0].revenueMinor).toBe(1);
    expect(rows[0].reach).toBe(1234);
    expect(rows[0].dailyBudgetMinor).toBe(4321);
  });

  // ── E4-T5 · MANUAL shape ──────────────────────────────────────────────────
  it('E4-T5 · a MANUAL revenue row repeats and updates on its own identity', async () => {
    const manual = (over = {}) => actualRow({ source: 'MANUAL', revenueMinor: 82000, ...over });
    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, manual())]);
    const first = (await rowsFor({ source: 'MANUAL' }))[0];

    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, manual())]);
    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, manual({ revenueMinor: 91000 }))]);
    const rows = await rowsFor({ source: 'MANUAL' });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].revenueMinor).toBe(91000);
    expect(rows[0].measurementWindow).toBe('LEGACY_UNKNOWN');
  });

  it('E4-T5b · GA4 and MANUAL measuring the same entity stay two rows', async () => {
    await prisma.$transaction([
      upsertNonDailyMetricSnapshot(prisma, actualRow()),
      upsertNonDailyMetricSnapshot(prisma, actualRow({ source: 'MANUAL' })),
    ]);
    expect(await rowsFor()).toHaveLength(2);
  });

  // ── E4-T6 · batch atomicity ───────────────────────────────────────────────
  it('E4-T6 · one failing row rolls the whole batch back', async () => {
    // A workspaceId with no row in `workspaces` violates the FK. The batch must
    // behave exactly as the Prisma upsert batch did: throw, persist nothing.
    const orphan = platformRow({ entityId: C2, workspaceId: '00000000-0000-4000-8000-00000000dead' });

    await expect(prisma.$transaction([
      upsertNonDailyMetricSnapshot(prisma, platformRow()),
      upsertNonDailyMetricSnapshot(prisma, orphan),
    ])).rejects.toThrow();

    expect(await rowsFor()).toHaveLength(0);
  });

  it('E4-T6b · landSnapshots keeps its batch atomic — the writer, not just the helper', async () => {
    // T6 above proves the helper composes into an atomic batch. This proves the
    // WRITER still assembles one, which is a separate claim: turning the batch
    // into a sequential best-effort loop would leave the helper untouched and
    // every other test green while silently converting the sink to partial
    // persistence. `spendMinor` beyond int4 fails deterministically in
    // PostgreSQL, after the first row has already been sent.
    // The ACCOUNT descriptor rides along because landSnapshots drops any row
    // whose parent is in neither the batch nor the graph.
    const acct = { externalId: 'act_e4', entityLevel: 'ACCOUNT', name: 'acct', channel: CHANNEL.META,
      source: 'META', date: SYNC, measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
      currency: 'USD', spendMinor: 1, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0 };
    const good = norm('c-atomic-a');
    const bad = norm('c-atomic-b', { spendMinor: 3_000_000_000 });

    await expect(landSnapshots(WS, CHANNEL.META, [acct, good, bad])).rejects.toThrow();

    // Entities may exist — they land in an earlier transaction of their own, and
    // that was true before this PR too. What must not exist is a half-written
    // metric batch.
    const landed = await prisma.metricSnapshot.findMany({
      where: { workspaceId: WS, entityLevel: 'CAMPAIGN' }, select: { id: true },
    });
    expect(landed).toHaveLength(0);
  });

  // ── E4-T7 · the timestamp identity regression ─────────────────────────────
  it('E4-T7 · stores the same instant as Prisma under a non-UTC session timezone', async () => {
    // Pinned on the CONNECTION, so the assertion holds on a UTC server too — the
    // mutation this guards (dropping `::timestamptz AT TIME ZONE 'UTC'`) is
    // invisible whenever the session happens to be UTC, which is precisely when
    // someone would "tidy" the cast away.
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('options', '-c timezone=Africa/Cairo');
    const skewed = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
      const tz = (await skewed.$queryRawUnsafe('SHOW TimeZone'))[0].TimeZone;
      expect(tz).toBe('Africa/Cairo'); // the skew this test depends on

      // A: the Prisma typed client — the baseline this mechanism must match.
      await skewed.metricSnapshot.create({ data: platformRow({ entityId: C2 }) });
      // B: the mechanism under test, same instant, same skewed session.
      await skewed.$transaction([upsertNonDailyMetricSnapshot(skewed, platformRow())]);

      const stored = await skewed.$queryRawUnsafe(
        `SELECT "entityId", to_char("date",'YYYY-MM-DD HH24:MI:SS') AS d
           FROM "metric_snapshots" WHERE "workspaceId" = $1::uuid ORDER BY "entityId"`, WS);
      expect(stored).toHaveLength(2);
      // Without the UTC conversion this reads 12:00:00 — three hours adrift.
      expect(stored[0].d).toBe(stored[1].d);
      expect(stored[0].d).toBe('2026-08-23 09:00:00');

      // And the shift is not only a wrong value: `date` is in the identity, so a
      // retry under the skew must still match rather than insert a second row.
      await skewed.$transaction([upsertNonDailyMetricSnapshot(skewed, platformRow())]);
      expect(await rowsFor({ entityId: C1 })).toHaveLength(1);
    } finally {
      await skewed.$disconnect();
    }
  });

  // ── E4-T8 · the DAILY boundary ────────────────────────────────────────────
  it('E4-T8 · refuses a DAILY row before it reaches the database', async () => {
    expect(() => upsertNonDailyMetricSnapshot(prisma, platformRow({
      measurementWindow: MEASUREMENT_WINDOW.DAILY,
      windowStart: new Date('2026-08-20T00:00:00.000Z'),
      windowEnd: new Date('2026-08-20T00:00:00.000Z'),
    }))).toThrow(/DAILY/);

    expect(await rowsFor()).toHaveLength(0);
  });

  it('E4-T8b · refuses a row that states no window at all', () => {
    expect(() => upsertNonDailyMetricSnapshot(prisma, platformRow({ measurementWindow: undefined })))
      .toThrow(/measurementWindow is required/);
  });

  it('E4-T8c · refuses a row missing any identity column', () => {
    for (const key of NON_DAILY_IDENTITY) {
      expect(() => upsertNonDailyMetricSnapshot(prisma, platformRow({ [key]: undefined })), key)
        .toThrow(new RegExp(key === 'measurementWindow' ? 'measurementWindow' : key));
    }
  });

  // ── the predicate, which is the entire point of this slice ────────────────
  it('matches the PARTIAL unique index — the reason the predicate exists', async () => {
    // B4-E4 had to BUILD a partial index here to test the predicate at all,
    // because the index shipping at the time was full-table and a full index
    // satisfies a predicated ON CONFLICT trivially. B4-E5 made the shipped index
    // partial, so the probe is gone: this now runs against the real one.
    //
    // (The old version also recreated `metric_snapshots_identity_key` in its
    // `finally`. Left in place after B4-E5 that would quietly restore the retired
    // full-table index onto the test database and break every DAILY suite that
    // ran after it.)
    const [{ partial }] = await prisma.$queryRawUnsafe(`
      SELECT (ix.indpred IS NOT NULL) AS partial
      FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
      WHERE i.relname = 'metric_snapshots_non_daily_identity_key'`);
    expect(partial, 'the shipped identity index is not partial').toBe(true);

    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, platformRow())]);
    await prisma.$transaction([upsertNonDailyMetricSnapshot(prisma, platformRow({ spendMinor: 42 }))]);

    const rows = await rowsFor();
    expect(rows).toHaveLength(1);        // conflicted against the partial index
    expect(rows[0].spendMinor).toBe(42); // and updated, not duplicated
  });

  // ── concurrency, carried over from the B4-E3 proof ────────────────────────
  it('two concurrent writes to one identity produce one row and lose nothing', async () => {
    const url = process.env.DATABASE_URL;
    const A = new PrismaClient({ datasources: { db: { url } } });
    const B = new PrismaClient({ datasources: { db: { url } } });
    try {
      const out = await Promise.allSettled([
        A.$transaction([upsertNonDailyMetricSnapshot(A, platformRow({ spendMinor: 111 }))]),
        B.$transaction([upsertNonDailyMetricSnapshot(B, platformRow({ spendMinor: 222 }))]),
      ]);
      expect(out.every((r) => r.status === 'fulfilled')).toBe(true);
      const rows = await rowsFor();
      expect(rows).toHaveLength(1);
      expect([111, 222]).toContain(rows[0].spendMinor); // a winner, never a merge
    } finally {
      await A.$disconnect(); await B.$disconnect();
    }
  });
});
