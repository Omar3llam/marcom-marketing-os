// ============================================================
// Canonical 30-day ingestion (Phase F) — the first CUMULATIVE_30D producer
// ------------------------------------------------------------
// The chain this proves, end to end and without a network:
//
//   canonical request (exactly 30 days, no time_increment)
//        → metaNormalize declares CUMULATIVE_30D
//        → toSnapshotRows persists it with Meta's own dates
//        → the Phase D resolver ACCEPTS it
//        → and still refuses every non-canonical row beside it
//
// The last test is the one that matters. Everything else is machinery; that one
// is the acceptance condition of the whole track — pressing Sync must not change
// what a verdict means.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import { canonicalInsightsParams, toMetaDay, CANONICAL_LEVEL_NAMES } from '../metaAdsService.js';
import { metaNormalize } from './normalize/metaNormalize.js';
import { toSnapshotRows } from './snapshotSink.js';
import { MEASUREMENT_WINDOW, CHANNEL } from './connectorTypes.js';
import {
  resolveCanonicalSnapshot, canonicalWindowBounds, inclusiveDays,
  RESOLUTION, REJECTION, CANONICAL_VERDICT_WINDOW_DAYS,
} from '../verdict-engine/metricWindow.js';

const NOW = new Date('2026-08-11T09:00:00Z');
const WS = 'ws-1';

/** A raw Meta insights row for the canonical window, as the API returns it. */
const metaRow = (over = {}) => ({
  campaign_id: 'c1', campaign_name: 'Always On',
  spend: '1000.00', impressions: '250000', clicks: '3000',
  reach: '50000', frequency: '5.0',
  actions: [{ action_type: 'purchase', value: '40' }],
  action_values: [{ action_type: 'purchase', value: '3000.00' }],
  date_start: '2026-07-13', date_stop: '2026-08-11', // exactly 30 days, inclusive
  ...over,
});

/** Run the real canonical path: normalize → persist-shape. */
const canonicalRows = (rows, { now = NOW } = {}) => {
  const { start, end } = canonicalWindowBounds(now);
  const normalized = metaNormalize({
    accountExternalId: 'act_1', currency: 'USD', date: now, rows,
    measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D,
    requestedWindowStart: start, requestedWindowEnd: end,
  });
  return toSnapshotRows(WS, CHANNEL.META, normalized);
};

/** The same rows through the OPERATIONAL path (whatever preset the trigger used). */
const operationalRows = (rows, { now = NOW } = {}) =>
  toSnapshotRows(WS, CHANNEL.META, metaNormalize({
    accountExternalId: 'act_1', currency: 'USD', date: now, rows,
  }));

const campaignOf = (rows) => rows.find((r) => r.entityLevel === 'CAMPAIGN');

// ── TESTS 1 + 2: the request itself ─────────────────────────────────────────
describe('TESTS 1–2 — the canonical request asks for 30 cumulative days', () => {
  it('1 · requests exactly the canonical window, inclusive both ends', () => {
    const p = canonicalInsightsParams('campaign', NOW);
    expect(p.level).toBe('campaign');
    expect(p.time_range).toEqual({ since: '2026-07-13', until: '2026-08-11' });
    expect(inclusiveDays(p.time_range.since, p.time_range.until)).toBe(CANONICAL_VERDICT_WINDOW_DAYS);
  });

  // The single property that separates this phase from daily ingestion. Its
  // absence is what makes the row cumulative — and therefore what makes reach
  // and frequency usable at all.
  it('2 · sends NO time_increment', () => {
    const p = canonicalInsightsParams('campaign', NOW);
    expect(p).not.toHaveProperty('time_increment');
    expect(Object.keys(p).sort()).toEqual(['level', 'time_range']);
  });

  it('the window slides with `now` and never restates the 30', () => {
    expect(canonicalInsightsParams('campaign', new Date('2026-09-01T00:00:00Z')).time_range)
      .toEqual({ since: '2026-08-03', until: '2026-09-01' });
    expect(toMetaDay(new Date('2026-08-11T23:59:00Z'))).toBe('2026-08-11');
  });

  // Not a preset. Phase F is explicitly NOT "set the cron to last_30d", because
  // that would leave the verdict window a property of a sync parameter.
  it('carries no date_preset at all', () => {
    expect(canonicalInsightsParams('campaign', NOW)).not.toHaveProperty('date_preset');
  });
});

// ── TEST 3: provenance ──────────────────────────────────────────────────────
describe('TEST 3 — the persisted row declares CUMULATIVE_30D with source dates', () => {
  it('declares the window and carries META\'s own period, not ours', () => {
    const row = campaignOf(canonicalRows([metaRow()]));
    expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
    expect(toMetaDay(row.windowStart)).toBe('2026-07-13');
    expect(toMetaDay(row.windowEnd)).toBe('2026-08-11');
    expect(inclusiveDays(row.windowStart, row.windowEnd)).toBe(30);
  });

  it('keeps sync time and measured period as separate facts', () => {
    const row = campaignOf(canonicalRows([metaRow()]));
    expect(row.date).toEqual(NOW);                    // when we synced
    expect(row.windowEnd).not.toEqual(row.date);      // what it measures
  });

  // Meta is authoritative. If it answers with a period we did not request, the
  // row lands with the REAL dates and the resolver refuses it — an honest
  // unusable row beats a corrected one.
  it('does NOT overwrite Meta\'s dates with the requested range when they disagree', () => {
    const row = campaignOf(canonicalRows([metaRow({ date_start: '2026-05-14', date_stop: '2026-08-11' })]));
    expect(toMetaDay(row.windowStart)).toBe('2026-05-14'); // Meta's answer, kept
    const r = resolveCanonicalSnapshot([row], { now: NOW });
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.rejected[0].reason).toBe(REJECTION.PROVENANCE_MISMATCH);
  });

  it('falls back to the requested range only when Meta reports no dates', () => {
    const row = campaignOf(canonicalRows([metaRow({ date_start: undefined, date_stop: undefined })]));
    expect(toMetaDay(row.windowStart)).toBe('2026-07-13');
    expect(resolveCanonicalSnapshot([row], { now: NOW }).status).toBe(RESOLUTION.OK);
  });
});

// ── TESTS 4–6: the metrics ──────────────────────────────────────────────────
describe('TESTS 4–6 — metrics survive the canonical path unchanged', () => {
  it('4 · frequency is Meta\'s cumulative value, landed verbatim', () => {
    expect(campaignOf(canonicalRows([metaRow({ frequency: '5.0' })])).frequency).toBe(5.0);
  });

  it('5 · reach is Meta\'s cumulative unique count, landed verbatim', () => {
    expect(campaignOf(canonicalRows([metaRow({ reach: '50000' })])).reach).toBe(50_000);
  });

  // Both come from THIS request, so they are window-level by construction —
  // never summed or averaged out of daily rows, which cannot produce them.
  it('frequency and reach are consistent with the row\'s own impressions', () => {
    const row = campaignOf(canonicalRows([metaRow()]));
    expect(row.impressions / row.reach).toBeCloseTo(row.frequency, 1); // 250k/50k = 5.0
  });

  it('6 · additive metrics and the derived ratios are unchanged', () => {
    const row = campaignOf(canonicalRows([metaRow()]));
    expect(row.spendMinor).toBe(100_000);      // 1000.00
    expect(row.revenueMinor).toBe(300_000);    // 3000.00
    expect(row.impressions).toBe(250_000);
    expect(row.clicks).toBe(3000);
    expect(row.conversions).toBe(40);
    expect(row.roas).toBeCloseTo(3.0, 10);     // 300000/100000 — existing formula
    expect(row.ctr).toBeCloseTo(3000 / 250_000, 10);
  });
});

// ── TESTS 7–9: nothing else becomes verdict input ───────────────────────────
describe('TESTS 7–9 — non-canonical rows stay out of the verdict path', () => {
  const lifetime = metaRow({ date_start: '2023-07-01', date_stop: '2026-08-11', spend: '90000.00' });

  it('7 · a manual `maximum` row cannot satisfy the resolver', () => {
    const row = campaignOf(operationalRows([lifetime]));
    expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW);
    expect(resolveCanonicalSnapshot([row], { now: NOW }).status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
  });

  it('8 · a 90-day ROLLING_WINDOW row cannot satisfy the resolver', () => {
    const row = campaignOf(operationalRows([metaRow({ date_start: '2026-05-14' })]));
    const r = resolveCanonicalSnapshot([row], { now: NOW });
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.rejected[0].reason).toBe(REJECTION.NOT_CANONICAL);
  });

  it('9 · a historical LEGACY_UNKNOWN row is neither used nor relabeled', () => {
    const historical = {
      entityId: 'e1', source: 'META', measurementWindow: 'LEGACY_UNKNOWN',
      windowStart: null, windowEnd: null, date: new Date('2026-08-01'), spendMinor: 5000,
    };
    const r = resolveCanonicalSnapshot([historical], { now: NOW });
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(historical.measurementWindow).toBe('LEGACY_UNKNOWN'); // untouched
  });
});

// ── TESTS 10–11: repeated syncs and a sliding window ────────────────────────
describe('TESTS 10–11 — repeated syncs select, never accumulate', () => {
  it('10 · two canonical syncs of the same period yield one row, not a sum', () => {
    const a = campaignOf(canonicalRows([metaRow({ spend: '1000.00' })], { now: NOW }));
    const b = campaignOf(canonicalRows([metaRow({ spend: '1100.00' })],
      { now: new Date('2026-08-11T18:00:00Z') })); // same period, later sync
    expect(toMetaDay(a.windowEnd)).toBe(toMetaDay(b.windowEnd));
    const r = resolveCanonicalSnapshot([a, b], { now: new Date('2026-08-12T00:00:00Z') });
    expect(r.snapshot.spendMinor).toBe(110_000);   // the newer sync
    expect(r.snapshot.spendMinor).not.toBe(210_000); // never the sum
  });

  // The identity fix this phase required: the two rows differ ONLY in
  // measurementWindow, so before widening the unique key one silently
  // overwrote the other through the sink's upsert.
  it('a canonical row and the operational row from ONE sync are distinct rows', () => {
    const rows = [...canonicalRows([metaRow()]), ...operationalRows([metaRow({ date_start: '2026-05-14' })])];
    const campaigns = rows.filter((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaigns).toHaveLength(2);
    const key = (r) => [r.entityId, r.entityLevel, +r.date, r.granularity, r.source].join('|');
    expect(key(campaigns[0])).toBe(key(campaigns[1]));               // old key: identical
    expect(campaigns[0].measurementWindow).not.toBe(campaigns[1].measurementWindow); // new key: distinct
  });

  it('11 · when the window advances, the newer period is selected', () => {
    const older = campaignOf(canonicalRows([metaRow({ date_start: '2026-07-13', date_stop: '2026-08-11', spend: '1000.00' })], { now: NOW }));
    const newer = campaignOf(canonicalRows(
      [metaRow({ date_start: '2026-07-14', date_stop: '2026-08-12', spend: '1200.00' })],
      { now: new Date('2026-08-12T09:00:00Z') },
    ));
    const r = resolveCanonicalSnapshot([older, newer], { now: new Date('2026-08-13T00:00:00Z') });
    expect(r.snapshot.spendMinor).toBe(120_000);
    expect(toMetaDay(r.snapshot.windowEnd)).toBe('2026-08-12');
  });
});

// ── TEST 12: the resolver, against real ingested rows ───────────────────────
describe('TEST 12 — the resolver now has something to select', () => {
  it('a real canonical row resolves OK', () => {
    const r = resolveCanonicalSnapshot(canonicalRows([metaRow()]).filter((x) => x.entityLevel === 'CAMPAIGN'), { now: NOW });
    expect(r.status).toBe(RESOLUTION.OK);
    expect(r.snapshot.measurementWindow).toBe('CUMULATIVE_30D');
  });

  it('without one, it still refuses rather than substituting', () => {
    const r = resolveCanonicalSnapshot(operationalRows([metaRow()]).filter((x) => x.entityLevel === 'CAMPAIGN'), { now: NOW });
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.snapshot).toBeNull();
  });
});

// ── TEST 13 / §26: THE DECISIVE ONE ─────────────────────────────────────────
describe('TEST 13 — the verdict input does not move when you press Sync', () => {
  // Campaign X, as §26 specifies. The canonical row says one thing; the rows a
  // manual `maximum` or a cron `last_90d` sync would leave beside it say
  // something very different — a ROAS below break-even and a frequency far past
  // the fatigue ceiling, i.e. KILL-shaped input.
  const canonical30d = campaignOf(canonicalRows([metaRow({
    spend: '1000.00', impressions: '250000', clicks: '3000', reach: '62500', frequency: '4.0',
    action_values: [{ action_type: 'purchase', value: '2000.00' }], // ROAS 2.0
  })]));
  const ninetyDay = campaignOf(operationalRows([metaRow({
    date_start: '2026-05-14', spend: '9000.00', frequency: '9.0',
    action_values: [{ action_type: 'purchase', value: '7200.00' }], // ROAS 0.8
  })]));
  const maximum = campaignOf(operationalRows([metaRow({
    date_start: '2023-07-01', spend: '90000.00', frequency: '8.0',
    action_values: [{ action_type: 'purchase', value: '99000.00' }], // ROAS 1.1
  })]));

  const inputOf = (rows) => resolveCanonicalSnapshot(rows, { now: new Date('2026-08-12T00:00:00Z') }).snapshot;

  it('resolves to the 30-day row in EVERY sync order', () => {
    const orders = [
      [canonical30d, ninetyDay, maximum],
      [maximum, ninetyDay, canonical30d],
      [ninetyDay, maximum, canonical30d],
      [maximum, canonical30d, ninetyDay],
    ];
    for (const rows of orders) {
      const input = inputOf(rows);
      expect(input.measurementWindow).toBe('CUMULATIVE_30D');
      expect(input.roas).toBeCloseTo(2.0, 10);
      expect(input.frequency).toBe(4.0);
    }
  });

  // Sync recency is the variable that used to decide everything. Sweep it.
  it('stays the 30-day row however recently the others were synced', () => {
    for (const syncedAt of ['2026-08-11T23:00:00Z', '2026-08-11T23:59:59Z']) {
      const input = inputOf([
        canonical30d,
        { ...ninetyDay, date: new Date(syncedAt) },
        { ...maximum, date: new Date(syncedAt) },
      ]);
      expect(input.roas).toBeCloseTo(2.0, 10);
      expect(input.frequency).toBe(4.0);
    }
  });

  // The numbers matter because they sit on opposite sides of real thresholds:
  // BREAKEVEN_ROAS 1.0 and FATIGUE_FREQ 3.5. Reading the wrong row here is not a
  // rounding difference, it is a different verdict.
  it('the rejected rows would have produced a different decision', () => {
    expect(ninetyDay.roas).toBeLessThan(1.0);    // KILL-shaped
    expect(maximum.roas).toBeLessThan(2.0);
    expect(canonical30d.roas).toBeGreaterThan(1.0);
    expect(ninetyDay.frequency).toBeGreaterThan(canonical30d.frequency);
  });
});

// ════════════════════════════════════════════════════════════
// PHASE L — canonical ingestion at AD-SET and AD
// ------------------------------------------------------------
// Phase F produced canonical rows at CAMPAIGN only. Phase K then proved that is
// not enough: the fatigue paths observe `frequency` at ad-set and ad level, and
// a shared evidence contract cannot hold while two of three consumers have no
// canonical population to read.
//
// The property under test throughout is that all three levels describe the SAME
// 30 days with the SAME shape — not merely that three fetches happen.
// ════════════════════════════════════════════════════════════

/** A raw ad-set insights row. metaNormalize keys the level off the id fields. */
const adSetRow = (over = {}) => ({
  campaign_id: 'c1', campaign_name: 'Always On',
  adset_id: 'as1', adset_name: 'Cold · Broad',
  spend: '400.00', impressions: '90000', clicks: '1100',
  reach: '20000', frequency: '4.5',
  date_start: '2026-07-13', date_stop: '2026-08-11',
  ...over,
});

/** A raw ad insights row — carries ad_id AND adset_id (its parent link). */
const adRow = (over = {}) => ({
  campaign_id: 'c1', campaign_name: 'Always On',
  adset_id: 'as1', adset_name: 'Cold · Broad',
  ad_id: 'ad1', ad_name: 'Carousel #4',
  spend: '150.00', impressions: '30000', clicks: '420',
  reach: '9000', frequency: '3.3',
  date_start: '2026-07-13', date_stop: '2026-08-11',
  ...over,
});

const levelOf = (rows, level) => rows.filter((r) => r.entityLevel === level);

describe('PHASE L — canonical rows at every level the fatigue paths read', () => {
  // One canonical sync now returns campaign + ad-set + ad rows concatenated,
  // exactly as the operational fetch already does.
  const allLevels = () => canonicalRows([metaRow(), adSetRow(), adRow()]);

  it('1 · a campaign canonical row exists, unchanged from Phase F', () => {
    const c = levelOf(allLevels(), 'CAMPAIGN');
    expect(c).toHaveLength(1);
    expect(c[0].measurementWindow).toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
  });

  it('2 · an AD-SET canonical row exists', () => {
    const a = levelOf(allLevels(), 'ADSET');
    expect(a).toHaveLength(1);
    expect(a[0].measurementWindow).toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
  });

  it('3 · an AD canonical row exists', () => {
    const a = levelOf(allLevels(), 'AD');
    expect(a).toHaveLength(1);
    expect(a[0].measurementWindow).toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
  });

  it('4 · all three levels carry the IDENTICAL canonical window', () => {
    // The property that makes them one measurement rather than three. A window
    // computed per level would let a sync straddling midnight land two different
    // 30-day periods as if they described the same thing.
    const rows = allLevels().filter((r) => r.measurementWindow === MEASUREMENT_WINDOW.CUMULATIVE_30D);
    const starts = new Set(rows.map((r) => r.windowStart.getTime()));
    const ends = new Set(rows.map((r) => r.windowEnd.getTime()));
    expect(starts.size).toBe(1);
    expect(ends.size).toBe(1);
  });

  it('5 · every canonical level request sends time_range and NO time_increment', () => {
    for (const level of CANONICAL_LEVEL_NAMES) {
      const p = canonicalInsightsParams(level, NOW);
      expect(p.level).toBe(level);
      expect(p.time_range).toEqual({ since: '2026-07-13', until: '2026-08-11' });
      expect(p).not.toHaveProperty('time_increment');
    }
  });

  it('6 · every canonical level request states the period explicitly, never a preset', () => {
    for (const level of CANONICAL_LEVEL_NAMES) {
      const p = canonicalInsightsParams(level, NOW);
      expect(p).not.toHaveProperty('date_preset');
      expect(inclusiveDays(p.time_range.since, p.time_range.until)).toBe(CANONICAL_VERDICT_WINDOW_DAYS);
    }
  });

  it('covers exactly campaign, adset and ad — ACCOUNT is not a fetch level', () => {
    // The account row is DERIVED by summing campaigns. Asking Meta for it would
    // produce a second, differently-derived account figure with nothing to say
    // which one is right.
    expect([...CANONICAL_LEVEL_NAMES]).toEqual(['campaign', 'adset', 'ad']);
    expect(() => canonicalInsightsParams('account', NOW)).toThrow(/not a canonical level/);
  });

  it('8 · canonical provenance corroborates the requested period at every level', () => {
    const { start, end } = canonicalWindowBounds(NOW);
    for (const r of allLevels()) {
      expect(r.measurementWindow).toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
      expect(inclusiveDays(r.windowStart, r.windowEnd)).toBe(CANONICAL_VERDICT_WINDOW_DAYS);
      // Compared as DAYS, not timestamps: Phase F's rule is that META's dates
      // win, so the row carries Meta's midnight date_start/date_stop rather than
      // our request's wall-clock bounds. Asserting equal instants would pin the
      // opposite rule — that we overwrite what the platform reported.
      expect(toMetaDay(r.windowStart)).toBe(toMetaDay(start));
      expect(toMetaDay(r.windowEnd)).toBe(toMetaDay(end));
    }
  });

  it('9 · canonical and operational rows coexist at ad-set and ad level', () => {
    // Same entity, same sync moment, different measurement. Phase F widened the
    // key for campaigns; this proves the widening covers the new levels too.
    const canonical = allLevels();
    const operational = operationalRows([metaRow(), adSetRow(), adRow()]);
    for (const level of ['CAMPAIGN', 'ADSET', 'AD']) {
      const c = levelOf(canonical, level)[0];
      const o = levelOf(operational, level)[0];
      expect(c.entityId).toBe(o.entityId);              // same entity
      expect(c.date.getTime()).toBe(o.date.getTime());  // same sync stamp
      expect(c.measurementWindow).not.toBe(o.measurementWindow); // different key
    }
  });

  it('10 · a repeated canonical observation is the same row, not a second one', () => {
    // Idempotency comes from the natural key, not from de-duplication logic.
    const first = allLevels();
    const second = allLevels();
    const key = (r) => [r.entityId, r.entityLevel, r.date.getTime(), r.granularity, r.source, r.measurementWindow].join('|');
    expect(first.map(key).sort()).toEqual(second.map(key).sort());
    expect(new Set(first.map(key)).size).toBe(first.length); // no internal collisions
  });

  it('12 · an empty canonical response lands NOTHING — never a zero row', () => {
    // The dormant-entity case. A campaign that did not deliver in the canonical
    // window must have NO canonical row, not one asserting it spent nothing.
    expect(canonicalRows([])).toHaveLength(0);
  });

  it('13 · frequency is the cumulative value Meta returned, carried verbatim', () => {
    const rows = allLevels();
    expect(levelOf(rows, 'CAMPAIGN')[0].frequency).toBe(5.0);
    expect(levelOf(rows, 'ADSET')[0].frequency).toBe(4.5);
    expect(levelOf(rows, 'AD')[0].frequency).toBe(3.3);
    // Never derived: the ad-set value is NOT the mean of its ads, and the
    // campaign value is NOT the sum of its ad-sets.
    expect(levelOf(rows, 'ADSET')[0].frequency).not.toBe(levelOf(rows, 'AD')[0].frequency);
  });

  it('14 · reach is the cumulative unique-person count, carried verbatim', () => {
    const rows = allLevels();
    expect(levelOf(rows, 'CAMPAIGN')[0].reach).toBe(50000);
    expect(levelOf(rows, 'ADSET')[0].reach).toBe(20000);
    expect(levelOf(rows, 'AD')[0].reach).toBe(9000);
    // Emphatically not additive: the child levels do not sum to the parent.
    const childSum = levelOf(rows, 'ADSET')[0].reach + levelOf(rows, 'AD')[0].reach;
    expect(levelOf(rows, 'CAMPAIGN')[0].reach).not.toBe(childSum);
  });

  it('15 · ONE canonical sync produces all three levels together', () => {
    const rows = allLevels();
    const levels = new Set(rows.map((r) => r.entityLevel));
    expect(levels.has('CAMPAIGN')).toBe(true);
    expect(levels.has('ADSET')).toBe(true);
    expect(levels.has('AD')).toBe(true);
    // Plus the ACCOUNT rollup, which Phase F already produced — summed from
    // CAMPAIGNS ONLY, so the new levels cannot double-count into it.
    const account = levelOf(rows, 'ACCOUNT');
    expect(account).toHaveLength(1);
    expect(account[0].spendMinor).toBe(levelOf(rows, 'CAMPAIGN')[0].spendMinor);
  });
});
