// ============================================================
// R3.8 — RevenueCsv asks the Evidence seam for the row it attaches to
// ------------------------------------------------------------
// RevenueCsv is the first migrated consumer that also WRITES MetricSnapshot
// rows, and the two halves must not be confused: the read moved to the seam, the
// write did not move anywhere. Everything asserted here is about the read.
//
// WHY THIS READ IS LOAD-BEARING, IN ONE SENTENCE
// ----------------------------------------------
// The uploaded revenue does not carry a date or (necessarily) a currency — it
// BORROWS both from the latest operational campaign snapshot — so every
// narrowing in this query decides which row's `date` and `currency` a human's
// revenue figure is stamped with. A wrong narrowing does not produce an error;
// it produces a MANUAL row aligned to the wrong measurement, which the overlay
// then reads back as though it belonged there.
//
// That is why this file does not stop at Prisma-argument assertions. The fake
// table below applies the predicates, the ordering AND the projection to a
// fixture built so that each narrowing has a DIFFERENT row waiting behind it:
// remove the workspace scope and another tenant's row wins; remove the level and
// an ad-set wins; remove the window filter and a canonical row wins; take the
// seam's default ordering and the OLDEST row wins. Each of those is a different
// date and a different currency in the written row.
//
// The one honest exception is `entityIds`, and it is called out at its control:
// the reducer keys by entityId, so rows for entities nobody asked about are
// inert and cannot move an output. It is covered structurally, and said so.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    campaign:       { findMany: vi.fn() },
    metricSnapshot: { findMany: vi.fn(), upsert: vi.fn((args) => Promise.resolve(args)) },
    $transaction:   vi.fn((ops) => Promise.all(ops)),
  },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { processRevenueCsv } from './RevenueCsvService.js';
import { OPERATIONAL_WINDOW_FILTER } from '../connectors/connectorTypes.js';

const WS = 'ws1';

// The operational window allow-list, WRITTEN OUT rather than imported into the
// expectation below — importing the constant the production query uses would
// make the assertion agree with itself.
const OPERATIONAL_WINDOWS = ['LEGACY_UNKNOWN', 'ROLLING_WINDOW'];

// The projection RevenueCsv needs, hand-listed. Three fields, three consumers:
//   entityId  → the key of the latest-per-entity map, looked up by campaign.id
//   date      → stamped onto the MANUAL row (`date: latest.date`)
//   currency  → the fallback when the CSV row names no currency
const REQUIRED_PROJECTION = { entityId: true, date: true, currency: true };

const CAMPAIGNS = [
  { id: 'u1', name: 'Alpha Campaign', externalId: '111' },
  { id: 'u2', name: 'Beta Campaign',  externalId: '222' },
  { id: 'u3', name: 'Gamma Campaign', externalId: '333' }, // no snapshots at all
];

const d = (iso) => new Date(iso);

/**
 * The fixture table, deliberately NOT in date order — the query's `orderBy` is
 * what has to produce the ordering, so a pre-sorted fixture would make the
 * ordering untestable. Every row exists to be picked by exactly one mutation.
 */
const TABLE = [
  // u1 — the older platform row. Wins if the ordering is lost.
  { workspaceId: WS,    entityId: 'u1', entityLevel: 'CAMPAIGN', measurementWindow: 'ROLLING_WINDOW', source: 'META',  date: d('2026-07-01T00:00:00Z'), currency: 'EGP' },
  // u1 — the TRUE latest: a GA4 actual, which is operational and non-platform.
  // Wins today. Lost the moment anyone adds a platform source allow-list.
  { workspaceId: WS,    entityId: 'u1', entityLevel: 'CAMPAIGN', measurementWindow: 'LEGACY_UNKNOWN', source: 'GA4',   date: d('2026-07-20T00:00:00Z'), currency: 'SAR' },
  // another workspace, newest of all — wins if the workspace scope is lost.
  { workspaceId: 'ws2', entityId: 'u1', entityLevel: 'CAMPAIGN', measurementWindow: 'ROLLING_WINDOW', source: 'META',  date: d('2026-08-05T00:00:00Z'), currency: 'KWD' },
  // same entity id at AD-SET level — wins if the level narrowing is lost.
  { workspaceId: WS,    entityId: 'u1', entityLevel: 'ADSET',    measurementWindow: 'ROLLING_WINDOW', source: 'META',  date: d('2026-08-01T00:00:00Z'), currency: 'USD' },
  // the canonical 30-day row — wins if the window allow-list is lost.
  { workspaceId: WS,    entityId: 'u1', entityLevel: 'CAMPAIGN', measurementWindow: 'CUMULATIVE_30D', source: 'META',  date: d('2026-08-03T00:00:00Z'), currency: 'JPY' },
  // an entity nobody uploaded revenue for.
  { workspaceId: WS,    entityId: 'u9', entityLevel: 'CAMPAIGN', measurementWindow: 'ROLLING_WINDOW', source: 'META',  date: d('2026-08-04T00:00:00Z'), currency: 'USD' },
  // u2 — synced long ago. Disappears entirely if a `since` bound is introduced.
  { workspaceId: WS,    entityId: 'u2', entityLevel: 'CAMPAIGN', measurementWindow: 'ROLLING_WINDOW', source: 'META',  date: d('2025-03-01T00:00:00Z'), currency: 'USD' },
  { workspaceId: WS,    entityId: 'u2', entityLevel: 'CAMPAIGN', measurementWindow: 'ROLLING_WINDOW', source: 'META',  date: d('2025-03-02T00:00:00Z'), currency: 'AED' },
];

/**
 * A fake `findMany` that behaves like the table rather than like a stub: it
 * applies the predicates, the ordering, any reduction AND the projection. That
 * is what lets a mutation move an OUTPUT instead of only an argument — a stub
 * returning a fixed array would pass every control in this file.
 */
function fakeFindMany(args = {}) {
  const w = args.where ?? {};
  let rows = TABLE.filter((r) => {
    if ('workspaceId' in w && r.workspaceId !== w.workspaceId) return false;
    if ('entityLevel' in w && r.entityLevel !== w.entityLevel) return false;
    if (w.entityId?.in && !w.entityId.in.includes(r.entityId)) return false;
    if (w.measurementWindow?.in && !w.measurementWindow.in.includes(r.measurementWindow)) return false;
    if (w.date?.gte && r.date < w.date.gte) return false;
    if (w.source?.in && !w.source.in.includes(r.source)) return false;
    return true;
  });

  if (args.orderBy?.date) {
    const dir = args.orderBy.date === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => dir * (a.date - b.date));
  }
  if (args.distinct) {
    const seen = new Set();
    rows = rows.filter((r) => {
      const k = args.distinct.map((f) => String(r[f])).join('|');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (typeof args.take === 'number') rows = rows.slice(0, args.take);

  // The projection, applied. A field missing from `select` is missing from the
  // row, so "is this field still needed?" is answered by the output.
  const fields = Object.keys(args.select ?? {}).filter((k) => args.select[k]);
  return Promise.resolve(rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]]))));
}

// Two campaigns with revenue, one with none. Alpha names NO currency on purpose:
// its written currency can only come from the snapshot the query picked.
const ROWS = [
  { campaignIdentifier: 'Alpha Campaign', revenueAmount: '12,500' },
  { campaignIdentifier: 'Beta Campaign',  revenueAmount: '300', currency: 'EGP' },
  { campaignIdentifier: 'Gamma Campaign', revenueAmount: '99',  currency: 'USD' },
];

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.campaign.findMany.mockResolvedValue(CAMPAIGNS);
  prismaMock.metricSnapshot.findMany.mockImplementation(fakeFindMany);
});

const readArgs = () => prismaMock.metricSnapshot.findMany.mock.calls[0][0];
const written  = () => prismaMock.metricSnapshot.upsert.mock.calls.map((c) => c[0].create);
const writtenFor = (entityId) => written().find((r) => r.entityId === entityId);

// ── The query RevenueCsv now asks the seam for ──────────────────────────────

describe('R3.8 — the read RevenueCsv issues', () => {
  it('is exactly the query it issued before the migration', async () => {
    await processRevenueCsv(WS, ROWS);

    // HAND-WRITTEN, not built with the helper under test. If the expectation
    // were assembled by selectOperationalSnapshots it would agree with any
    // change made to it, which is the one thing this assertion must not do.
    expect(readArgs()).toEqual({
      where: {
        workspaceId:       WS,
        entityId:          { in: ['u1', 'u2', 'u3'] },
        entityLevel:       'CAMPAIGN',
        measurementWindow: { in: OPERATIONAL_WINDOWS },
      },
      select:  REQUIRED_PROJECTION,
      orderBy: { date: 'desc' },
    });
  });

  it('asks the database ONCE — no evidence fallback behind it', async () => {
    // The only way a fallback is visible. A second read that widens the
    // population when the first comes back thin returns the same SHAPE, and
    // every assertion about the first call's arguments still passes.
    await processRevenueCsv(WS, ROWS);
    expect(prismaMock.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
  });

  it('carries no temporal bound — an old campaign is still attachable', async () => {
    // RevenueCsv has never had a `since`, deliberately: a human uploading last
    // quarter's revenue for a campaign that stopped syncing in March must still
    // find a row to attach it to. R2's sync-recency work does not apply here.
    await processRevenueCsv(WS, ROWS);
    expect(readArgs().where.date).toBeUndefined();
    expect(readArgs().where.windowStart).toBeUndefined();
    expect(readArgs().where.windowEnd).toBeUndefined();
  });

  it('carries no source allow-list — an actual row is a legitimate anchor', async () => {
    await processRevenueCsv(WS, ROWS);
    expect(readArgs().where.source).toBeUndefined();
  });

  it('asks for no reduction — the seam returns the series, the caller reduces', async () => {
    await processRevenueCsv(WS, ROWS);
    expect(readArgs().distinct).toBeUndefined();
    expect(readArgs().take).toBeUndefined();
  });

  it('projects exactly the three fields it consumes, and no more', async () => {
    await processRevenueCsv(WS, ROWS);
    expect(readArgs().select).toEqual(REQUIRED_PROJECTION);
    // A select-less read would return every column including actionMetrics; the
    // seam refuses that by contract, and this pins the caller's side of it.
    expect(Object.keys(readArgs().select).sort()).toEqual(['currency', 'date', 'entityId']);
  });

  it('does not read at all when nothing matched', async () => {
    await processRevenueCsv(WS, [{ campaignIdentifier: 'Nothing Like This', revenueAmount: '5' }]);
    expect(prismaMock.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});

// ── Output parity: which row's date and currency the revenue borrows ────────

describe('R3.8 — the row the revenue attaches to is unchanged', () => {
  it('picks the latest operational CAMPAIGN row in THIS workspace', async () => {
    const res = await processRevenueCsv(WS, ROWS);

    // Expected values computed by hand from TABLE, not by re-running the query:
    //   u1 → 2026-07-20 / SAR  (the GA4 actual; newer than the 2026-07-01 META
    //        row, and the ws2 / ADSET / CUMULATIVE_30D rows are all ineligible)
    //   u2 → 2025-03-02 / AED  (the newer of its two rows)
    //   u3 → no rows at all → surfaced, never written
    expect(writtenFor('u1')).toMatchObject({
      entityId: 'u1', entityLevel: 'CAMPAIGN', source: 'MANUAL',
      date: d('2026-07-20T00:00:00Z'),
      currency: 'SAR',        // the CSV row named none — this came from the snapshot
      revenueMinor: 1_250_000, // 12,500 SAR × 100
      spendMinor: 0, cpaMinor: null,
    });
    expect(writtenFor('u2')).toMatchObject({
      date: d('2025-03-02T00:00:00Z'),
      currency: 'EGP',   // the CSV row named one — the CSV wins over the snapshot
      revenueMinor: 30_000,
    });
    expect(res).toMatchObject({ matched: 2, updated: 2 });
    expect(res.unmatched).toEqual([
      { identifier: 'Gamma Campaign', reason: 'no synced data yet — sync this channel first' },
    ]);
  });

  it('the losing rows are genuinely different answers, not near-misses', async () => {
    // Guards the fixture itself: if the rows a narrowing excludes carried the
    // same date and currency as the winner, every control below would pass for
    // the wrong reason and prove nothing.
    const u1 = TABLE.filter((r) => r.entityId === 'u1');
    expect(new Set(u1.map((r) => r.currency)).size).toBe(u1.length);
    expect(new Set(u1.map((r) => +r.date)).size).toBe(u1.length);
    // …and every ineligible row is NEWER than the winner, so any lost narrowing
    // changes the answer rather than being masked by the ordering.
    const winner = d('2026-07-20T00:00:00Z');
    for (const r of u1.filter((x) => x.currency !== 'SAR' && x.currency !== 'EGP')) {
      expect(r.date > winner).toBe(true);
    }
  });

  it('descending order is load-bearing: first-row-wins IS the reducer', async () => {
    // The seam's default is oldest-first. Inheriting it here would silently make
    // "latest" mean "oldest" — 2026-07-01/EGP instead of 2026-07-20/SAR — with
    // no error anywhere. This is why the migration passes `date: 'desc'`
    // explicitly rather than relying on the default.
    await processRevenueCsv(WS, ROWS);
    expect(readArgs().orderBy).toEqual({ date: 'desc' });
    expect(writtenFor('u1').date).toEqual(d('2026-07-20T00:00:00Z'));
    expect(writtenFor('u1').date).not.toEqual(d('2026-07-01T00:00:00Z'));
  });

  it('a canonical row cannot become the anchor (Phase G, through the seam)', async () => {
    // The CUMULATIVE_30D row is both newer and in a different currency. If it
    // ever wins, a human's revenue gets stamped with a 30-day cumulative row's
    // date and read back beside operational rows that never saw it.
    await processRevenueCsv(WS, ROWS);
    expect(writtenFor('u1').currency).not.toBe('JPY');
    expect(writtenFor('u1').date).not.toEqual(d('2026-08-03T00:00:00Z'));
  });

  it('another tenant\'s newer row cannot become the anchor (I2)', async () => {
    await processRevenueCsv(WS, ROWS);
    expect(writtenFor('u1').currency).not.toBe('KWD');
  });

  it('an AD-SET row sharing the entity id cannot become the anchor', async () => {
    await processRevenueCsv(WS, ROWS);
    expect(writtenFor('u1').currency).not.toBe('USD');
    expect(writtenFor('u1').date).not.toEqual(d('2026-08-01T00:00:00Z'));
  });

  it('every projected field is load-bearing in the written row', async () => {
    await processRevenueCsv(WS, ROWS);
    const w = writtenFor('u1');
    expect(w.entityId).toBe('u1');            // the map key resolved
    expect(w.date).toBeInstanceOf(Date);      // `date` survived the projection
    expect(w.currency).toBe('SAR');           // `currency` survived it too
    expect(w.date).not.toBeUndefined();
  });
});

// ── Error behaviour ─────────────────────────────────────────────────────────

describe('R3.8 — a failed read is not an empty upload', () => {
  it('propagates, rather than reporting every campaign as un-synced', async () => {
    prismaMock.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
    await expect(processRevenueCsv(WS, ROWS)).rejects.toThrow('db down');
  });

  it('and writes nothing when it fails', async () => {
    prismaMock.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
    await processRevenueCsv(WS, ROWS).catch(() => {});
    expect(prismaMock.metricSnapshot.upsert).not.toHaveBeenCalled();
  });
});

// ── The seam default, asserted from a consumer that DOES narrow ─────────────

describe('R3.8 — entityLevel is a caller\'s option, not the seam\'s policy', () => {
  it('RevenueCsv supplies it explicitly', async () => {
    await processRevenueCsv(WS, ROWS);
    expect(readArgs().where.entityLevel).toBe('CAMPAIGN');
  });

  it('the window allow-list is still the shared one, not a hand-rolled shape', async () => {
    await processRevenueCsv(WS, ROWS);
    expect(readArgs().where.measurementWindow).toBe(OPERATIONAL_WINDOW_FILTER);
    expect(readArgs().where.measurementWindow).not.toHaveProperty('not');
  });
});
