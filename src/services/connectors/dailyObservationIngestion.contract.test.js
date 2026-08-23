// ============================================================
// B4-D — activating the daily observation pipeline
// ============================================================
// R8 built the whole chain and switched it off:
//
//     connector.fetchDailyRaw → metaDailyNormalize → dailySnapshotSink
//       → MetricSnapshot(measurementWindow = DAILY)
//         → dailyObservationReader → classifyAndReduce
//
// B4-D turns it on. The risk in turning a dormant pipeline on is not that it
// fails — a failure is loud. It is that it reports something reassuring while
// producing nothing real: a fabricated zero, a placeholder day, a "disabled"
// that reads as "no data", a normalizer refusal reported as an empty account.
//
// So these tests protect boundaries rather than lines. Each one names the
// specific dishonest shortcut that would make activation look successful:
//
//   T1  the gate still bites, and the deployment declares it explicitly
//   T2  the daily sink still refuses a population that is not DAILY
//   T3  an empty platform response lands nothing — it never invents a row
//   T4  an unmeasured metric stays unmeasured; a measured zero still lands
//   T5  five provider states stay five, and never collapse into each other
//   T6  the existing reader consumes exactly what the sink writes
//   T7  ingestion creates evidence and NEVER an outcome
//
// B4-D CREATES EVIDENCE, NOT OUTCOMES. T7 is the boundary that keeps it that way.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const {
  resolve, isSyncable, landSnapshots, landDailySnapshots, listActiveSyncable, recordSync,
} = vi.hoisted(() => ({
  resolve: vi.fn(), isSyncable: vi.fn(() => true),
  landSnapshots: vi.fn(), landDailySnapshots: vi.fn(),
  listActiveSyncable: vi.fn(), recordSync: vi.fn(),
}));

// PARTIAL mocks on both sinks. `toSnapshotRows` and `dailyKey` are the real
// implementations throughout — T4 and T6 are only worth anything if the rows
// they inspect are built by the code that builds production rows. Only the two
// DB-writing entry points are spies.
vi.mock('./snapshotSink.js', async (orig) => ({ ...(await orig()), landSnapshots }));
vi.mock('./dailySnapshotSink.js', async (orig) => ({ ...(await orig()), landDailySnapshots }));
vi.mock('./connectorRegistry.js', () => ({ resolve, isSyncable }));
vi.mock('./credentialStore.js', () => ({ listActiveSyncable, recordSync }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    campaign:       { findMany: vi.fn(async () => []) },
    metricSnapshot: { findMany: vi.fn(async () => []), create: vi.fn(), update: vi.fn() },
    // T7's tripwire. Present so a wiring mistake CALLS something rather than
    // throwing on an undefined delegate — a throw would be caught by the daily
    // block's own try/catch and reported as FAILED, which is not the assertion
    // we want to be making.
    outcomeSnapshot: { create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    $transaction:   vi.fn(async () => []),
  },
}));

import { prisma } from '../../lib/prisma.js';
import { runConnectorSync } from './ConnectorSyncService.js';
import { DAILY_STATE, isDailyIngestionEnabled } from './connectorConfig.js';
import { toSnapshotRows } from './snapshotSink.js';
import { metaDailyNormalize, DAILY_REJECTION } from './normalize/metaDailyNormalize.js';
import { classifyAndReduce, ROW_REJECTION } from '../daily-observations/dailyObservationReader.js';
import { CHANNEL, MEASUREMENT_WINDOW, detId } from './connectorTypes.js';

const WS = 'ws-b4d';
const ACCOUNT = 'act_b4d';
const NOW = new Date('2026-08-20T09:00:00.000Z');

/** A connector that can do daily. Overridable one capability at a time. */
const dailyConnector = (over = {}) => ({
  channel: CHANNEL.META,
  authenticate: vi.fn(async () => ({ ok: true, accountExternalId: ACCOUNT, currency: 'USD' })),
  fetchRaw: vi.fn(async () => [{ campaign_id: 'c1' }]),
  normalize: vi.fn(() => [{ campaign_id: 'c1' }]),
  fetchDailyRaw: vi.fn(async () => ({ rows: [{ campaign_id: 'c1' }], days: 7, truncated: false })),
  normalizeDaily: vi.fn(() => ({ snapshots: [{ externalId: 'c1' }], rejected: [] })),
  ...over,
});

/** One raw Meta `time_increment=1` row. */
const metaDay = (day, over = {}) => ({
  campaign_id: 'c1',
  campaign_name: 'Eid — Cold',
  spend: '420.00',
  impressions: '15000',
  clicks: '300',
  actions: [{ action_type: 'purchase', value: '12' }],
  action_values: [{ action_type: 'purchase', value: '2100' }],
  date_start: day,
  date_stop: day,
  ...over,
});

/**
 * The REAL chain, as far as a test can carry it: raw Meta rows → the normalizer
 * → the shared row builder → the exact object handed to Prisma. `id` is the one
 * thing added here, because only the database can assign it.
 */
const persistedRows = (rows) => toSnapshotRows(
  WS, CHANNEL.META,
  metaDailyNormalize({ accountExternalId: ACCOUNT, currency: 'USD', date: NOW, rows }).snapshots,
).map((r, i) => ({ ...r, id: `row-${i + 1}` }));

const runSync = () => runConnectorSync(WS, { now: NOW });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  isSyncable.mockReturnValue(true);
  listActiveSyncable.mockResolvedValue([{ workspaceId: WS, channel: CHANNEL.META }]);
  landSnapshots.mockResolvedValue({ entities: 3, snapshots: 2 });
  landDailySnapshots.mockResolvedValue({ created: 7, restated: 0, skippedUnknownEntity: 0 });
  recordSync.mockResolvedValue({});
});

// ────────────────────────────────────────────────────────────────────────────
// T1 — the gate bites, and the deployment says so out loud
// ────────────────────────────────────────────────────────────────────────────
describe('T1 — the feature gate still decides', () => {
  it('an unset flag requests nothing and lands nothing', async () => {
    const connector = dailyConnector();
    resolve.mockReturnValue(connector);

    const res = await runSync();

    expect(connector.fetchDailyRaw).not.toHaveBeenCalled();
    expect(landDailySnapshots).not.toHaveBeenCalled();
    expect(res.results[0].daily.state).toBe(DAILY_STATE.DISABLED);
  });

  it('only the exact string "true" opens it', () => {
    // Activation must be a decision, never a typo. '1' and 'yes' read as intent
    // and are still refused, so the expensive path cannot be reached by accident.
    expect(isDailyIngestionEnabled({})).toBe(false);
    expect(isDailyIngestionEnabled({ DAILY_INGESTION_ENABLED: 'TRUE' })).toBe(false);
    expect(isDailyIngestionEnabled({ DAILY_INGESTION_ENABLED: '1' })).toBe(false);
    expect(isDailyIngestionEnabled({ DAILY_INGESTION_ENABLED: 'yes' })).toBe(false);
    expect(isDailyIngestionEnabled({ DAILY_INGESTION_ENABLED: 'true' })).toBe(true);
  });

  it('the operational sync is unchanged whether daily is on or off', async () => {
    // Activation must not be able to alter the population every existing surface
    // reads. Same operational call, same recorded health, either way.
    resolve.mockReturnValue(dailyConnector());
    const off = await runSync();
    const offCall = landSnapshots.mock.calls[0];

    vi.clearAllMocks();
    landSnapshots.mockResolvedValue({ entities: 3, snapshots: 2 });
    landDailySnapshots.mockResolvedValue({ created: 7, restated: 0, skippedUnknownEntity: 0 });
    recordSync.mockResolvedValue({});
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector());
    const on = await runSync();

    expect(landSnapshots.mock.calls[0]).toEqual(offCall);
    expect(on.results[0].snapshots).toBe(off.results[0].snapshots);
    expect(on.synced).toBe(off.synced);
  });

  // C1's proof. "Explicitly configurable in production" is a claim about the
  // deployment, so it is checked against the deployment file rather than
  // asserted in a report. Comments are stripped first — this file DOCUMENTS the
  // variable by name, and prose about a key is not a declaration of it.
  it('the production blueprint declares the flag on every service that syncs', () => {
    const yaml = readFileSync(fileURLToPath(new URL('../../../render.yaml', import.meta.url)), 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

    // runConnectorSync runs in TWO processes: the worker's cron loop and the web
    // service's manual /connections/sync. A flag on one of them makes the daily
    // population depend on which trigger fired.
    const blocks = yaml.split(/^\s{2}- type:/m).slice(1);
    const syncing = blocks.filter((b) => /name:\s*lumi-(backend|worker)\b/.test(b));
    expect(syncing).toHaveLength(2);
    for (const b of syncing) {
      expect(b).toMatch(/key:\s*DAILY_INGESTION_ENABLED\s*\n\s*value:\s*"true"/);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T2 — the sink still refuses a population that is not DAILY
// ────────────────────────────────────────────────────────────────────────────
describe('T2 — DAILY semantics are not negotiable', () => {
  /** The REAL sink, past this file's own spy. */
  const realSink = async () => (await vi.importActual('./dailySnapshotSink.js')).landDailySnapshots;

  it('refuses a trailing aggregate wearing a daily label', async () => {
    // The one thing this phase must never do: relabel a 30-day row as a day.
    // Every consumer of this population sums it.
    const land = await realSink();
    const rolling = [{
      externalId: 'c1', entityLevel: 'CAMPAIGN', name: 'C', channel: CHANNEL.META, source: 'META',
      date: NOW, measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
      windowStart: new Date('2026-08-10T00:00:00.000Z'), windowEnd: new Date('2026-08-10T00:00:00.000Z'),
      spendMinor: 100, revenueMinor: 0, currency: 'USD',
    }];

    await expect(land(WS, CHANNEL.META, rolling)).rejects.toThrow(/ROLLING_WINDOW/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a daily row that will not say which day it measured', async () => {
    const land = await realSink();
    const undated = [{
      externalId: 'c1', entityLevel: 'CAMPAIGN', name: 'C', channel: CHANNEL.META, source: 'META',
      date: NOW, measurementWindow: MEASUREMENT_WINDOW.DAILY,
      windowStart: null, windowEnd: null,
      spendMinor: 100, revenueMinor: 0, currency: 'USD',
    }];

    await expect(land(WS, CHANNEL.META, undated)).rejects.toThrow(/windowStart/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a sink refusal costs daily rows and nothing else', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    landDailySnapshots.mockRejectedValue(new Error('refused a ROLLING_WINDOW row'));
    resolve.mockReturnValue(dailyConnector());

    const res = await runSync();

    expect(res.results[0]).toMatchObject({ status: 'success', snapshots: 2 });
    expect(res.results[0].daily.state).toBe(DAILY_STATE.FAILED);
    expect(res.failed).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T3 — an empty response lands nothing, and says so
// ────────────────────────────────────────────────────────────────────────────
describe('T3 — no synthetic success', () => {
  it('a platform response with no rows persists no rows', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector({
      fetchDailyRaw: vi.fn(async () => ({ rows: [], days: 7, truncated: false })),
      normalizeDaily: vi.fn(() => ({ snapshots: [], rejected: [] })),
    }));
    landDailySnapshots.mockResolvedValue({ created: 0, restated: 0, skippedUnknownEntity: 0 });

    const res = await runSync();

    // NO_DATA is the honest outcome and it is NOT a failure. What must never
    // happen is a placeholder row conjured to make the population non-empty.
    expect(res.results[0].daily.state).toBe(DAILY_STATE.NO_DATA);
    expect(res.results[0].daily.created).toBe(0);
    expect(res.results[0].dailyObservations).toBe(0);
    expect(res.results[0].status).toBe('success');
  });

  it('the real sink writes nothing at all for an empty normalization', async () => {
    const land = (await vi.importActual('./dailySnapshotSink.js')).landDailySnapshots;

    const out = await land(WS, CHANNEL.META, []);

    expect(out).toEqual({ created: 0, restated: 0, skippedUnknownEntity: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.metricSnapshot.create).not.toHaveBeenCalled();
  });

  it('rows for entities the graph does not hold are dropped, never minted', async () => {
    // The sink decorates; it never creates an entity. A daily row for an unknown
    // campaign is a dropped row, not a new campaign.
    const land = (await vi.importActual('./dailySnapshotSink.js')).landDailySnapshots;
    prisma.campaign.findMany.mockResolvedValueOnce([]); // nothing exists here

    const out = await land(WS, CHANNEL.META, metaDailyNormalize({
      accountExternalId: ACCOUNT, currency: 'USD', date: NOW, rows: [metaDay('2026-08-10')],
    }).snapshots);

    expect(out).toMatchObject({ created: 0, restated: 0, skippedUnknownEntity: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T4 — a metric nobody measured is not a zero
// ────────────────────────────────────────────────────────────────────────────
describe('T4 — missing is not zero', () => {
  it('a day with no spend field is REFUSED, not stored as 0', () => {
    // spendMinor is NOT NULL, so "unknown spend" has no representation in the
    // row. The honest answer is an absent day; the dishonest one is `?? 0`,
    // which would report delivery that was never measured.
    const { snapshots, rejected } = metaDailyNormalize({
      accountExternalId: ACCOUNT, currency: 'USD', date: NOW,
      rows: [metaDay('2026-08-10', { spend: undefined })],
    });

    expect(snapshots).toHaveLength(0);
    expect(rejected).toEqual([{ externalId: 'c1', reason: DAILY_REJECTION.MISSING_MEASURE }]);
  });

  it('a MEASURED zero still lands — a zero is a measurement', () => {
    // The other half, and the one a naive "reject falsy spend" fix would break.
    const { snapshots, rejected } = metaDailyNormalize({
      accountExternalId: ACCOUNT, currency: 'USD', date: NOW,
      rows: [metaDay('2026-08-10', { spend: '0.00' })],
    });

    expect(rejected).toHaveLength(0);
    expect(snapshots[0].spendMinor).toBe(0);
  });

  it('unmeasured ratios and cumulative metrics reach the row as null', () => {
    const [row] = persistedRows([metaDay('2026-08-10', {
      spend: '100.00', impressions: '0', clicks: '0',
      actions: undefined, action_values: undefined,
    })]);

    // No revenue signal → no ROAS. `0.00x` here would read as a measured
    // failure of a campaign nobody measured revenue for.
    expect(row.roas).toBeNull();
    // No impressions → no CTR, and no conversions → no CPA.
    expect(row.ctr).toBeNull();
    expect(row.cpaMinor).toBeNull();
    // CUMULATIVE metrics are absent from this population by design, and absence
    // is null — not "zero people were reached".
    expect(row.reach).toBeNull();
    expect(row.frequency).toBeNull();
    // No recognised action → null, never `{}`. "This channel reported no funnel"
    // must stay distinguishable from "every stage measured zero".
    expect(row.actionMetrics).toBeNull();
  });

  it('a real measurement is carried through untouched', () => {
    const [row] = persistedRows([metaDay('2026-08-10')]);

    expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.DAILY);
    expect(row.spendMinor).toBe(42000);
    expect(row.revenueMinor).toBe(210000);
    expect(row.impressions).toBe(15000);
    expect(row.clicks).toBe(300);
    expect(row.conversions).toBe(12);
    expect(row.roas).toBeCloseTo(5, 10);
    expect(row.windowStart.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(row.windowEnd.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    // The observation instant is the sync, and it is NOT the measured day.
    expect(row.date.toISOString()).toBe(NOW.toISOString());
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T5 — five states, and they stay five
// ────────────────────────────────────────────────────────────────────────────
describe('T5 — provider states never collapse', () => {
  it('the five names are distinct values', () => {
    const values = Object.values(DAILY_STATE);
    expect(values).toHaveLength(5);
    expect(new Set(values).size).toBe(5);
  });

  it('DISABLED — nobody asked', async () => {
    resolve.mockReturnValue(dailyConnector());
    const res = await runSync();
    expect(res.results[0].daily).toMatchObject({
      state: DAILY_STATE.DISABLED, created: null, rejected: null, error: null,
    });
  });

  it('UNIMPLEMENTED — the provider cannot answer the question', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector({ fetchDailyRaw: undefined, normalizeDaily: undefined }));

    const res = await runSync();

    // Fixed by writing a connector — a different job from investigating an
    // account, which is why it must not arrive as NO_DATA.
    expect(res.results[0].daily.state).toBe(DAILY_STATE.UNIMPLEMENTED);
    expect(landDailySnapshots).not.toHaveBeenCalled();
  });

  it('a HALF-implemented provider is UNIMPLEMENTED, not attempted', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    const connector = dailyConnector({ normalizeDaily: undefined });
    resolve.mockReturnValue(connector);

    const res = await runSync();

    expect(res.results[0].daily.state).toBe(DAILY_STATE.UNIMPLEMENTED);
    expect(connector.fetchDailyRaw).not.toHaveBeenCalled();
  });

  it('NO_DATA — we looked and there was nothing', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector());
    landDailySnapshots.mockResolvedValue({ created: 0, restated: 0, skippedUnknownEntity: 0 });

    const res = await runSync();

    expect(res.results[0].daily.state).toBe(DAILY_STATE.NO_DATA);
    expect(res.results[0].daily.error).toBeNull();
  });

  it('SUCCESS — real rows were persisted', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector());
    landDailySnapshots.mockResolvedValue({ created: 5, restated: 2, skippedUnknownEntity: 1 });

    const res = await runSync();

    expect(res.results[0].daily).toMatchObject({
      state: DAILY_STATE.SUCCESS, created: 5, restated: 2, skippedUnknownEntity: 1,
    });
    expect(res.results[0].dailyObservations).toBe(7);
  });

  it('FAILED — we could not look', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector({
      fetchDailyRaw: vi.fn(async () => { throw new Error('rate limited'); }),
    }));

    const res = await runSync();

    // The distinction that matters most on activation day: a rate limit folded
    // into NO_DATA turns an outage into a measurement of an empty account.
    expect(res.results[0].daily.state).toBe(DAILY_STATE.FAILED);
    expect(res.results[0].daily.error).toMatch(/rate limited/);
    expect(res.results[0].daily.created).toBeNull();
    expect(res.results[0].status).toBe('success'); // still best-effort
  });

  it('carries the counts that separate "no delivery" from "all rows refused"', async () => {
    // Both are NO_DATA. Only these numbers say which, and §J has to classify a
    // zero population without guessing.
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector({
      fetchDailyRaw: vi.fn(async () => ({ rows: [{ a: 1 }, { b: 2 }, { c: 3 }], days: 7, truncated: true })),
      normalizeDaily: vi.fn(() => ({ snapshots: [], rejected: [{ reason: 'NOT_ONE_DAY' }, { reason: 'NOT_ONE_DAY' }, { reason: 'NOT_ONE_DAY' }] })),
    }));
    landDailySnapshots.mockResolvedValue({ created: 0, restated: 0, skippedUnknownEntity: 0 });

    const res = await runSync();

    expect(res.results[0].daily).toMatchObject({
      state: DAILY_STATE.NO_DATA, fetchedRows: 3, rejected: 3, days: 7, truncated: true,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T6 — the reader consumes exactly what the sink writes
// ────────────────────────────────────────────────────────────────────────────
describe('T6 — the population is readable by the reader that was built for it', () => {
  // A boundary inside Aug 10, with clean days either side.
  const BOUNDARY = new Date('2026-08-10T12:00:00.000Z');

  it('classifies before and after by the DECLARED period, not the sync time', () => {
    // Every row here shares one `date` (one sync read them all) and they were
    // built in scrambled order. Only windowStart can place them in time.
    const rows = persistedRows([
      metaDay('2026-08-12'), metaDay('2026-08-08'), metaDay('2026-08-11'), metaDay('2026-08-09'),
    ]);

    const { before, after, excluded } = classifyAndReduce(rows, BOUNDARY);

    expect(before.map((o) => o.day)).toEqual(['2026-08-08', '2026-08-09']);
    expect(after.map((o) => o.day)).toEqual(['2026-08-11', '2026-08-12']);
    expect(excluded).toEqual([]);
  });

  it('excludes the day the boundary falls inside', () => {
    // Aug 10 is neither a clean before nor a clean after: the intervention
    // happened partway through the delivery it would be evidence for.
    const rows = persistedRows([metaDay('2026-08-09'), metaDay('2026-08-10'), metaDay('2026-08-11')]);

    const { before, after, excluded } = classifyAndReduce(rows, BOUNDARY);

    expect(before.map((o) => o.day)).toEqual(['2026-08-09']);
    expect(after.map((o) => o.day)).toEqual(['2026-08-11']);
    expect(excluded).toEqual([{ id: 'row-2', reason: ROW_REJECTION.CROSSES_BOUNDARY }]);
  });

  it('a restatement wins over the reading it restates', () => {
    // The sink UPDATES a re-observed day and advances `date`. Two physical rows
    // for one day can still exist (concurrent syncs), and latest-observation
    // must decide — never array order.
    const [first] = persistedRows([metaDay('2026-08-09', { spend: '100.00' })]);
    const [second] = persistedRows([metaDay('2026-08-09', { spend: '175.00' })]);
    const restated = { ...second, id: 'row-later', date: new Date('2026-08-21T09:00:00.000Z') };

    const forward = classifyAndReduce([first, restated], BOUNDARY);
    const reverse = classifyAndReduce([restated, first], BOUNDARY);

    expect(forward.before[0].spendMinor).toBe(17500);
    expect(forward.before[0]).toEqual(reverse.before[0]);
  });

  it('two disagreeing readings of one instant stay AMBIGUOUS', () => {
    // Nothing in the data ranks them. Picking one would make the answer depend
    // on which row the database returned first.
    const [a] = persistedRows([metaDay('2026-08-09', { spend: '100.00' })]);
    const [b] = persistedRows([metaDay('2026-08-09', { spend: '900.00' })]);

    const { before } = classifyAndReduce([a, { ...b, id: 'row-tied' }], BOUNDARY);

    expect(before[0].ambiguous).toBe(true);
    expect(before[0].tiedIds).toEqual(['row-1', 'row-tied']);
  });

  it('a non-DAILY row cannot enter the population even if handed in directly', () => {
    const [daily] = persistedRows([metaDay('2026-08-09')]);
    const rolling = { ...daily, id: 'row-rolling', measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW };

    const { before, excluded } = classifyAndReduce([daily, rolling], BOUNDARY);

    expect(before).toHaveLength(1);
    expect(excluded).toEqual([{ id: 'row-rolling', reason: ROW_REJECTION.WRONG_POPULATION }]);
  });

  it('a day nobody observed is absent, never a zero', () => {
    // The reader reports gaps by name. If a missing day arrived as a zero row,
    // every difference computed from this population would be wrong and silent.
    const { before, after } = classifyAndReduce(persistedRows([metaDay('2026-08-08')]), BOUNDARY);

    expect(before.map((o) => o.day)).toEqual(['2026-08-08']);
    expect(after).toEqual([]);
    expect(before[0].spendMinor).toBe(42000);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T7 — ingestion creates evidence, never an outcome
// ────────────────────────────────────────────────────────────────────────────
describe('T7 — no outcome side effect', () => {
  it('a full successful daily ingestion touches no OutcomeSnapshot', async () => {
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'true');
    resolve.mockReturnValue(dailyConnector());
    landDailySnapshots.mockResolvedValue({ created: 7, restated: 0, skippedUnknownEntity: 0 });

    const res = await runSync();

    expect(res.results[0].daily.state).toBe(DAILY_STATE.SUCCESS);
    for (const op of Object.values(prisma.outcomeSnapshot)) {
      expect(op).not.toHaveBeenCalled();
    }
  });

  // The runtime assertion above only proves THIS path. The structural one is
  // what stops the wiring being added at all: an observation is evidence, and
  // the step from evidence to a scored outcome is B4-E's, gated on questions
  // (how `sustained` is derived, whose outcome wins) that B4-D does not answer.
  it('the sync service imports nothing from the outcome or accuracy layer', () => {
    const src = readFileSync(fileURLToPath(new URL('./ConnectorSyncService.js', import.meta.url)), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    expect(src).not.toMatch(/from\s+['"][^'"]*decision-accuracy/);
    expect(src).not.toMatch(/outcomeSnapshot/i);
    expect(src).not.toMatch(/recordOutcome|projectOutcomeEvidence|runLearningSweep/);
  });

  // The population proof is the instrument that answers §F and §J, and it runs
  // against PRODUCTION. A diagnostic that could write is not a diagnostic.
  it('the production population proof is structurally read-only', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../scripts/daily-population-proof.js', import.meta.url)), 'utf8')
      .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // Matched as CALLS, not as substrings: `orderBy: { createdAt }` is a read,
    // and a ratchet that cannot tell those apart teaches people to work around it.
    for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      expect(src, `proof script must not call .${op}()`).not.toMatch(new RegExp('\\.' + op + '\\s*\\('));
    }
    expect(src, 'proof script must not use an executing raw query').not.toMatch(/\$executeRaw/);
    // It reads the DAILY population and nothing about outcomes.
    expect(src).not.toMatch(/outcomeSnapshot/i);
    // And it must never print the connection string it used. The host and the
    // database NAME are provenance; the credentials in front of them are not.
    expect(src).not.toMatch(/console\.log\([^)]*DATABASE_URL/);
  });

  it('the daily sink writes to metric_snapshots and nothing else', async () => {
    const land = (await vi.importActual('./dailySnapshotSink.js')).landDailySnapshots;
    prisma.campaign.findMany.mockResolvedValueOnce([{ id: detId(WS, CHANNEL.META, 'CAMPAIGN', 'c1') }]);

    await land(WS, CHANNEL.META, metaDailyNormalize({
      accountExternalId: ACCOUNT, currency: 'USD', date: NOW, rows: [metaDay('2026-08-10')],
    }).snapshots);

    expect(prisma.metricSnapshot.create).toHaveBeenCalledTimes(1);
    expect(prisma.metricSnapshot.create.mock.calls[0][0].data.measurementWindow)
      .toBe(MEASUREMENT_WINDOW.DAILY);
    for (const op of Object.values(prisma.outcomeSnapshot)) {
      expect(op).not.toHaveBeenCalled();
    }
  });
});
