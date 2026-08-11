// ============================================================
// Phase H — the actual-source contract
// ------------------------------------------------------------
// One question, asked of every revenue source:
//
//     can this number prove it measures the SAME 30 days the canonical Meta
//     spend measures, under semantics we can state?
//
// The tests below are mostly refusals, and each refuses for a SPECIFIC stated
// reason rather than merely returning false. That distinction is the point of
// the phase: "unavailable" is not a useful answer, and a rule that rejects
// everything is indistinguishable from a rule that works until the day something
// should have been accepted.
//
// Nothing here has a production caller. Phase D is dormant, so every assertion
// is about the contract, not about a live surface.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  actualRevenueEligibleForCanonicalRoas, canonicalRoasPair, sourceContract,
  canonicalEligibility, ACTUAL_SOURCE_CONTRACT, SOURCE_CONTRACT,
  CANONICAL_VERDICT_WINDOW_DAYS, REJECTION,
} from './metricWindow.js';
import { MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';

const W = MEASUREMENT_WINDOW;
const NOW = new Date('2026-08-11T12:00:00Z');
const day = (s) => new Date(`${s}T00:00:00Z`);

/** A period of `days` ending inclusively on `endDay`. */
const span = (endDay, days) => ({
  windowStart: new Date(day(endDay).getTime() - (days - 1) * 86_400_000),
  windowEnd: day(endDay),
});

/** A well-formed canonical row for any source. */
const canonicalRow = (source, over = {}) => ({
  entityId: 'E1', source,
  measurementWindow: W.CUMULATIVE_30D,
  ...span('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS),
  date: day('2026-08-11'),
  spendMinor: 100_000, revenueMinor: 250_000,
  ...over,
});

/** What actualsSink / RevenueCsvService actually write today. */
const todaysActual = (source, over = {}) => ({
  entityId: 'E1', source,
  measurementWindow: W.LEGACY_UNKNOWN,
  windowStart: null, windowEnd: null,
  date: day('2026-08-11'),
  spendMinor: 0, revenueMinor: 400_000,
  ...over,
});

// ── PER-SOURCE VERDICTS ─────────────────────────────────────────────────────

describe('the per-source contract', () => {
  it('META is the ONLY canonical revenue source', () => {
    const canonical = Object.entries(ACTUAL_SOURCE_CONTRACT)
      .filter(([, c]) => c.verdict === SOURCE_CONTRACT.CANONICAL)
      .map(([k]) => k);
    expect(canonical).toEqual(['META']);
  });

  it('GA4 is BLOCKED — a decision and configuration Lumi does not hold', () => {
    expect(ACTUAL_SOURCE_CONTRACT.GA4.verdict).toBe(SOURCE_CONTRACT.BLOCKED);
    expect(ACTUAL_SOURCE_CONTRACT.GA4.missing.length).toBeGreaterThan(0);
  });

  it('MANUAL is BLOCKED — the upload has nowhere to put a period', () => {
    expect(ACTUAL_SOURCE_CONTRACT.MANUAL.verdict).toBe(SOURCE_CONTRACT.BLOCKED);
    expect(ACTUAL_SOURCE_CONTRACT.MANUAL.missing.length).toBeGreaterThan(0);
  });

  it('SHOPIFY is NON_CANONICAL — the tag exists, the producer does not', () => {
    expect(ACTUAL_SOURCE_CONTRACT.SHOPIFY.verdict).toBe(SOURCE_CONTRACT.NON_CANONICAL);
  });

  it('no source claims its history can be recovered', () => {
    // Phase C's principle: provenance never recorded cannot be reconstructed
    // from a row date, an upload time, or the preset that happened to be set.
    for (const [name, c] of Object.entries(ACTUAL_SOURCE_CONTRACT)) {
      expect(c.historicalRecoverable, `${name}`).toBe(false);
    }
  });

  it('an unrecognised source is NON_CANONICAL, never assumed', () => {
    expect(sourceContract('TIKTOK').verdict).toBe(SOURCE_CONTRACT.NON_CANONICAL);
    expect(sourceContract(undefined).verdict).toBe(SOURCE_CONTRACT.NON_CANONICAL);
  });

  it('every non-canonical source states what is missing', () => {
    // A verdict without a remedy is a dead end. This is what makes the phase
    // actionable rather than merely correct.
    for (const [name, c] of Object.entries(ACTUAL_SOURCE_CONTRACT)) {
      if (c.verdict === SOURCE_CONTRACT.CANONICAL) continue;
      expect(c.missing.length, `${name} must say what is missing`).toBeGreaterThan(0);
      expect(c.evidence.length, `${name} must cite evidence`).toBeGreaterThan(0);
    }
  });
});

// ── META ────────────────────────────────────────────────────────────────────

describe('META', () => {
  it('a correct canonical row is eligible', () => {
    expect(actualRevenueEligibleForCanonicalRoas(canonicalRow('META')).ok).toBe(true);
  });

  it('declaration without corroborating dates → rejected', () => {
    const row = canonicalRow('META', { windowStart: null, windowEnd: null });
    expect(canonicalEligibility(row, { now: NOW }).reason).toBe(REJECTION.MISSING_PERIOD);
  });

  it('correct dates without the canonical declaration → rejected', () => {
    const row = canonicalRow('META', { measurementWindow: W.ROLLING_WINDOW });
    expect(canonicalEligibility(row, { now: NOW }).reason).toBe(REJECTION.NOT_CANONICAL);
  });

  it('wrong span → rejected as a provenance mismatch, never trimmed to fit', () => {
    const row = canonicalRow('META', span('2026-08-10', 90));
    expect(canonicalEligibility(row, { now: NOW }).reason).toBe(REJECTION.PROVENANCE_MISMATCH);
  });

  it('a period ending in the future → rejected', () => {
    const row = canonicalRow('META', span('2026-09-30', CANONICAL_VERDICT_WINDOW_DAYS));
    expect(canonicalEligibility(row, { now: NOW }).reason).toBe(REJECTION.FUTURE_PERIOD);
  });

  it('a rolling window → rejected', () => {
    const row = canonicalRow('META', { measurementWindow: W.ROLLING_WINDOW });
    expect(actualRevenueEligibleForCanonicalRoas(row).ok).toBe(false);
  });
});

// ── GA4 ─────────────────────────────────────────────────────────────────────

describe('GA4', () => {
  it('a row as GA4 actually writes it today → rejected', () => {
    const verdict = actualRevenueEligibleForCanonicalRoas(todaysActual('GA4'));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('SOURCE_NOT_CANONICAL');
  });

  it('a 30-day FETCH does not make GA4 canonical', () => {
    // The trap. `last_30d` is one of four presets a sync trigger may send, so a
    // 30-day span is something the system produces by accident — and it says
    // nothing about the attribution behind the number.
    const looksRight = todaysActual('GA4', {
      measurementWindow: W.CUMULATIVE_30D,
      ...span('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS),
    });
    const verdict = actualRevenueEligibleForCanonicalRoas(looksRight);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('SOURCE_NOT_CANONICAL');
  });

  it('a known date range with unknown lookback → still rejected', () => {
    // Even a perfectly recorded period is not enough: purchaseRevenue against
    // sessionSource/sessionMedium is resolved by the PROPERTY's attribution model
    // and lookback, which Lumi never reads and never stores.
    const dated = todaysActual('GA4', {
      measurementWindow: W.CUMULATIVE_30D,
      ...span('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS),
      attributionLookbackDays: null,
    });
    expect(actualRevenueEligibleForCanonicalRoas(dated).ok).toBe(false);
  });

  it('the refusal survives a row that asserts a lookback the system never captured', () => {
    // A field on the row is not evidence — nothing in the ingestion path can
    // populate it, so a value here could only have been invented downstream.
    const asserted = todaysActual('GA4', {
      measurementWindow: W.CUMULATIVE_30D,
      ...span('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS),
      attributionLookbackDays: 7,
      attributionModel: 'LAST_CLICK',
    });
    expect(actualRevenueEligibleForCanonicalRoas(asserted).ok).toBe(false);
  });

  it('names the missing facts, including the timezone the range is expressed in', () => {
    const missing = ACTUAL_SOURCE_CONTRACT.GA4.missing.join(' ').toLowerCase();
    expect(missing).toContain('lookback');
    expect(missing).toContain('timezone');
    expect(missing).toContain('attribution model');
  });
});

// ── CSV / MANUAL ────────────────────────────────────────────────────────────

describe('CSV / MANUAL', () => {
  it('a row as the upload actually writes it today → rejected', () => {
    const verdict = actualRevenueEligibleForCanonicalRoas(todaysActual('MANUAL'));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('SOURCE_NOT_CANONICAL');
  });

  it('the upload timestamp cannot substitute for a measurement period', () => {
    // RevenueCsvService stores `date: latest.date` — the newest platform
    // snapshot's SYNC time. Handing that to the window fields is the single
    // forbidden inference of this phase, and it stays refused.
    const uploadStamped = todaysActual('MANUAL', {
      measurementWindow: W.CUMULATIVE_30D,
      windowStart: new Date(day('2026-08-11').getTime() - 29 * 86_400_000),
      windowEnd: day('2026-08-11'), // the sync timestamp, dressed as a period
    });
    expect(actualRevenueEligibleForCanonicalRoas(uploadStamped).ok).toBe(false);
  });

  it('an explicit period is still not enough while the revenue semantics are undefined', () => {
    // Incremental or cumulative is never asked, so even a dated upload does not
    // establish what the number counts over that period.
    const dated = todaysActual('MANUAL', {
      measurementWindow: W.CUMULATIVE_30D,
      ...span('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS),
    });
    expect(actualRevenueEligibleForCanonicalRoas(dated).ok).toBe(false);
  });

  it('the same revenue for two different periods is distinguished BY PERIOD, not by amount', () => {
    // Demonstrated on META, the one source that can currently carry a period.
    // Identical amounts, different 30-day windows: the contract pairs one and
    // refuses the other, so the amount never decides the outcome.
    const augustSpend = canonicalRow('META', span('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS));
    const julyRevenue = canonicalRow('META', { revenueMinor: 400_000, ...span('2026-07-10', CANONICAL_VERDICT_WINDOW_DAYS) });
    const augustRevenue = canonicalRow('META', { revenueMinor: 400_000, ...span('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS) });

    expect(julyRevenue.revenueMinor).toBe(augustRevenue.revenueMinor);
    expect(canonicalRoasPair(augustRevenue, augustSpend).ok).toBe(true);
    expect(canonicalRoasPair(julyRevenue, augustSpend).reason).toBe('CROSS_WINDOW');
  });

  it('a MANUAL upload cannot even reach that check — it is refused a step earlier', () => {
    // Which is the actual finding: the period comparison is well-defined, and
    // MANUAL has nothing to compare. Two uploads for different periods are
    // indistinguishable in the database today, so they are refused as a class
    // rather than sorted out row by row.
    const a = todaysActual('MANUAL', { revenueMinor: 400_000 });
    const b = todaysActual('MANUAL', { revenueMinor: 400_000 });
    for (const row of [a, b]) {
      expect(actualRevenueEligibleForCanonicalRoas(row).reason).toBe('SOURCE_NOT_CANONICAL');
    }
    expect(a.windowStart).toBeNull();
    expect(b.windowStart).toBeNull();
  });

  it('names the missing facts, including incremental-vs-cumulative', () => {
    const missing = ACTUAL_SOURCE_CONTRACT.MANUAL.missing.join(' ').toLowerCase();
    expect(missing).toContain('period');
    expect(missing).toContain('cumulative');
  });
});

// ── CROSS-SOURCE ────────────────────────────────────────────────────────────

describe('cross-source ROAS', () => {
  const metaSpend = canonicalRow('META', span('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS));

  it('META 30d spend + GA4 unknown revenue → ROAS unavailable', () => {
    const pair = canonicalRoasPair(todaysActual('GA4'), metaSpend);
    expect(pair.ok).toBe(false);
    expect(pair.reason).toBe('SOURCE_NOT_CANONICAL');
  });

  it('META 30d spend + CSV unknown revenue → ROAS unavailable', () => {
    expect(canonicalRoasPair(todaysActual('MANUAL'), metaSpend).ok).toBe(false);
  });

  it('META 30d spend + canonical 30d revenue of the SAME period → eligible', () => {
    // The contract is not merely restrictive: when the evidence exists, it says
    // yes. Without this the suite would pass by refusing everything.
    const revenue = canonicalRow('META', span('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS));
    expect(canonicalRoasPair(revenue, metaSpend)).toEqual({ ok: true, reason: null });
  });

  it('two canonical rows measuring DIFFERENT 30 days → rejected as CROSS_WINDOW', () => {
    // Both are valid canonical measurements. Neither is malformed. Dividing them
    // is still meaningless, and this is the case a per-row eligibility check
    // alone would wave through.
    const lastWeek = canonicalRow('META', span('2026-08-03', CANONICAL_VERDICT_WINDOW_DAYS));
    const pair = canonicalRoasPair(lastWeek, metaSpend);
    expect(pair.ok).toBe(false);
    expect(pair.reason).toBe('CROSS_WINDOW');
  });

  it('a missing row on either side is refused, not treated as zero', () => {
    expect(canonicalRoasPair(null, metaSpend).reason).toBe('MISSING_ROW');
    expect(canonicalRoasPair(canonicalRow('META'), null).reason).toBe('MISSING_ROW');
  });

  it('a non-canonical SPEND row is refused even with canonical revenue', () => {
    const rollingSpend = canonicalRow('META', { measurementWindow: W.ROLLING_WINDOW });
    expect(canonicalRoasPair(canonicalRow('META'), rollingSpend).ok).toBe(false);
  });
});
