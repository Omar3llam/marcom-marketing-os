// ============================================================
// Phase L — the canonical FETCH layer (pagination + failure isolation)
// ------------------------------------------------------------
// canonicalIngestion.test.js proves what canonical ROWS look like once Meta has
// answered. This file proves the two properties that live in the request layer
// and cannot be seen from a normalized row:
//
//   1. every page is consumed — an ad-set or ad account spanning three pages
//      must not land page one and look complete. Ad-set and ad rows outnumber
//      campaigns several-fold, so these are the levels that actually reach the
//      pagination limit, and a truncated canonical population presenting itself
//      as whole is the failure this track keeps correcting.
//
//   2. levels fail independently — one level erroring costs only its own rows.
//      The others keep their canonical evidence, and the missing level has NO
//      rows rather than fabricated empty ones.
//
// WHY NO SDK MOCK: metaAdsService loads the Meta SDK through createRequire (it
// ships as CommonJS), and vi.mock cannot intercept a createRequire call. A test
// that mocks 'facebook-nodejs-business-sdk' here does NOT take effect and makes
// real network requests instead — verified by watching this suite return
// "Invalid OAuth access token" from the live API. So pagination is tested
// against collectCursorPages, which is the code that actually walks the pages,
// and isolation through fetchCanonicalAllLevels' injection seam.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import {
  collectCursorPages, fetchCanonicalAllLevels, canonicalInsightsParams, CANONICAL_LEVEL_NAMES,
} from '../metaAdsService.js';
import { metaConnector } from './MetaConnector.js';
import { MEASUREMENT_WINDOW } from './connectorTypes.js';

const NOW = new Date('2026-08-11T09:00:00Z');

/**
 * A stand-in for the Meta SDK Cursor: an Array SUBCLASS mutated in place by
 * next(), with no fetchAll(). Modelled on the real thing deliberately — that
 * exact shape is what once made an `Array.isArray(cursor)` guard a silent
 * page-one-only read, because Array.isArray is true for an Array subclass.
 */
class FakeCursor extends Array {
  static of(pages) {
    const c = new FakeCursor();
    c._pages = pages;
    c._i = 0;
    c.push(...pages[0]);
    return c;
  }
  hasNext() { return this._i < this._pages.length - 1; }
  async next() {
    this._i += 1;
    this.length = 0;
    this.push(...this._pages[this._i]);
  }
}

const page = (level, n, p) =>
  Array.from({ length: n }, (_, i) => ({ [`${level}_id`]: `${level}-${p}-${i}`, spend: '1.00' }));

describe('TEST 7 — every page is consumed', () => {
  for (const level of ['adset', 'ad']) {
    it(`${level}: three pages → all rows collected, not just page one`, async () => {
      const cursor = FakeCursor.of([page(level, 2, 1), page(level, 2, 2), page(level, 1, 3)]);
      const { rows, pages } = await collectCursorPages(cursor);

      expect(rows).toHaveLength(5);
      expect(pages).toBe(3);
      // Rows from EVERY page, all distinct — not one page repeated three times.
      expect(new Set(rows.map((r) => r[`${level}_id`])).size).toBe(5);
      expect(rows.some((r) => String(r[`${level}_id`]).includes('-3-'))).toBe(true);
    });
  }

  it('a one-page cursor stops at one page — so the fixture can tell them apart', () => {
    // Guards the tests above: if a single page produced the same result, the
    // multi-page assertions would pass without proving anything.
    return collectCursorPages(FakeCursor.of([page('adset', 2, 1)])).then(({ rows, pages }) => {
      expect(rows).toHaveLength(2);
      expect(pages).toBe(1);
    });
  });

  it('the SDK envelope is unwrapped on every page, not only the first', async () => {
    const wrapped = (id) => ({ _data: { adset_id: id } });
    const { rows } = await collectCursorPages(FakeCursor.of([[wrapped('a')], [wrapped('b')]]));
    expect(rows).toEqual([{ adset_id: 'a' }, { adset_id: 'b' }]);
  });
});

describe('TEST 11 — levels fail independently', () => {
  const okLevel = (level, n) => async (_t, _a, { level: l }) =>
    (l === level ? { rows: page(l, n, 1), truncated: false } : (() => { throw new Error(`Meta unavailable for ${l}`); })());

  it('campaign and ad fail, ad-set succeeds → only ad-set rows, both failures named', async () => {
    const res = await fetchCanonicalAllLevels('tok', 'act_1', { now: NOW, fetchLevel: okLevel('adset', 3) });

    expect(res.rows).toHaveLength(3);
    expect(res.byLevel).toEqual({ adset: 3 });
    expect(res.failed.map((f) => f.level).sort()).toEqual(['ad', 'campaign']);
    // The failed levels contribute NOTHING — not an empty row, not a zero.
    expect(res.rows.every((r) => r.adset_id != null)).toBe(true);
  });

  it('a TOTAL failure throws — it must not look like an empty account', async () => {
    // The distinction this protects: "Meta answered, nothing delivered" and "we
    // could not read Meta" both produce zero rows, and only one of them means
    // the canonical population is genuinely empty. Returning an empty success
    // would report canonicalSnapshots: 0 for both. ConnectorSyncService already
    // runs the whole canonical refresh best-effort, so throwing here costs the
    // operational sync nothing.
    await expect(fetchCanonicalAllLevels('tok', 'act_1', {
      now: NOW, fetchLevel: async () => { throw new Error('token expired'); },
    })).rejects.toThrow(/failed at every level/);
  });

  it('an empty response is not a failure — it is zero canonical rows', async () => {
    // The dormant-account case: Meta answered, and the honest answer was nothing.
    const res = await fetchCanonicalAllLevels('tok', 'act_1', {
      now: NOW, fetchLevel: async () => ({ rows: [], truncated: false }),
    });
    expect(res.rows).toHaveLength(0);
    expect(res.failed).toHaveLength(0);
    expect(res.byLevel).toEqual({ campaign: 0, adset: 0, ad: 0 });
  });

  it('truncation at ANY level is reported for the whole refresh', async () => {
    const res = await fetchCanonicalAllLevels('tok', 'act_1', {
      now: NOW,
      fetchLevel: async (_t, _a, { level }) => ({ rows: [], truncated: level === 'ad' }),
    });
    expect(res.truncated).toBe(true);
  });
});

describe('one sync, one period, three levels', () => {
  const record = () => {
    const seen = [];
    return {
      seen,
      fetchLevel: async (_t, _a, { level, now }) => { seen.push({ level, now }); return { rows: [], truncated: false }; },
    };
  };

  it('requests all three canonical levels, in hierarchy order', async () => {
    const { seen, fetchLevel } = record();
    await fetchCanonicalAllLevels('tok', 'act_1', { now: NOW, fetchLevel });
    expect(seen.map((s) => s.level)).toEqual([...CANONICAL_LEVEL_NAMES]);
    expect([...CANONICAL_LEVEL_NAMES]).toEqual(['campaign', 'adset', 'ad']);
  });

  it('every level is asked for the IDENTICAL instant, so all three windows agree', async () => {
    // Computing the window per level would let a sync straddling midnight land
    // two different 30-day periods as if they described the same measurement.
    const { seen, fetchLevel } = record();
    await fetchCanonicalAllLevels('tok', 'act_1', { now: NOW, fetchLevel });
    expect(new Set(seen.map((s) => s.now.getTime())).size).toBe(1);
  });

  it('and the params built for each level carry the same period, no increment, no preset', () => {
    const ranges = CANONICAL_LEVEL_NAMES.map((level) => {
      const p = canonicalInsightsParams(level, NOW);
      expect(p).not.toHaveProperty('time_increment');
      expect(p).not.toHaveProperty('date_preset');
      return JSON.stringify(p.time_range);
    });
    expect(new Set(ranges).size).toBe(1);
    expect(JSON.parse(ranges[0])).toEqual({ since: '2026-07-13', until: '2026-08-11' });
  });

  it('ad-set and ad raise the page ceiling; campaign keeps Meta\'s default', () => {
    // Mirrors the operational fetches exactly — the levels with 3–10x the rows
    // ask for bigger pages so they reach MAX_PAGES later, not sooner.
    expect(canonicalInsightsParams('campaign', NOW)).not.toHaveProperty('limit');
    expect(canonicalInsightsParams('adset', NOW).limit).toBeGreaterThan(25);
    expect(canonicalInsightsParams('ad', NOW).limit).toBeGreaterThan(25);
  });
});

describe('the CONNECTOR declares the canonical window, not just the fixtures', () => {
  // Every other canonical test normalizes directly, passing the window in as a
  // fixture argument — which means none of them exercises what MetaConnector
  // actually declares. Changing normalizeCanonical to DAILY left the whole suite
  // green, so this closes that hole: the declaration is asserted where it is
  // MADE, not where it is supplied.
  const raw = (over = {}) => ({
    campaign_id: 'c1', campaign_name: 'Always On',
    spend: '10.00', impressions: '1000', clicks: '20',
    reach: '800', frequency: '1.25',
    date_start: '2026-07-13', date_stop: '2026-08-11',
    ...over,
  });

  it('normalizeCanonical stamps CUMULATIVE_30D on every level it produces', () => {
    const rows = metaConnector.normalizeCanonical({
      accountExternalId: 'act_1', accountName: 'A', currency: 'USD', date: NOW,
      rows: [raw(), raw({ adset_id: 'as1', adset_name: 'Cold' }), raw({ adset_id: 'as1', ad_id: 'ad1', ad_name: 'Carousel' })],
      windowStart: new Date('2026-07-13T00:00:00Z'),
      windowEnd: new Date('2026-08-11T00:00:00Z'),
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.measurementWindow).toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
    // And it really did produce the new levels, not campaigns three times.
    expect(new Set(rows.map((r) => r.entityLevel))).toEqual(new Set(['ACCOUNT', 'CAMPAIGN', 'ADSET', 'AD']));
  });

  it('the OPERATIONAL normalize still declares ROLLING_WINDOW — unchanged by Phase L', () => {
    const rows = metaConnector.normalize({
      accountExternalId: 'act_1', accountName: 'A', currency: 'USD', date: NOW, rows: [raw()],
    });
    for (const r of rows) expect(r.measurementWindow).toBe(MEASUREMENT_WINDOW.ROLLING_WINDOW);
  });
});
