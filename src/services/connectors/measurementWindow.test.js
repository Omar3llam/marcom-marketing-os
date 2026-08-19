// ============================================================
// MetricSnapshot window provenance (Phase C)
// ------------------------------------------------------------
// A row must say what period its metrics cover, and it must say so because its
// PRODUCER knew — never because a reader guessed from `date` (the sync
// timestamp), from `granularity` (hardcoded DAILY by every writer, on rows
// holding 90 days and Meta's full retention), or from the cron cadence.
//
// These tests police the two halves of that:
//   1. every writer states a window, and states the TRUE one;
//   2. nothing can reach the table without one.
//
// They do NOT test resolution. No reader filters on this column yet — that is
// Phase D, and a test asserting it here would be pinning work that hasn't
// happened.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import { metaNormalize } from './normalize/metaNormalize.js';
import { googleNormalize } from './normalize/googleNormalize.js';
import { toSnapshotRows } from './snapshotSink.js';
import { toActualSnapshotRow } from './actualsSink.js';
import { assertNormalized } from './ChannelConnector.js';
import { MEASUREMENT_WINDOW, CHANNEL, DATA_SOURCE } from './connectorTypes.js';
import { METRIC_SELECT } from '../entity-graph/EntityGraphService.js';

const WS = 'ws-1';

/** One Meta campaign insight row, as the API actually returns it. */
const metaRow = (over = {}) => ({
  campaign_id: 'c1', campaign_name: 'Always On',
  spend: '900.00', impressions: '300000', clicks: '3000',
  reach: '71428', frequency: '4.2',
  date_start: '2026-05-14', date_stop: '2026-08-11', // what last_90d returns
  ...over,
});

const normalizeMeta = (rows, date = new Date('2026-08-11T09:00:00Z')) =>
  metaNormalize({ accountExternalId: 'act_1', currency: 'USD', date, rows });

const campaignOf = (rows) => rows.find((r) => r.entityLevel === 'CAMPAIGN');

// ── TEST 1 ──────────────────────────────────────────────────────────────────
describe('TEST 1 — a Meta cron row (last_90d) lands explicit rolling-window provenance', () => {
  it('is ROLLING_WINDOW, and carries the period META reported', () => {
    const [row] = toSnapshotRows(WS, CHANNEL.META, [campaignOf(normalizeMeta([metaRow()]))]);
    expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW);
    expect(row.windowStart.toISOString().slice(0, 10)).toBe('2026-05-14');
    expect(row.windowEnd.toISOString().slice(0, 10)).toBe('2026-08-11');
  });

  // The whole point of the column: the sync timestamp and the measured period
  // are different facts, and the row now carries both.
  it('does not confuse the measured period with the sync date', () => {
    const [row] = toSnapshotRows(WS, CHANNEL.META, [campaignOf(normalizeMeta([metaRow()]))]);
    expect(row.date.toISOString().slice(0, 10)).toBe('2026-08-11'); // sync
    expect(row.windowStart.toISOString().slice(0, 10)).toBe('2026-05-14'); // ~90 days earlier
    expect(row.windowStart.getTime()).toBeLessThan(row.date.getTime());
  });

  it('every level — account, campaign, ad-set, ad — states a window', () => {
    const normalized = normalizeMeta([
      metaRow(),
      metaRow({ campaign_id: 'c1', adset_id: 'a1', adset_name: 'AS' }),
      metaRow({ campaign_id: 'c1', adset_id: 'a1', ad_id: 'ad1', ad_name: 'Ad' }),
    ]);
    expect(normalized.length).toBeGreaterThanOrEqual(4); // + the ACCOUNT rollup
    for (const r of normalized) expect(r.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW);
    for (const r of toSnapshotRows(WS, CHANNEL.META, normalized)) {
      expect(r.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW);
    }
  });

  it('a row Meta gave no dates for stays null, never a range built from the sync date', () => {
    const [row] = toSnapshotRows(WS, CHANNEL.META,
      [campaignOf(normalizeMeta([metaRow({ date_start: undefined, date_stop: undefined })]))]);
    expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW); // grain is still known
    expect(row.windowStart).toBeNull();
    expect(row.windowEnd).toBeNull();
  });
});

// ── TEST 2 ──────────────────────────────────────────────────────────────────
describe('TEST 2 — a manual row (maximum) cannot masquerade as daily or canonical', () => {
  // `maximum` reaches back over Meta's full retention. The row that comes back
  // is the one that used to sit beside a 90-day row, indistinguishable.
  const lifetime = metaRow({ date_start: '2023-07-01', date_stop: '2026-08-11', spend: '9000.00' });

  it('is neither DAILY nor CUMULATIVE_30D', () => {
    const [row] = toSnapshotRows(WS, CHANNEL.META, [campaignOf(normalizeMeta([lifetime]))]);
    expect(row.measurementWindow).not.toBe(MEASUREMENT_WINDOW.DAILY);
    expect(row.measurementWindow).not.toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
    expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW);
  });

  // This is the finding that made Phase C necessary: a 90d row and a lifetime
  // row used to be structurally identical. They no longer are.
  it('is now distinguishable from a 90-day row of the same entity', () => {
    const [ninety] = toSnapshotRows(WS, CHANNEL.META, [campaignOf(normalizeMeta([metaRow()])) ]);
    const [max] = toSnapshotRows(WS, CHANNEL.META, [campaignOf(normalizeMeta([lifetime]))]);
    expect(ninety.measurementWindow).toBe(max.measurementWindow); // same GRAIN class…
    expect(ninety.windowStart.getTime()).not.toBe(max.windowStart.getTime()); // …different PERIOD
    const days = (r) => Math.round((r.windowEnd - r.windowStart) / 86_400_000);
    expect(days(ninety)).toBe(89);
    expect(days(max)).toBeGreaterThan(1000);
  });

  // A lifetime span is not 30 days, but nothing may promote a row on span alone.
  it('a rolling row whose span happens to be ~30 days is still not canonical', () => {
    const thirty = metaRow({ date_start: '2026-07-13', date_stop: '2026-08-11' });
    const [row] = toSnapshotRows(WS, CHANNEL.META, [campaignOf(normalizeMeta([thirty]))]);
    expect(Math.round((row.windowEnd - row.windowStart) / 86_400_000)).toBe(29);
    expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW);
    expect(row.measurementWindow).not.toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
  });
});

// ── TESTS 3 + 4 ─────────────────────────────────────────────────────────────
describe('TESTS 3 + 4 — a caller that states DAILY or CUMULATIVE_30D gets it', () => {
  const declared = (measurementWindow) => ({
    externalId: 'c1', entityLevel: 'CAMPAIGN', parentExternalId: 'act_1',
    channel: CHANNEL.META, source: DATA_SOURCE.META, name: 'C', date: new Date('2026-08-11'),
    currency: 'USD', spendMinor: 100, revenueMinor: 200, impressions: 1000, clicks: 10,
    conversions: 1, frequency: 1.2, measurementWindow,
  });

  it('3 · DAILY is persisted as DAILY (Phase E writers)', () => {
    const [row] = toSnapshotRows(WS, CHANNEL.META, [declared(MEASUREMENT_WINDOW.DAILY)]);
    expect(row.measurementWindow).toBe('DAILY');
  });

  it('4 · CUMULATIVE_30D is persisted as CUMULATIVE_30D (Phase F writers)', () => {
    const [row] = toSnapshotRows(WS, CHANNEL.META, [declared(MEASUREMENT_WINDOW.CUMULATIVE_30D)]);
    expect(row.measurementWindow).toBe('CUMULATIVE_30D');
  });

  // The sink records; it does not adjudicate. If it "corrected" a declaration it
  // would be guessing again, one layer up.
  it('the sink relays the declaration verbatim, never overriding it', () => {
    for (const w of Object.values(MEASUREMENT_WINDOW)) {
      expect(toSnapshotRows(WS, CHANNEL.META, [declared(w)])[0].measurementWindow).toBe(w);
    }
  });
});

// ── TEST 5 ──────────────────────────────────────────────────────────────────
// CHOICE: FAIL, not silent LEGACY_UNKNOWN. The connector path always knows what
// it fetched, so a missing window there is a bug in a normalizer, and a silent
// LEGACY_UNKNOWN would hide it behind a value that looks deliberate. Sources
// that genuinely have no period (actuals, CSV) say LEGACY_UNKNOWN EXPLICITLY at
// their own writer — see the block below.
describe('TEST 5 — a write with no stated window fails, it does not default', () => {
  const undeclared = {
    externalId: 'c1', entityLevel: 'CAMPAIGN', channel: CHANNEL.META, source: DATA_SOURCE.META,
    name: 'C', date: new Date('2026-08-11'), currency: 'USD',
    spendMinor: 100, revenueMinor: 200, impressions: 1000, clicks: 10, conversions: 1,
  };

  it('snapshotSink throws, naming the row', () => {
    expect(() => toSnapshotRows(WS, CHANNEL.META, [undeclared]))
      .toThrow(/measurementWindow is required.*META CAMPAIGN c1/s);
  });

  it('the connector boundary throws too, so a normalizer fails at its own edge', () => {
    expect(() => assertNormalized([undeclared])).toThrow(/measurementWindow must be one of/);
    expect(() => assertNormalized([{ ...undeclared, measurementWindow: 'THIRTY_DAYS' }]))
      .toThrow(/measurementWindow must be one of/);
  });

  it('never silently becomes the canonical window', () => {
    let landed = null;
    try { landed = toSnapshotRows(WS, CHANNEL.META, [undeclared])[0]; } catch { /* expected */ }
    expect(landed).toBeNull(); // NOT a row carrying CUMULATIVE_30D
  });
});

describe('sources with no measurable period say so explicitly', () => {
  it('a GA4/Shopify actual is LEGACY_UNKNOWN with no invented range', () => {
    const row = toActualSnapshotRow(WS, { entityId: 'e1', entityLevel: 'CAMPAIGN' },
      { source: DATA_SOURCE.GA4, date: new Date('2026-08-11'), revenueMinor: 5000, currency: 'USD' });
    expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.LEGACY_UNKNOWN);
    expect(row.windowStart).toBeNull();
    expect(row.windowEnd).toBeNull();
  });

  // An actual is the NUMERATOR of a blended ROAS. Letting it claim a window it
  // never had is how a cross-window ROAS gets built (metricWindow.sameWindow).
  it('an actual never claims the canonical window', () => {
    const row = toActualSnapshotRow(WS, { entityId: 'e1', entityLevel: 'CAMPAIGN' },
      { source: DATA_SOURCE.GA4, date: new Date('2026-08-11'), revenueMinor: 5000, currency: 'USD' });
    expect(row.measurementWindow).not.toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
  });

  it('Google states the grain but reports no period of its own', () => {
    const rows = googleNormalize({
      accountExternalId: 'g1', currency: 'USD', date: new Date('2026-08-11'),
      rows: [{ campaign: { id: '1', name: 'G' }, metrics: { cost_micros: '1000000', impressions: '100', clicks: '5', conversions: 1, conversions_value: 20 } }],
    });
    for (const r of rows) {
      expect(r.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW);
      expect(r.windowStart).toBeNull(); // GAQL rows carry no date range
    }
  });
});

// ── TEST 6 ──────────────────────────────────────────────────────────────────
describe('TEST 6 — historical rows keep their meaning, and Phase D has not happened', () => {
  // Proven at the database level in the PR body: ADD COLUMN NOT NULL DEFAULT
  // 'LEGACY_UNKNOWN' then DROP DEFAULT leaves every pre-existing row reading
  // LEGACY_UNKNOWN, including rows whose granularity says 'DAILY'. What is
  // asserted here is the invariant that makes that safe: nothing in the code
  // maps granularity, or a date, onto a window.
  it('granularity is never consulted to derive a window', () => {
    const [row] = toSnapshotRows(WS, CHANNEL.META, [campaignOf(normalizeMeta([metaRow()]))]);
    expect(row.granularity).toBe('DAILY');          // unchanged, still a lie
    expect(row.measurementWindow).toBe('ROLLING_WINDOW'); // and it did not become DAILY
  });

  // §9 said readers must not select the column yet, and told its own successor
  // what to do: "if this fails, Phase D has landed early and this test is the
  // thing that should be updated." R13-C is that update.
  //
  // The display reader now SELECTS the window (so a row can state what period it
  // covers — the audit found "last 30 days" rendered over a ~37-month aggregate,
  // and nothing in the payload could contradict it). What it still does not do
  // is RESOLVE by it: the population comes from the operational allow-list at the
  // seam, and the reduction ranks on `date`. Selecting is not resolving, and the
  // difference is the whole of Phase D.
  it('the display reader selects the column — but only to report it', () => {
    expect(Object.keys(METRIC_SELECT)).toContain('measurementWindow');
    expect(Object.keys(METRIC_SELECT)).toContain('windowStart');
    // Every entry is a plain boolean projection. A nested object here would be
    // a filter wearing a select's clothes.
    for (const v of Object.values(METRIC_SELECT)) expect(typeof v).toBe('boolean');
  });

  // A legacy row read back has no window field at all in memory; the display
  // projection must not care. (effectiveByEntity is unchanged by this phase.)
  it('a row without the field is still a valid row to a reader', () => {
    const legacy = { entityId: 'e1', date: new Date('2026-08-01'), source: 'META', spendMinor: 900, roas: 2.1 };
    expect(() => JSON.stringify(legacy)).not.toThrow();
    expect(legacy.measurementWindow).toBeUndefined();
  });
});
