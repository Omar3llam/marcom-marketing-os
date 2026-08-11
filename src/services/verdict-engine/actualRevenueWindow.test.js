// ============================================================
// The actual-revenue window boundary + the Phase D activation gate
// ------------------------------------------------------------
// Phase F made Meta's PLATFORM revenue and spend a real 30-day measurement. It
// did nothing for ACTUAL revenue — GA4 and the MANUAL revenue CSV — and that
// asymmetry is what blocks Phase D.
//
// The whole file defends one sentence:
//
//     a 30-day ROAS may not have a numerator from an unknown period.
//
// Note what is NOT tested here: that some reader currently behaves correctly.
// These are contract tests over pure functions. The production overlay
// (effectiveByEntity) is window-blind by construction — it selects on `date` and
// never reads measurementWindow — so there is no honest way to assert safety of
// the live path, and asserting it anyway would pin the defect as the contract.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canonicalEligibility, sameWindow, deriveRoas, resolveCanonicalSnapshot,
  actualRevenueEligibleForCanonicalRoas, canonicalWindowBounds,
  ACTUAL_SOURCE_WINDOW_CONTRACT_RESOLVED, ACTUAL_SOURCE_WINDOW_FACTS, WINDOW_FACT,
  RESOLUTION, REJECTION, CANONICAL_VERDICT_WINDOW_DAYS,
} from './metricWindow.js';
import { MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';

const NOW = new Date('2026-08-11T12:00:00Z');
const day = (s) => new Date(`${s}T00:00:00Z`);
const spanEndingAt = (endDay, days) => ({
  windowStart: new Date(day(endDay).getTime() - (days - 1) * 86_400_000),
  windowEnd: day(endDay),
});

/** A canonical Meta row: declares CUMULATIVE_30D and its dates corroborate it. */
const metaCanonical = (over = {}) => ({
  entityId: 'E1', source: 'META',
  measurementWindow: MEASUREMENT_WINDOW.CUMULATIVE_30D,
  ...spanEndingAt('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS),
  date: day('2026-08-11'),
  spendMinor: 100_000, revenueMinor: 250_000,
  ...over,
});

/**
 * What actualsSink and RevenueCsvService ACTUALLY write today — verified by
 * reading both writers, not assumed. The null window is the entire problem.
 */
const actualRow = (source, over = {}) => ({
  entityId: 'E1', source,
  measurementWindow: MEASUREMENT_WINDOW.LEGACY_UNKNOWN,
  windowStart: null, windowEnd: null,
  date: day('2026-08-11'),
  spendMinor: 0, revenueMinor: 400_000,
  ...over,
});

describe('Test 1 — a LEGACY_UNKNOWN actual cannot qualify as canonical', () => {
  for (const source of ['GA4', 'MANUAL', 'SHOPIFY']) {
    it(`${source} revenue is refused as NOT_CANONICAL`, () => {
      const verdict = canonicalEligibility(actualRow(source), { now: NOW });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toBe(REJECTION.NOT_CANONICAL);
    });
  }

  it('is refused for the DECLARATION, not for the missing dates', () => {
    // Order matters. If the null dates were the reason, then a future GA4 change
    // that merely stamped dates would flip this to eligible without anyone
    // deciding what those dates mean. The declaration is checked FIRST.
    const withDates = actualRow('GA4', spanEndingAt('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS));
    expect(canonicalEligibility(withDates, { now: NOW }).reason).toBe(REJECTION.NOT_CANONICAL);
  });
});

describe('Test 2 — cross-window ROAS is rejected', () => {
  it('an unknown-period numerator over canonical spend is not a same-window pair', () => {
    const canonical = canonicalWindowBounds(NOW);
    const actualPeriod = { start: null, end: null }; // what an actual row carries
    expect(sameWindow({ start: actualPeriod.start, end: actualPeriod.end }, canonical)).toBe(false);
  });

  it('the contract refuses the actual outright, with a reason that names the cause', () => {
    // Phase H sharpened this reason. It was ACTUAL_SOURCE_WINDOW_UNDEFINED — the
    // global activation flag being off, which was all we knew in #362. GA4 is now
    // refused for a fact about GA4: its source contract is BLOCKED, and it would
    // stay refused on the day the flag flips.
    const verdict = actualRevenueEligibleForCanonicalRoas(actualRow('GA4'));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('SOURCE_NOT_CANONICAL');
  });

  it('refuses even when the actual carries a real, positive revenue figure', () => {
    // The failure mode this stops is seductive: the numerator is REAL money that
    // a customer really earned. It is refused for what it cannot say about
    // itself, not for being empty or wrong.
    const rich = actualRow('MANUAL', { revenueMinor: 9_999_999 });
    expect(actualRevenueEligibleForCanonicalRoas(rich).ok).toBe(false);
  });
});

describe('Test 3 — canonical platform ROAS remains valid', () => {
  it('CUMULATIVE_30D revenue over CUMULATIVE_30D spend computes', () => {
    const row = metaCanonical();
    expect(canonicalEligibility(row, { now: NOW }).ok).toBe(true);
    expect(deriveRoas(row.revenueMinor, row.spendMinor)).toBe(2.5);
  });

  it('two canonical rows measuring the same period are a same-window pair', () => {
    const a = metaCanonical();
    const b = metaCanonical({ entityId: 'E2' });
    expect(sameWindow(
      { start: a.windowStart, end: a.windowEnd },
      { start: b.windowStart, end: b.windowEnd },
    )).toBe(true);
  });
});

describe('Test 4 — same-window means EXACTLY the same window', () => {
  const base = spanEndingAt('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS);
  const pair = (o) => sameWindow(
    { start: base.windowStart, end: base.windowEnd },
    { start: o.windowStart, end: o.windowEnd },
  );

  it('accepts an identical period', () => {
    expect(pair(spanEndingAt('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS))).toBe(true);
  });

  it('rejects a period one day later — no "close enough"', () => {
    expect(pair(spanEndingAt('2026-08-11', CANONICAL_VERDICT_WINDOW_DAYS))).toBe(false);
  });

  it('rejects a period of a different length that shares an end date', () => {
    expect(pair(spanEndingAt('2026-08-10', 29))).toBe(false);
  });

  it('rejects when either side has no period at all', () => {
    expect(pair({ windowStart: null, windowEnd: null })).toBe(false);
  });
});

describe('Test 5 — attribution semantics cannot be inferred from a date span', () => {
  it('a GA4 row spanning exactly 30 days is still not canonical', () => {
    // This is the trap the gate exists for. GA4's request range is
    // presetToDateRange(datePreset) — 540 / 90 / 30 / 7 days depending on which
    // trigger fired — so a 30-day span is something a `last_30d` sync would
    // produce BY ACCIDENT, and it says nothing about the property's attribution
    // model or lookback window (which live in Google's UI and are never read).
    const looksRight = actualRow('GA4', {
      ...spanEndingAt('2026-08-10', CANONICAL_VERDICT_WINDOW_DAYS),
    });
    expect(canonicalEligibility(looksRight, { now: NOW }).ok).toBe(false);
  });

  it('a row that DECLARES canonical but whose dates disagree is a mismatch, not a repair', () => {
    const lying = metaCanonical(spanEndingAt('2026-08-10', 90));
    const verdict = canonicalEligibility(lying, { now: NOW });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(REJECTION.PROVENANCE_MISMATCH);
  });

  it('records every unknown fact per source rather than leaving it to a comment', () => {
    expect(ACTUAL_SOURCE_WINDOW_FACTS.GA4.attributionLookback).toBe(WINDOW_FACT.UNKNOWN);
    expect(ACTUAL_SOURCE_WINDOW_FACTS.GA4.canBeCanonical).toBe(false);
    expect(ACTUAL_SOURCE_WINDOW_FACTS.MANUAL.measurementStart).toBe(WINDOW_FACT.UNKNOWN);
    expect(ACTUAL_SOURCE_WINDOW_FACTS.MANUAL.canBeCanonical).toBe(false);
    // Meta is the ONLY source that may be canonical today.
    expect(ACTUAL_SOURCE_WINDOW_FACTS.META.canBeCanonical).toBe(true);
    const canonicalSources = Object.entries(ACTUAL_SOURCE_WINDOW_FACTS)
      .filter(([, f]) => f.canBeCanonical).map(([k]) => k);
    expect(canonicalSources).toEqual(['META']);
  });
});

describe('Test 6 — no fallback to a non-canonical actual', () => {
  it('resolves NO_CANONICAL_WINDOW rather than returning the actual row', () => {
    const result = resolveCanonicalSnapshot([actualRow('GA4'), actualRow('MANUAL')], { now: NOW });
    expect(result.status).toBe(RESOLUTION.NO_CANONICAL_WINDOW);
    expect(result.snapshot).toBeNull();
  });

  it('reports the refused rows so the absence can be EXPLAINED, not just shown', () => {
    const result = resolveCanonicalSnapshot([actualRow('GA4')], { now: NOW });
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe(REJECTION.NOT_CANONICAL);
  });

  it('a newer actual never displaces an older canonical row', () => {
    // The tempting fallback is recency: the actual was synced later, so it looks
    // fresher. Recency is a fact about us; the window is a fact about the
    // campaign, and only one of those decides a verdict.
    const stale = metaCanonical({ date: day('2026-07-01') });
    const fresh = actualRow('MANUAL', { date: day('2026-08-11') });
    const result = resolveCanonicalSnapshot([fresh, stale], { now: NOW });
    expect(result.status).toBe(RESOLUTION.OK);
    expect(result.snapshot.source).toBe('META');
  });
});

// ════════════════════════════════════════════════════════════
// THE ACTIVATION GATE
// ------------------------------------------------------------
// Fails loudly if someone wires canonical resolution into the production read
// path while the actual-source contract is still unresolved. Not an env var and
// not a feature flag on purpose: the block is a product sequencing decision, so
// the only way past it is a code change that a human reviews.
// ════════════════════════════════════════════════════════════
describe('Phase D activation gate', () => {
  const readSrc = (rel) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('is CLOSED — actual-source canonical semantics are undefined', () => {
    expect(ACTUAL_SOURCE_WINDOW_CONTRACT_RESOLVED).toBe(false);
  });

  it('blocks EntityGraph from resolving canonically while it is closed', () => {
    if (ACTUAL_SOURCE_WINDOW_CONTRACT_RESOLVED) return; // gate opened — no longer this test's business

    const service = readSrc('../entity-graph/EntityGraphService.js');
    const engine = readSrc('../entity-graph/entityGraphEngine.js');

    // If this fails you are activating Phase D. That is not a test to update:
    // decide the actual-source question first (see ACTUAL_SOURCE_WINDOW_FACTS),
    // flip ACTUAL_SOURCE_WINDOW_CONTRACT_RESOLVED in the same change, and this
    // gate steps aside on its own.
    for (const [name, src] of [['EntityGraphService', service], ['entityGraphEngine', engine]]) {
      expect(src, `${name} must not resolve canonically while the gate is closed`)
        .not.toMatch(/resolveCanonical(Snapshot|ByStream)/);
    }
  });

  it('keeps the gate honest — it cannot be opened without making the facts KNOWN', () => {
    // The gate is only meaningful if opening it is harder than editing a boolean.
    // If someone flips the constant while any source still reports UNKNOWN, this
    // fails and names the source that is not ready.
    if (!ACTUAL_SOURCE_WINDOW_CONTRACT_RESOLVED) return;

    for (const [source, facts] of Object.entries(ACTUAL_SOURCE_WINDOW_FACTS)) {
      if (!facts.canBeCanonical) continue;
      for (const field of ['measurementStart', 'measurementEnd', 'attributionLookback', 'persisted']) {
        expect(facts[field], `${source}.${field} must not be UNKNOWN once the gate is open`)
          .not.toBe(WINDOW_FACT.UNKNOWN);
      }
    }
  });
});
