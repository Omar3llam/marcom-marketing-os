// ============================================================
// Canonical window resolution (Phase D)
// ------------------------------------------------------------
// The selection rule that makes "30-day verdict" real. Every test here is
// ultimately one assertion in different clothes:
//
//     a row is eligible because of WHAT IT MEASURES,
//     never because of WHEN WE SYNCED IT.
//
// The hardest-working tests are the ones that prove there is NO FALLBACK. A
// resolver that quietly returns the 90-day row when no 30-day row exists is
// worse than one that returns nothing, because the wrong window is invisible
// downstream while an empty state is not.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  resolveCanonicalSnapshot, resolveCanonicalByStream, canonicalEligibility, inclusiveDays,
  RESOLUTION, REJECTION, CANONICAL_VERDICT_WINDOW_DAYS,
} from './metricWindow.js';
import { MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';

const NOW = new Date('2026-08-11T12:00:00Z');
const d = (s) => new Date(`${s}T00:00:00Z`);

/** A canonical 30-day row ending on `endDay` (inclusive both ends → 30 days). */
const canonical = (endDay, over = {}) => ({
  entityId: 'E1', source: 'META', measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D,
  windowStart: new Date(d(endDay).getTime() - 29 * 86_400_000),
  windowEnd: d(endDay),
  date: d(endDay), // sync time
  spendMinor: 1000, revenueMinor: 3000, impressions: 100_000, clicks: 900,
  conversions: 10, frequency: 5.0, reach: 20_000, ...over,
});

/** A non-canonical row: what every live sync actually produces today. */
const rolling = (over = {}) => ({
  entityId: 'E1', source: 'META', measurementWindow: MEASUREMENT_WINDOW.ROLLING_WINDOW,
  windowStart: d('2026-05-14'), windowEnd: d('2026-08-11'), date: d('2026-08-11'),
  spendMinor: 9000, frequency: 9.8, reach: 300_000, ...over,
});

const daily = (day, over = {}) => ({
  entityId: 'E1', source: 'META', measurementWindow: MEASUREMENT_WINDOW.DAILY,
  windowStart: d(day), windowEnd: d(day), date: d(day),
  spendMinor: 30, frequency: 1.3, reach: 7600, ...over,
});

const legacy = (over = {}) => ({
  entityId: 'E1', source: 'META', measurementWindow: MEASUREMENT_WINDOW.LEGACY_UNKNOWN,
  windowStart: null, windowEnd: null, date: d('2026-08-11'), spendMinor: 5000, ...over,
});

const resolve = (rows) => resolveCanonicalSnapshot(rows, { now: NOW });

// ── TESTS 1–3: the window decides, the sync date does not ───────────────────
describe('TESTS 1–3 — measurement window beats sync recency, always', () => {
  it('1 · a canonical row wins over a 90-day row', () => {
    const r = resolve([rolling(), canonical('2026-08-10')]);
    expect(r.status).toBe(RESOLUTION.OK);
    expect(r.snapshot.measurementWindow).toBe('CUMULATIVE_30D');
    expect(r.snapshot.spendMinor).toBe(1000); // not the rolling row's 9000
  });

  it('2 · …even when the 90-day row was synced LATER', () => {
    const r = resolve([
      rolling({ date: d('2026-08-11') }),        // newest sync
      canonical('2026-08-10', { date: d('2026-08-10') }),
    ]);
    expect(r.snapshot.measurementWindow).toBe('CUMULATIVE_30D');
    expect(r.snapshot.date).toEqual(d('2026-08-10')); // the OLDER sync won
  });

  it('3 · a `maximum` row cannot masquerade as canonical, however fresh', () => {
    const max = rolling({ windowStart: d('2023-07-01'), date: d('2026-08-11'), spendMinor: 900_000 });
    const r = resolve([max, canonical('2026-08-10')]);
    expect(r.snapshot.spendMinor).toBe(1000);
    expect(r.rejected.map((x) => x.reason)).toContain(REJECTION.NOT_CANONICAL);
  });
});

// ── TESTS 4–5: no fallback, ever ────────────────────────────────────────────
describe('TESTS 4–5 — no canonical row means no answer, not the nearest one', () => {
  it('4 · 90d + maximum + legacy together resolve to NO_CANONICAL_WINDOW', () => {
    const r = resolve([rolling(), rolling({ windowStart: d('2023-07-01') }), legacy()]);
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.snapshot).toBeNull();
    expect(r.rejected).toHaveLength(3);
  });

  it('5 · a DAILY row is rejected even when it is the newest thing present', () => {
    const r = resolve([daily('2026-08-11'), rolling({ date: d('2026-08-01') })]);
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.snapshot).toBeNull();
  });

  // The line this whole phase exists to prevent. If a future edit adds
  // `?? latestOf(rows)`, this is what catches it.
  it('returns null rather than ANY of the rows it was given', () => {
    const rows = [rolling(), daily('2026-08-11'), legacy()];
    const r = resolve(rows);
    expect(r.snapshot).toBeNull();
    for (const row of rows) expect(r.snapshot).not.toBe(row);
  });

  it('an empty input is NO_CANONICAL_WINDOW, not a throw', () => {
    for (const input of [[], null, undefined]) {
      expect(resolveCanonicalSnapshot(input, { now: NOW }).status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    }
  });
});

// ── TEST 6: overlapping canonical rows are selected between, never summed ───
describe('TEST 6 — overlapping canonical periods are never summed', () => {
  it('picks the most recently MEASURED period, and only one row', () => {
    const r = resolve([
      canonical('2026-08-08', { spendMinor: 100 }),
      canonical('2026-08-09', { spendMinor: 120 }),
    ]);
    expect(r.snapshot.spendMinor).toBe(120);
    expect(r.snapshot.spendMinor).not.toBe(220);
  });

  // Three 30-day windows a day apart share 29 days of delivery. Adding them
  // counts that delivery three times — #359's defect, one layer up.
  it('three overlapping windows still yield one row', () => {
    const r = resolve([
      canonical('2026-08-07', { spendMinor: 1000 }),
      canonical('2026-08-08', { spendMinor: 1100 }),
      canonical('2026-08-09', { spendMinor: 1200 }),
    ]);
    expect(r.snapshot.spendMinor).toBe(1200);
    expect(r.snapshot.spendMinor).not.toBe(3300);
  });

  it('is order-independent', () => {
    const rows = [canonical('2026-08-07', { spendMinor: 1000 }), canonical('2026-08-09', { spendMinor: 1200 }), canonical('2026-08-08', { spendMinor: 1100 })];
    for (const order of [rows, [...rows].reverse(), [rows[1], rows[0], rows[2]]]) {
      expect(resolve(order).snapshot.spendMinor).toBe(1200);
    }
  });
});

// ── TESTS 7–8: cumulative metrics are never reconstructed ───────────────────
describe('TESTS 7–8 — frequency and reach are never rebuilt from daily rows', () => {
  const week = [daily('2026-08-08', { frequency: 1.1, reach: 100 }),
                daily('2026-08-09', { frequency: 1.4, reach: 120 }),
                daily('2026-08-10', { frequency: 1.7, reach: 130 })];

  it('7 · daily frequencies produce neither their sum nor their mean', () => {
    const r = resolve(week);
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.snapshot).toBeNull();     // so neither 4.2 (Σ) nor 1.4 (mean)
    expect(JSON.stringify(r.snapshot)).not.toMatch(/4\.2|1\.4000/);
  });

  it('8 · daily reach is never summed into a cumulative reach', () => {
    const r = resolve(week);
    expect(r.snapshot).toBeNull();     // so not 350
  });

  // The structural guarantee behind both: the resolver SELECTS, it never
  // aggregates. There is no code path that combines two rows' metrics.
  it('a canonical row supplies frequency/reach verbatim — measured, not derived', () => {
    const r = resolve([canonical('2026-08-10', { frequency: 5.0, reach: 20_000 })]);
    expect(r.snapshot.frequency).toBe(5.0);
    expect(r.snapshot.reach).toBe(20_000);
  });
});

// ── TESTS 9–10 + 14: malformed, future, and contradicted periods ────────────
describe('TESTS 9, 10, 14 — an invalid period is rejected, never repaired', () => {
  it('9 · start after end is MALFORMED_PERIOD', () => {
    const bad = canonical('2026-08-10', { windowStart: d('2026-08-20') });
    const r = resolve([bad]);
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.rejected[0].reason).toBe(REJECTION.MALFORMED_PERIOD);
  });

  it('10 · a period ending in the future is FUTURE_PERIOD, not clamped to now', () => {
    const r = resolve([canonical('2026-09-30')]);
    expect(r.rejected[0].reason).toBe(REJECTION.FUTURE_PERIOD);
    expect(r.snapshot).toBeNull();
  });

  it('14 · declared CUMULATIVE_30D but the dates say 90 → PROVENANCE_MISMATCH', () => {
    const lying = canonical('2026-08-10', { windowStart: d('2026-05-13') }); // ~90 days
    const r = resolve([lying]);
    expect(r.rejected[0].reason).toBe(REJECTION.PROVENANCE_MISMATCH);
    expect(r.snapshot).toBeNull(); // NOT silently corrected to a 30-day read
  });

  it('14b · declared canonical with no dates at all is MISSING_PERIOD', () => {
    const r = resolve([canonical('2026-08-10', { windowStart: null, windowEnd: null })]);
    expect(r.rejected[0].reason).toBe(REJECTION.MISSING_PERIOD);
  });

  // The other direction, and it matters just as much: dates alone never qualify
  // a row. A rolling window can land on a 30-day span by pure coincidence.
  it('a ROLLING row whose span happens to be exactly 30 days is still rejected', () => {
    const coincidence = rolling({ windowStart: d('2026-07-13'), windowEnd: d('2026-08-11') });
    expect(inclusiveDays(coincidence.windowStart, coincidence.windowEnd)).toBe(30);
    const r = resolve([coincidence]);
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.rejected[0].reason).toBe(REJECTION.NOT_CANONICAL);
  });

  it('off by a single day is a different window', () => {
    expect(canonicalEligibility(canonical('2026-08-10', { windowStart: d('2026-07-13') }), { now: NOW }).ok).toBe(false);
    expect(canonicalEligibility(canonical('2026-08-10'), { now: NOW }).ok).toBe(true);
  });

  it('inclusiveDays counts both ends — 30, not 29', () => {
    expect(inclusiveDays(d('2026-07-13'), d('2026-08-11'))).toBe(CANONICAL_VERDICT_WINDOW_DAYS);
    expect(inclusiveDays(d('2026-08-11'), d('2026-08-11'))).toBe(1);
    expect(inclusiveDays(null, d('2026-08-11'))).toBeNull();
  });
});

// ── TESTS 11–13: identity and determinism ───────────────────────────────────
describe('TESTS 11–13 — stream identity and deterministic selection', () => {
  it('11 · entity A\'s canonical row never satisfies entity B', () => {
    const byStream = resolveCanonicalByStream([
      canonical('2026-08-10', { entityId: 'A', spendMinor: 111 }),
      rolling({ entityId: 'B' }),
    ], { now: NOW });
    expect(byStream.get('A|META').status).toBe(RESOLUTION.OK);
    expect(byStream.get('A|META').snapshot.spendMinor).toBe(111);
    expect(byStream.get('B|META').status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(byStream.get('B|META').snapshot).toBeNull();
  });

  // A GA4 actual and a META platform row are independent measurements. If a GA4
  // row could satisfy a META request, a canonical ROAS could be built from an
  // actual numerator and a platform denominator that never shared a window.
  it('12 · a GA4 canonical row does not satisfy the META stream', () => {
    const byStream = resolveCanonicalByStream([
      canonical('2026-08-10', { source: 'GA4', revenueMinor: 99_999 }),
      rolling({ source: 'META' }),
    ], { now: NOW });
    expect(byStream.get('E1|META').status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(byStream.get('E1|GA4').status).toBe(RESOLUTION.OK);
    expect(byStream.get('E1|GA4').snapshot.revenueMinor).toBe(99_999);
  });

  it('13 · identical periods tie-break on sync date, deterministically', () => {
    const a = canonical('2026-08-10', { date: d('2026-08-10'), spendMinor: 1 });
    const b = canonical('2026-08-10', { date: d('2026-08-11'), spendMinor: 2 });
    for (const order of [[a, b], [b, a]]) {
      expect(resolve(order).snapshot.spendMinor).toBe(2); // the newer SYNC
    }
  });

  // Sync date is the tie-break and nothing more. If it ever became the primary
  // sort these two would disagree.
  it('sync date never outranks the measured period', () => {
    const older = canonical('2026-08-09', { date: d('2026-08-11'), spendMinor: 1 }); // newest sync
    const newer = canonical('2026-08-10', { date: d('2026-08-01'), spendMinor: 2 }); // newest period
    expect(resolve([older, newer]).snapshot.spendMinor).toBe(2);
  });
});

// ── The production reality this resolver is waiting on ──────────────────────
describe('nothing produces a canonical row yet — this is why it is not wired', () => {
  // Everything a live sync writes today. All of it is refused, correctly, and
  // that is precisely why activating the resolver now would take the verdict
  // surface dark rather than make it honest.
  it('every window a live producer can currently emit is refused', () => {
    const live = [
      rolling(),                                   // metaNormalize / googleNormalize
      rolling({ windowStart: d('2023-07-01') }),   // a manual `maximum` sync
      legacy({ source: 'GA4' }),                   // actualsSink
      legacy({ source: 'MANUAL' }),                // RevenueCsvService
    ];
    const r = resolve(live);
    expect(r.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(r.rejected).toHaveLength(4);
  });
});
