// ============================================================
// B5-01E · F-17 — the REAL writers' output, through the REAL eligibility path
// ============================================================
// The resolver's own suite proves its branch logic against rows a human wrote.
// That is the wrong instrument for one specific question: does the shape our
// PRODUCTION WRITERS actually emit survive the eligibility contract?
//
// A correction to the finding as filed. F-17 was recorded as "no writer-shape
// conformance coverage"; canonicalIngestion.test.js already runs raw Meta rows
// through metaNormalize → toSnapshotRows → resolveCanonicalSnapshot. The real
// gaps were narrower and both are covered here:
//
//   1. MISSING SOURCE BOUNDARY (T3). A missing date_stop stays unknown.
//      Request dates cannot establish the period the source observed.
//
//   2. GOOGLE. The Google canonical writer had no conformance coverage through
//      this path at all, and it is the writer whose boundaries are instants.
//
// Every row below comes out of the production normalizer. Nothing here builds a
// snapshot by hand.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));

import { metaNormalize } from './normalize/metaNormalize.js';
import { googleNormalize } from './normalize/googleNormalize.js';
import { toSnapshotRows } from './snapshotSink.js';
import { MEASUREMENT_WINDOW, CHANNEL } from './connectorTypes.js';
import {
  canonicalEligibility, canonicalWindowBounds, resolveCanonicalSnapshot,
  RESOLUTION, REJECTION,
} from '../verdict-engine/metricWindow.js';

const WS = 'ws-conformance';
const campaignOf = (rows) => rows.find((r) => r.entityLevel === 'CAMPAIGN');

/** Raw Meta insights row, as the API returns it. */
const rawMeta = (over = {}) => ({
  campaign_id: 'c1', campaign_name: 'Always On',
  spend: '1000.00', impressions: '250000', clicks: '3000',
  reach: '50000', frequency: '5.0',
  actions: [{ action_type: 'purchase', value: '40' }],
  action_values: [{ action_type: 'purchase', value: '3000.00' }],
  date_start: '2026-07-13', date_stop: '2026-08-11',
  ...over,
});

/** Raw Google GAQL row, as the client aggregates it. */
const rawGoogle = (over = {}) => ({
  campaign: { id: '77', name: 'Search Brand' },
  metrics: {
    cost_micros: '1000000000', impressions: '120000', clicks: '4000',
    conversions: 55, conversions_value: '9000.00',
  },
  ...over,
});

/** THE REAL META CANONICAL WRITER PATH. */
const metaCanonicalRows = (rows, now) => {
  const { start, end } = canonicalWindowBounds(now);
  return toSnapshotRows(WS, CHANNEL.META, metaNormalize({
    accountExternalId: 'act_1', currency: 'USD', date: now, rows,
    measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D,
    requestedWindowStart: start, requestedWindowEnd: end,
  }));
};

/** THE REAL GOOGLE CANONICAL WRITER PATH. */
const googleCanonicalRows = (rows, now) => {
  const { start, end } = canonicalWindowBounds(now);
  return toSnapshotRows(WS, CHANNEL.GOOGLE, googleNormalize({
    accountExternalId: '123-456', currency: 'USD', date: now, rows,
    measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D,
    windowStart: start, windowEnd: end,
  }));
};

// Every hour that mattered: the old rounding flipped at exactly 12:00 UTC.
const HOURS = ['00:01', '09:00', '11:59', '12:01', '18:00', '23:59'];

// ── META · both boundaries reported by the platform ──────────────────────────
describe('F-17 · Meta writer output — platform reported both dates', () => {
  it.each(HOURS)('is structurally eligible at %sZ', (hhmm) => {
    const now = new Date(`2026-08-11T${hhmm}:00.000Z`);
    const row = campaignOf(metaCanonicalRows([rawMeta()], now));

    expect(row.measurementWindow).toBe(MEASUREMENT_WINDOW.CUMULATIVE_30D);
    expect(canonicalEligibility(row, { now })).toEqual({ ok: true });
  });
});

// ── META · missing source boundary stays unknown (T3) ───────────────────────────
describe('F-17 · Meta writer output — date_stop absent, no requested-date substitution', () => {
  // Source date_start remains known; an unreported date_stop cannot be repaired
  // with a requested range or the sync clock. All six evaluation hours must refuse.
  const mixed = (now) => campaignOf(metaCanonicalRows([rawMeta({ date_stop: undefined })], now));

  it('preserves the reported start and leaves the missing end unknown', () => {
    const now = new Date('2026-08-11T18:00:00.000Z');
    const row = mixed(now);

    expect(row.windowStart.toISOString()).toBe('2026-07-13T00:00:00.000Z'); // Meta's midnight
    expect(row.windowEnd).toBeNull(); // Missing source evidence is not the sync instant.
  });

  it.each(HOURS)('refuses missing source dates at %sZ', (hhmm) => {
    const now = new Date(`2026-08-11T${hhmm}:00.000Z`);
    expect(canonicalEligibility(mixed(now), { now })).toEqual({ ok: false, reason: REJECTION.MISSING_PERIOD });
  });

  it('refuses to resolve an observation whose source end date is missing', () => {
    const now = new Date('2026-08-11T12:01:00.000Z');
    const r = resolveCanonicalSnapshot([mixed(now)], { now });

    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.snapshot).toBeNull();
    expect(r.rejected.map((x) => x.reason)).toEqual([REJECTION.MISSING_PERIOD]);
  });

  it('the missing boundary remains unknown when the same row is read later', () => {
    const written = new Date('2026-08-11T09:00:00.000Z');
    const row = mixed(written);
    for (const hhmm of ['09:00', '12:01', '23:59']) {
      const readAt = new Date(`2026-08-11T${hhmm}:00.000Z`);
      expect(canonicalEligibility(row, { now: readAt })).toEqual({ ok: false, reason: REJECTION.MISSING_PERIOD });
    }
  });
});

// ── GOOGLE · instant boundaries (F-15 at its source) ─────────────────────────
describe('F-17 · Google writer output — both boundaries are the sync instant', () => {
  const gRow = (now) => campaignOf(googleCanonicalRows([rawGoogle()], now));

  it('the writer really does emit instant boundaries (the premise)', () => {
    const now = new Date('2026-08-11T09:00:00.000Z');
    const row = gRow(now);

    expect(row.windowEnd.toISOString()).toBe(now.toISOString());
    expect(row.windowEnd.getUTCHours()).toBe(9); // NOT midnight — unlike Meta
  });

  it.each(HOURS)('is structurally eligible at %sZ', (hhmm) => {
    const now = new Date(`2026-08-11T${hhmm}:00.000Z`);
    expect(canonicalEligibility(gRow(now), { now })).toEqual({ ok: true });
  });

  it('F-15 · Meta and Google rows for the SAME period agree, against a day-aligned now', () => {
    // The asymmetry this closes: read against a day-aligned reference, Google's
    // instant windowEnd used to be FUTURE_PERIOD while Meta's midnight passed —
    // a provider's timestamp precision deciding structural validity.
    const written = new Date('2026-08-11T09:00:00.000Z');
    const dayAligned = new Date('2026-08-11T00:00:00.000Z');

    const google = gRow(written);
    const meta = campaignOf(metaCanonicalRows([rawMeta()], written));

    expect(canonicalEligibility(google, { now: dayAligned })).toEqual({ ok: true });
    expect(canonicalEligibility(meta, { now: dayAligned })).toEqual({ ok: true });
  });

  it('a genuinely future window is still refused — the guard was not removed', () => {
    const row = gRow(new Date('2026-08-11T09:00:00.000Z'));
    const yesterday = new Date('2026-08-10T23:00:00.000Z'); // row ends on a LATER day
    expect(canonicalEligibility(row, { now: yesterday }))
      .toEqual({ ok: false, reason: REJECTION.FUTURE_PERIOD });
  });
});

// ── The writers' rows must reach the resolver, not just the predicate ────────
describe('F-17 · both writers resolve through the real resolver', () => {
  it('a Meta row and a Google row each resolve to themselves', () => {
    const now = new Date('2026-08-11T18:00:00.000Z');
    for (const row of [campaignOf(metaCanonicalRows([rawMeta()], now)), campaignOf(googleCanonicalRows([rawGoogle()], now))]) {
      const r = resolveCanonicalSnapshot([row], { now });
      expect(r.status).toBe(RESOLUTION.OK);
      expect(r.snapshot).toBe(row);
    }
  });

  it('the OPERATIONAL output of the same writers is refused as NOT_CANONICAL', () => {
    const now = new Date('2026-08-11T09:00:00.000Z');
    const operational = campaignOf(toSnapshotRows(WS, CHANNEL.META, metaNormalize({
      accountExternalId: 'act_1', currency: 'USD', date: now, rows: [rawMeta()],
    })));

    expect(canonicalEligibility(operational, { now }))
      .toEqual({ ok: false, reason: REJECTION.NOT_CANONICAL });
  });
});
