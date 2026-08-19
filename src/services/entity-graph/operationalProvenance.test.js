// ============================================================
// R13-C — an operational metric now says what period it covers
// ============================================================
// The audit's root finding: Overview rendered "Total spend · last 30 days" over
// rows that were rolling aggregates of whatever the last sync requested —
// `maximum` (~37 months) from the Sync button, `last_90d` from cron. Nothing in
// the payload could contradict the label, because the reader did not project the
// column that would have.
//
// A measurement without a period is not a fact. These three fields are what let
// a consumer state one, or decline to.
//
// WHAT THIS FILE DOES NOT PERMIT: promoting an operational row into a canonical
// one. The population, the filter and the reduction are unchanged and separately
// pinned in EntityGraphService.evidence.test.js. Projecting a column is not
// reinterpreting the row.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { METRIC_SELECT } from './EntityGraphService.js';
import { toCampaignRow, toAdSetRow, toAdRow } from './entityGraphEngine.js';

const WINDOW_FIELDS = ['measurementWindow', 'windowStart', 'windowEnd'];

const snap = (over = {}) => ({
  entityId: 'c1', date: new Date('2026-08-19T00:00:00Z'), source: 'META',
  spendMinor: 100_000, roas: 2, ctr: 0.016, frequency: 2.1, currency: 'EGP',
  measurementWindow: 'ROLLING_WINDOW',
  windowStart: new Date('2023-07-01T00:00:00Z'),
  windowEnd: new Date('2026-08-19T00:00:00Z'),
  ...over,
});
const campaign = { id: 'c1', name: 'Eid', channel: 'META', adSetCount: 2 };

describe('the operational read projects its window provenance', () => {
  it('selects all three columns', () => {
    for (const f of WINDOW_FIELDS) expect(METRIC_SELECT).toHaveProperty(f, true);
  });

  it('carries them onto a campaign row', () => {
    const row = toCampaignRow(campaign, snap());
    expect(row.measurementWindow).toBe('ROLLING_WINDOW');
    expect(row.windowStart).toEqual(new Date('2023-07-01T00:00:00Z'));
    expect(row.windowEnd).toEqual(new Date('2026-08-19T00:00:00Z'));
  });

  it('carries them at every level — ad sets and ads are measurements too', () => {
    for (const row of [
      toAdSetRow({ id: 'as1', channel: 'META', name: 'AS' }, snap()),
      toAdRow({ id: 'ad1', channel: 'META', name: 'AD' }, snap()),
    ]) {
      expect(row.measurementWindow).toBe('ROLLING_WINDOW');
      expect(row.windowEnd).toBeInstanceOf(Date);
    }
  });
});

describe('absence stays absence', () => {
  it('no snapshot ⇒ null window, matching the null metrics beside it', () => {
    const row = toCampaignRow(campaign, undefined);
    expect(row.spendMinor).toBeNull();
    for (const f of WINDOW_FIELDS) expect(row[f]).toBeNull();
  });

  it('unreported bounds stay null — `lastDate` is NOT a substitute', () => {
    // `date` is the SYNC timestamp. Reading it as a window end is exactly the
    // substitution that made a three-year aggregate look like a recent one.
    const row = toCampaignRow(campaign, snap({ windowStart: null, windowEnd: null }));
    expect(row.measurementWindow).toBe('ROLLING_WINDOW'); // the column is NOT NULL
    expect(row.windowStart).toBeNull();
    expect(row.windowEnd).toBeNull();
    expect(row.lastDate).toEqual(new Date('2026-08-19T00:00:00Z')); // present, and different
    expect(row.windowEnd).not.toEqual(row.lastDate);
  });

  it('LEGACY_UNKNOWN travels verbatim — it is an answer, not a gap', () => {
    // Pre-Phase-C rows say "nobody recorded what period this covers". Coercing
    // that to ROLLING_WINDOW would invent provenance; coercing it to null would
    // lose the distinction between "unrecorded" and "no row at all".
    const row = toCampaignRow(campaign, snap({ measurementWindow: 'LEGACY_UNKNOWN' }));
    expect(row.measurementWindow).toBe('LEGACY_UNKNOWN');
  });
});

describe('projecting is not promoting', () => {
  it('never rewrites an operational window into the canonical one', () => {
    const row = toCampaignRow(campaign, snap());
    expect(row.measurementWindow).not.toBe('CUMULATIVE_30D');
  });

  it('reports a canonical row as canonical when it genuinely is one', () => {
    // The same projection serves the canonical reader. It states what the row
    // says — in both directions, which is the whole point of stating it.
    const row = toCampaignRow(campaign, snap({ measurementWindow: 'CUMULATIVE_30D' }));
    expect(row.measurementWindow).toBe('CUMULATIVE_30D');
  });
});

describe('the fields are additive', () => {
  let row;
  beforeEach(() => { row = toCampaignRow(campaign, snap()); });

  it('leaves every existing metric exactly where it was', () => {
    expect(row).toMatchObject({
      entityId: 'c1', name: 'Eid', channel: 'META',
      spendMinor: 100_000, roas: 2, ctr: 0.016, frequency: 2.1, currency: 'EGP',
    });
  });

  it('adds nothing that could be read as a metric', () => {
    // A window is provenance, not a number to sum. If one of these ever becomes
    // numeric, a consumer aggregating "every numeric field" would silently add it.
    for (const f of WINDOW_FIELDS) expect(typeof row[f]).not.toBe('number');
  });
});

describe('the select stays a projection', () => {
  it('is a plain object of booleans — nothing here can smuggle in a filter', () => {
    for (const [k, v] of Object.entries(METRIC_SELECT)) {
      expect(typeof v, `${k} must be a plain boolean projection`).toBe('boolean');
    }
  });
});
