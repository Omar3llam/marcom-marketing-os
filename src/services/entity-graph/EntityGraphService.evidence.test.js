// ============================================================
// R3.9 — EntityGraph asks the Evidence seam for its operational rows
// ------------------------------------------------------------
// The last consumer of the operational seam, and the only one that reads BOTH
// populations: operational rows for the Campaigns surface (this file), canonical
// CUMULATIVE_30D rows for the verdict path (selectCanonicalVerdictSnapshots,
// untouched here and asserted to stay separate).
//
// WHY THE PARITY BAR IS HIGHER HERE
// ---------------------------------
// Every field this query projects reaches a rendered row: `metricsOf` spreads
// the whole snapshot into the campaign / ad-set / ad projection, null-where-
// absent. So a lost predicate does not throw — it renders a DIFFERENT NUMBER on
// the Campaigns surface, and the verdict engine reads that surface's inputs.
//
// The fake table below therefore applies the predicates, the projection, any
// ordering and any reduction, and the fixture is built so that a different row
// is waiting behind every narrowing: another workspace, the same entity id at
// ad-set level, a canonical row landed at the same sync, a row synced 200 days
// ago, and an actual-revenue row that must survive to overlay the platform one.
//
// The expected values are derived from the PRE-migration query semantics —
// old `where` clause, then effectiveByEntity — and written out by hand. One test
// (the literal reconstruction) re-issues that old query against the same table
// and asserts the seam returns the identical row set, so the hand-derivation is
// itself checked rather than trusted.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  prisma: {
    campaign:       { findMany: vi.fn(), findFirst: vi.fn() },
    adSet:          { findMany: vi.fn(), findFirst: vi.fn() },
    ad:             { findMany: vi.fn() },
    metricSnapshot: { findMany: vi.fn() },
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: h.prisma }));
vi.mock('../../utils/logger.js', () => ({ logger: h.logger }));

import { getConnectorCampaigns, getCampaignAdSets, METRIC_SELECT } from './EntityGraphService.js';

const WS  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WS2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const C1  = 'c1111111-1111-4111-8111-111111111111';
const C2  = 'c2222222-2222-4222-8222-222222222222';
const C9  = 'c9999999-9999-4999-8999-999999999999'; // nobody asks about this one
const A1  = 'a1111111-1111-4111-8111-111111111111';

// The operational allow-list, WRITTEN OUT rather than imported: an expectation
// built from the constant the query uses would agree with any change to it.
const OPERATIONAL_WINDOWS = ['LEGACY_UNKNOWN', 'ROLLING_WINDOW'];
// EntityGraph's bound is 90 days of SYNC RECENCY (TEMPORAL.entitySnapshotSyncRecencyDays).
const SYNC_RECENCY_DAYS = 90;

const NOW = Date.now();
const ago = (days) => new Date(NOW - days * 86_400_000);

const row = (over) => ({
  workspaceId: WS, entityLevel: 'CAMPAIGN', measurementWindow: 'ROLLING_WINDOW', source: 'META',
  spendMinor: 0, roas: null, ctr: null, frequency: null, reach: null, conversions: 0,
  revenueMinor: 0, impressions: 0, clicks: 0, currency: 'USD',
  actionMetrics: null, dailyBudgetMinor: null,
  ...over,
});

/**
 * Deliberately NOT in date order, and the OLDER of C1's two platform rows comes
 * FIRST — so "whichever row the database happened to return first" is a visibly
 * wrong answer rather than accidentally the right one.
 */
const TABLE = [
  // A — another workspace, and the newest row for C1 anywhere.
  row({ workspaceId: WS2, entityId: C1, date: ago(1), spendMinor: 12_345_678, roas: 42, currency: 'KWD' }),
  // B — the SAME entity id one level down, newer than the winner.
  row({ entityId: C1, entityLevel: 'ADSET', date: ago(2), spendMinor: 222_222, roas: 6.6, currency: 'JPY' }),
  // E — the canonical row Phase F lands beside the operational one, newer still.
  row({ entityId: C1, measurementWindow: 'CUMULATIVE_30D', date: ago(1), spendMinor: 111_111, roas: 9.9, currency: 'AED' }),
  // C — a campaign nobody asked about.
  row({ entityId: C9, date: ago(1), spendMinor: 99, roas: 3.14, currency: 'GBP' }),
  // G + H — C1's OLDER platform row, listed first of its eligible siblings.
  row({
    entityId: C1, date: ago(60), spendMinor: 100_000, roas: 0.5, ctr: 1.0, frequency: 2.0,
    reach: 12_345, conversions: 5, revenueMinor: 50_000, impressions: 5_000, clicks: 50,
    currency: 'EGP', actionMetrics: { lpv: 0.1 }, dailyBudgetMinor: 1_000,
  }),
  // The platform WINNER. I — reach/actionMetrics/dailyBudgetMinor are null here
  // on purpose: they must render as null, never as a fabricated 0, and if the
  // older row above ever wins they become non-null and say so.
  row({
    entityId: C1, date: ago(30), spendMinor: 900_000, roas: 1.1, ctr: 2.0, frequency: 8.0,
    reach: null, conversions: 50, revenueMinor: 990_000, impressions: 45_000, clicks: 900,
    currency: 'USD', actionMetrics: null, dailyBudgetMinor: null,
  }),
  // F — the GA4 actual that overlays revenue and the conversion count.
  row({
    entityId: C1, measurementWindow: 'LEGACY_UNKNOWN', source: 'GA4', date: ago(25),
    spendMinor: 0, conversions: 120, revenueMinor: 4_500_000, currency: 'USD',
  }),
  // D — C2's only operational row, synced 200 days ago: outside the bound.
  row({ entityId: C2, date: ago(200), spendMinor: 555_000, roas: 3.3, currency: 'SAR' }),
  // G(control) — a canonical row for C2 INSIDE the window. C2 must still render
  // "—": this row is the bait for a canonical fallback, not evidence.
  row({ entityId: C2, measurementWindow: 'CUMULATIVE_30D', date: ago(5), spendMinor: 333_000, roas: 7.7, currency: 'GBP' }),
  // J — the ad-set level case.
  row({
    entityId: A1, entityLevel: 'ADSET', date: ago(10), spendMinor: 30_000, roas: 2.2, ctr: 1.1,
    frequency: 3.0, reach: 7_000, conversions: 10, revenueMinor: 66_000, impressions: 3_000,
    clicks: 33, currency: 'USD',
  }),
  // F at ad-set level — a SHOPIFY actual carrying no conversion count.
  row({
    entityId: A1, entityLevel: 'ADSET', measurementWindow: 'LEGACY_UNKNOWN', source: 'SHOPIFY',
    date: ago(8), spendMinor: 0, conversions: 0, revenueMinor: 150_000, currency: 'USD',
  }),
];

/**
 * A fake `findMany` that behaves like the table: predicates, ordering, reduction
 * AND projection. A stub returning a fixed array would pass every control here.
 */
function fakeFindMany(args = {}) {
  const w = args.where ?? {};
  let rows = TABLE.filter((r) => {
    if ('workspaceId' in w && r.workspaceId !== w.workspaceId) return false;
    if ('entityLevel' in w && r.entityLevel !== w.entityLevel) return false;
    if (w.entityId?.in && !w.entityId.in.includes(r.entityId)) return false;
    if (w.measurementWindow?.in && !w.measurementWindow.in.includes(r.measurementWindow)) return false;
    if (w.date?.gte && r.date < w.date.gte) return false;
    // windowStart / windowEnd are real columns nothing populates yet. Applied
    // here so that reinterpreting the bound as a delivery period shows up as
    // "every row suddenly qualifies" rather than as an argument-only difference.
    if (w.windowStart?.gte && !(r.windowStart >= w.windowStart.gte)) return false;
    if (w.windowEnd?.gte && !(r.windowEnd >= w.windowEnd.gte)) return false;
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

  const fields = Object.keys(args.select ?? {}).filter((k) => args.select[k]);
  return Promise.resolve(rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]]))));
}

const CAMPAIGNS = [
  { id: C1, name: 'Always On', channel: 'META', objective: 'CONVERSIONS', externalId: '111', platformCreatedTime: ago(300), _count: { adSets: 2 } },
  { id: C2, name: 'Dormant',   channel: 'META', objective: 'TRAFFIC',     externalId: '222', platformCreatedTime: ago(400), _count: { adSets: 0 } },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.campaign.findMany.mockResolvedValue(CAMPAIGNS);
  h.prisma.campaign.findFirst.mockResolvedValue(CAMPAIGNS[0]);
  h.prisma.adSet.findMany.mockResolvedValue([
    { id: A1, name: 'Broad', channel: 'META', status: 'ACTIVE', _count: { ads: 0 } },
  ]);
  h.prisma.ad.findMany.mockResolvedValue([]);
  h.prisma.metricSnapshot.findMany.mockImplementation(fakeFindMany);
});

const callAt = (level) =>
  h.prisma.metricSnapshot.findMany.mock.calls.find((c) => c[0].where.entityLevel === level)[0];
const rowFor = (rows, id) => rows.find((r) => r.entityId === id);

// ── The query EntityGraph now asks the seam for ─────────────────────────────

describe('R3.9 — the read EntityGraph issues', () => {
  it('is exactly the query it issued before the migration', async () => {
    await getConnectorCampaigns(WS);
    const args = callAt('CAMPAIGN');

    // HAND-WRITTEN, not assembled with the helper under test.
    expect(Object.keys(args).sort()).toEqual(['select', 'where']); // no orderBy key at all
    expect(args.select).toBe(METRIC_SELECT);
    expect(Object.keys(args.where).sort()).toEqual(
      ['date', 'entityId', 'entityLevel', 'measurementWindow', 'workspaceId'],
    );
    expect(args.where.workspaceId).toBe(WS);
    expect(args.where.entityLevel).toBe('CAMPAIGN');
    expect(args.where.entityId).toEqual({ in: [C1, C2] });
    expect(args.where.measurementWindow).toEqual({ in: OPERATIONAL_WINDOWS });
  });

  it('bounds `date` — the SYNC timestamp — at 90 days, and nothing else', async () => {
    await getConnectorCampaigns(WS);
    const { where } = callAt('CAMPAIGN');
    const expected = NOW - SYNC_RECENCY_DAYS * 86_400_000;
    // Within a second of the expected bound; the service computes it from
    // Date.now() at call time.
    expect(Math.abs(where.date.gte.getTime() - expected)).toBeLessThan(1_000);
    // R2's distinction, made structural: the bound is sync recency, NOT the
    // period the rows describe. Moving it to windowStart would silently
    // reinterpret 90 days of "when we pulled this" as 90 days of delivery.
    expect(where.windowStart).toBeUndefined();
    expect(where.windowEnd).toBeUndefined();
  });

  it('asks for NO ordering — the reducer compares dates itself', async () => {
    await getConnectorCampaigns(WS);
    expect(callAt('CAMPAIGN')).not.toHaveProperty('orderBy');
  });

  it('asks for no reduction and no source allow-list', async () => {
    await getConnectorCampaigns(WS);
    const args = callAt('CAMPAIGN');
    expect(args.distinct).toBeUndefined();
    expect(args.take).toBeUndefined();
    // GA4 / SHOPIFY / MANUAL rows are the overlay's whole input. An allow-list
    // here would blank actual revenue across the surface.
    expect(args.where.source).toBeUndefined();
  });

  it('projects METRIC_SELECT, and now projects its window provenance with it', async () => {
    await getConnectorCampaigns(WS);
    expect(callAt('CAMPAIGN').select).toBe(METRIC_SELECT);
    // R13-C inverts the Phase-C assertion that stood here. The boundary it was
    // guarding has NOT moved — what changed is which half of it the select
    // proves. Phase C used the absence of these columns as a proxy for "this
    // reader does not resolve by window"; that proxy also made the row unable to
    // say what period it covered, which is how an operational aggregate reached
    // a surface labelled "last 30 days".
    //
    // So the guard now states the real invariant directly (below), and the
    // columns are projected.
    expect(Object.keys(METRIC_SELECT)).toContain('measurementWindow');
    expect(Object.keys(METRIC_SELECT)).toContain('windowStart');
    expect(Object.keys(METRIC_SELECT)).toContain('windowEnd');
  });

  it('still does not RESOLVE by window — projecting a column is not reducing on it', async () => {
    await getConnectorCampaigns(WS);
    const args = callAt('CAMPAIGN');
    // The population is still the operational allow-list, applied at the seam —
    // not narrowed to one window because the column is now readable.
    expect(args.where.measurementWindow.in).not.toContain('CUMULATIVE_30D');
    expect(args.where.measurementWindow).not.toHaveProperty('not');
    // And the reduction is still effectiveByEntity over `date`. Nothing here
    // ranks, filters or prefers rows by measurementWindow — the moment it does,
    // this reader has silently become a second canonical resolver.
    // No ORDER BY reaches Postgres at all (the seam drops the explicit null),
    // so nothing can be ranked by window before effectiveByEntity sees it.
    expect(args.orderBy ?? null).toBeNull();
    expect(args.distinct).toBeUndefined();
  });

  it('asks ONCE per level — no evidence fallback behind it', async () => {
    // The only way a fallback is visible: a second read that widens the
    // population when the first comes back thin returns the same SHAPE, and
    // every assertion about the first call still passes.
    await getConnectorCampaigns(WS);
    expect(h.prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
  });

  it('does not read at all for an empty id list', async () => {
    h.prisma.campaign.findMany.mockResolvedValue([]);
    expect(await getConnectorCampaigns(WS)).toEqual([]);
    expect(h.prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});

// ── Literal reconstruction: the old query, re-issued ────────────────────────

describe('R3.9 — the seam returns what the old query returned', () => {
  it('row-for-row identical to a literal reconstruction of the pre-migration query', async () => {
    await getConnectorCampaigns(WS);
    const viaSeam = await h.prisma.metricSnapshot.findMany.mock.results[0].value;

    // The query as it was written in EntityGraphService before R3.9, typed out
    // here rather than imported, and run against the same table.
    const viaOldQuery = await fakeFindMany({
      where: {
        workspaceId: WS,
        entityLevel: 'CAMPAIGN',
        entityId: { in: [C1, C2] },
        date: { gte: new Date(NOW - SYNC_RECENCY_DAYS * 86_400_000) },
        measurementWindow: { in: OPERATIONAL_WINDOWS },
      },
      select: METRIC_SELECT,
    });

    expect(viaSeam).toEqual(viaOldQuery);
    expect(viaSeam).toHaveLength(3); // C1's two platform rows + the GA4 actual
  });
});

// ── Output parity: what the Campaigns surface renders ───────────────────────

describe('R3.9 — the rendered campaign rows are unchanged', () => {
  it('overlays the GA4 actual onto the LATEST platform row', async () => {
    const rows = await getConnectorCampaigns(WS);
    // Derived by hand from the old query + effectiveByEntity:
    //   platform winner = the ago(30) META row (not the ago(60) one listed first)
    //   actual          = the ago(25) GA4 row, NEWER than the platform row → fresh
    //   roas            = 4_500_000 / 900_000 = 5
    //   conversions     = 120, the actual's real count, over the platform's 50
    expect(rowFor(rows, C1)).toMatchObject({
      spendMinor: 900_000,      // the platform row's spend, not the actual's 0
      revenueMinor: 4_500_000,  // overlaid
      roas: 5,                  // re-derived, not the stored 1.1
      conversions: 120,
      ctr: 2.0, frequency: 8.0, impressions: 45_000, clicks: 900, currency: 'USD',
      revenueStale: false,
    });
  });

  it('keeps null metrics null — "—", never a fabricated 0', async () => {
    const rows = await getConnectorCampaigns(WS);
    const c1 = rowFor(rows, C1);
    // These are null ON THE WINNING ROW. The older row carries real values for
    // all three, so if the wrong row ever wins they stop being null.
    expect(c1.reach).toBeNull();
    expect(c1.actionMetrics).toBeNull();
    expect(c1.dailyBudgetMinor).toBeNull();
  });

  it('a campaign whose only sync is 200 days old renders no metrics at all', async () => {
    const rows = await getConnectorCampaigns(WS);
    const c2 = rowFor(rows, C2);
    expect(c2.spendMinor).toBeNull();
    expect(c2.roas).toBeNull();
    expect(c2.lastDate).toBeNull();
    // …and its canonical row, which IS inside the window, is not a substitute.
    expect(c2.roas).not.toBe(7.7);
    expect(c2.revenueStale).toBe(false);
    expect(c2.name).toBe('Dormant'); // the identity still renders; only metrics are absent
  });

  it('the losing rows are genuinely different answers, not near-misses', async () => {
    // Guards the fixture: if the rows a narrowing excludes carried the same
    // figures as the winner, every control would pass for the wrong reason.
    //
    // Scoped to the winner plus the four rows a LOST NARROWING would promote.
    // The GA4 actual is deliberately excluded from this check — it shares the
    // winner's currency because an account's actual revenue is in the account's
    // currency, and it is part of the correct answer rather than a rival to it.
    const winner   = TABLE.find((r) => r.entityId === C1 && r.spendMinor === 900_000);
    const promoted = TABLE.filter((r) => r.entityId === C1 && r.source === 'META' && r !== winner);
    expect(promoted).toHaveLength(4); // ws2, ADSET, CUMULATIVE_30D, the older platform row

    const rivals = [winner, ...promoted];
    expect(new Set(rivals.map((r) => r.spendMinor)).size).toBe(rivals.length);
    expect(new Set(rivals.map((r) => r.currency)).size).toBe(rivals.length);
    // …and every one of them is NEWER than the winner except the older platform
    // row, which is the one that wins if `date` stops being projected.
    expect(promoted.filter((r) => r.date > winner.date)).toHaveLength(3);
  });

  it('another tenant, another level and a canonical row are all invisible here', async () => {
    const rows = await getConnectorCampaigns(WS);
    const c1 = rowFor(rows, C1);
    expect(c1.spendMinor).not.toBe(12_345_678); // ws2
    expect(c1.spendMinor).not.toBe(222_222);    // ADSET
    expect(c1.spendMinor).not.toBe(111_111);    // CUMULATIVE_30D
    expect(c1.currency).toBe('USD');            // not KWD / JPY / AED
  });

  it('an entity nobody asked about never appears', async () => {
    const rows = await getConnectorCampaigns(WS);
    expect(rows.map((r) => r.entityId)).toEqual([C1, C2]);
    expect(rowFor(rows, C9)).toBeUndefined();
  });
});

// ── Output parity at ad-set level ───────────────────────────────────────────

describe('R3.9 — the ad-set drill-down is unchanged', () => {
  it('reads both levels, each narrowed to its own entities', async () => {
    await getCampaignAdSets(WS, C1);
    expect(h.prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(2);
    expect(callAt('CAMPAIGN').where.entityId).toEqual({ in: [C1] });
    expect(callAt('ADSET').where.entityId).toEqual({ in: [A1] });
    expect(callAt('ADSET').where.entityLevel).toBe('ADSET');
  });

  it('the ad-set overlays its SHOPIFY revenue but keeps the platform conversion count', async () => {
    const { adSets } = await getCampaignAdSets(WS, C1);
    // Hand-derived: base = the ago(10) META row; actual = the ago(8) SHOPIFY row
    // (fresh, since it is newer). revenue overlays, roas = 150_000 / 30_000 = 5.
    // The actual's conversions is 0, which is NOT a real count, so the platform
    // row's 10 stands — an actual without a conversions column must never erase
    // a pixel that IS counting.
    expect(adSets[0]).toMatchObject({
      entityId: A1, spendMinor: 30_000, revenueMinor: 150_000, roas: 5,
      conversions: 10, ctr: 1.1, frequency: 3.0, reach: 7_000, revenueStale: false,
    });
  });

  it('the campaign baseline in the drill-down is the same row the list showed', async () => {
    const [{ entity }, listRows] = [await getCampaignAdSets(WS, C1), await getConnectorCampaigns(WS)];
    expect(entity.spendMinor).toBe(rowFor(listRows, C1).spendMinor);
    expect(entity.roas).toBe(rowFor(listRows, C1).roas);
  });
});

// ── Operational failure truth: no metrics-absence fallback ──────────────────

describe('R3.9 / SC-18C — snapshot failures remain failures', () => {
  it('propagates snapshot failure without publishing metric-less identities or logging twice', async () => {
    const error = new Error('db down');
    h.prisma.metricSnapshot.findMany.mockRejectedValue(error);
    await expect(getConnectorCampaigns(WS)).rejects.toBe(error);
    expect(h.logger.debug).not.toHaveBeenCalled(); // the route owns terminal logging
  });

  it('a child snapshot failure rejects even when parent metrics were read successfully', async () => {
    const error = new Error('db down');
    h.prisma.metricSnapshot.findMany.mockImplementation(({ where }) =>
      where.entityLevel === 'ADSET' ? Promise.reject(error) : Promise.resolve([]));
    await expect(getCampaignAdSets(WS, C1)).rejects.toBe(error);
    expect(h.logger.debug).not.toHaveBeenCalled();
  });

  it('the seam itself does not swallow — the rejection has to reach this file', async () => {
    // A catch at the shared seam would silently give unrelated consumers the
    // same false absence. Keep the selector's rejection intact.
    const { selectOperationalSnapshots } = await import('../evidence/index.js');
    h.prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
    await expect(selectOperationalSnapshots(WS, { select: METRIC_SELECT })).rejects.toThrow('db down');
  });
});

// ── The canonical population stays a different question ─────────────────────

describe('R3.9 — operational and canonical remain two seams', () => {
  it('the operational read never asks for CUMULATIVE_30D, in either direction', async () => {
    await getConnectorCampaigns(WS);
    for (const [args] of h.prisma.metricSnapshot.findMany.mock.calls) {
      expect(args.where.measurementWindow.in).not.toContain('CUMULATIVE_30D');
      expect(args.where.measurementWindow).not.toHaveProperty('not');
    }
  });

  it('an empty operational result is returned as empty, never widened (I4)', async () => {
    // C2 has a canonical row inside the window and no operational one. The
    // honest answer is "no metrics", and one query is the proof that nothing
    // went looking for a second population to fill the gap.
    h.prisma.campaign.findMany.mockResolvedValue([CAMPAIGNS[1]]);
    const rows = await getConnectorCampaigns(WS);
    expect(rows[0].spendMinor).toBeNull();
    expect(h.prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
  });
});
