// ============================================================
// R5 — the EvidenceReference contract
// ============================================================
// The projector is pure, so this file can hold it to the whole contract without
// a database, a clock or a fixture table. What it protects:
//
//   • the five populations stay NAMED, never inferred
//   • `rowCount` is what was CONSUMED, and is not quietly recomputed from the
//     contributing rows — the two are different facts and the gap between them
//     is the multi-row story
//   • "not captured" (null) never collapses into "there were none" ([])
//   • observedAt comes from the evidence row and from nowhere else
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  toEvidenceReference, EVIDENCE_POPULATION, EVIDENCE_SELECTOR, EVIDENCE_REDUCTION,
} from './evidenceReference.js';

const OBSERVED = new Date('2026-08-10T09:00:00Z');
const LATER    = new Date('2026-08-11T09:00:00Z');

const valid = (over = {}) => ({
  population: EVIDENCE_POPULATION.CANONICAL_VERDICT,
  selector:   EVIDENCE_SELECTOR.CANONICAL_VERDICT,
  reduction:  EVIDENCE_REDUCTION.LATEST_PER_ENTITY,
  rowCount:   1,
  rows:       [{ entityId: 'c1', source: 'META', observedAt: OBSERVED }],
  ...over,
});

describe('R5 — toEvidenceReference', () => {
  describe('the shape', () => {
    it('returns every field of the contract, in order, with nothing extra', () => {
      const ref = toEvidenceReference(valid({ measurementWindow: 'CUMULATIVE_30D' }));
      expect(Object.keys(ref)).toEqual([
        'population', 'selector', 'measurementWindow', 'sources',
        'observedAt', 'reduction', 'entityIds', 'rowCount', 'refs',
      ]);
    });

    it('carries the population, selector, window and reduction it was given', () => {
      const ref = toEvidenceReference(valid({ measurementWindow: 'CUMULATIVE_30D' }));
      expect(ref.population).toBe('canonical-verdict');
      expect(ref.selector).toBe('selectCanonicalVerdictSnapshots');
      expect(ref.measurementWindow).toBe('CUMULATIVE_30D');
      expect(ref.reduction).toBe('latest-per-entity');
    });

    it('derives sources, observedAt and entityIds from the contributing rows', () => {
      // Derived rather than passed as three parallel arrays, for the reason the
      // reasoning artifact gives: two shapes carrying the same facts are two
      // shapes that can disagree.
      const ref = toEvidenceReference(valid({
        rowCount: 4,
        rows: [
          { entityId: 'c1', source: 'META',   observedAt: OBSERVED },
          { entityId: 'c1', source: 'GA4',    observedAt: LATER },
          { entityId: 'c2', source: 'META',   observedAt: OBSERVED },
        ],
      }));
      expect(ref.sources).toEqual(['META', 'GA4']);           // distinct, first-seen order
      expect(ref.entityIds).toEqual(['c1', 'c2']);
      expect(ref.observedAt).toEqual([OBSERVED.toISOString(), LATER.toISOString()]);
    });

    it('is Tier 1 — refs is empty unless a caller supplies row identity', () => {
      expect(toEvidenceReference(valid()).refs).toEqual([]);
    });
  });

  describe('rowCount is CONSUMED, not contributed', () => {
    it('keeps the consumed count when a reduction discarded most of the rows', async () => {
      // THE MULTI-ROW ASSERTION. Eleven canonical rows ranked, one kept. A
      // reference that reported 1 would say the verdict rested on a single
      // reading; one that reported eleven contributors would say all eleven fed
      // the number. Both are false, and the shape carries them separately.
      const ref = toEvidenceReference(valid({ rowCount: 11 }));
      expect(ref.rowCount).toBe(11);
      expect(ref.observedAt).toHaveLength(1);
      expect(ref.sources).toHaveLength(1);
    });

    it('does NOT recompute rowCount from the rows it was handed', () => {
      const ref = toEvidenceReference(valid({ rowCount: 7, rows: [
        { entityId: 'c1', source: 'META', observedAt: OBSERVED },
        { entityId: 'c1', source: 'META', observedAt: LATER },
      ] }));
      expect(ref.rowCount).toBe(7);
      expect(ref.rowCount).not.toBe(2);
    });

    it('accepts a zero-row read without inventing evidence for it', () => {
      const ref = toEvidenceReference(valid({ rowCount: 0, rows: [] }));
      expect(ref.rowCount).toBe(0);
      expect(ref.sources).toEqual([]);
      expect(ref.observedAt).toEqual([]);
      expect(ref.entityIds).toEqual([]);
    });
  });

  describe('not captured is not the same as none', () => {
    it('reports sources as NULL when the rows exist but carried none', () => {
      // The guardrail reader's real state: it projects no `source`, so nothing
      // contributing has one. null says "we did not capture it"; [] would say
      // "we looked and there were no sources", which is a claim about the data.
      const ref = toEvidenceReference(valid({ rows: [{ entityId: 'e1', observedAt: OBSERVED }] }));
      expect(ref.sources).toBeNull();
      expect(ref.sources).not.toEqual([]);
    });

    it('reports observedAt as NULL when no contributing row carried a timestamp', () => {
      const ref = toEvidenceReference(valid({ rows: [{ entityId: 'e1', source: 'META' }] }));
      expect(ref.observedAt).toBeNull();
    });

    it('reports an empty list — not null — when there were no rows at all', () => {
      const ref = toEvidenceReference(valid({ rowCount: 0, rows: [] }));
      expect(ref.sources).toEqual([]);
      expect(ref.sources).not.toBeNull();
    });

    it('defaults the measured period to NULL rather than picking a window', () => {
      // Omitted by the operational readers on purpose: that population admits
      // two windows and they project neither the column. Defaulting to either
      // would invent a measurement period out of a filter's allow-list.
      expect(toEvidenceReference(valid()).measurementWindow).toBeNull();
    });
  });

  describe('observedAt comes from the evidence row', () => {
    it('uses the row\'s own observation timestamp, normalised to ISO', () => {
      const ref = toEvidenceReference(valid());
      expect(ref.observedAt).toEqual(['2026-08-10T09:00:00.000Z']);
    });

    it('accepts an ISO string as readily as a Date — same instant either way', () => {
      const fromString = toEvidenceReference(valid({
        rows: [{ entityId: 'c1', source: 'META', observedAt: OBSERVED.toISOString() }],
      }));
      expect(fromString.observedAt).toEqual(toEvidenceReference(valid()).observedAt);
    });

    it('drops an unparseable timestamp instead of fabricating one', () => {
      // A reference that quietly substituted `new Date()` here would date a
      // historical decision to whenever it was last read.
      const ref = toEvidenceReference(valid({
        rows: [{ entityId: 'c1', source: 'META', observedAt: 'not-a-date' }],
      }));
      expect(ref.observedAt).toBeNull();
    });
  });

  describe('it refuses to build a false reference', () => {
    it('throws on an unnamed population', () => {
      expect(() => toEvidenceReference(valid({ population: undefined })))
        .toThrow(/population/);
    });

    it('throws on a population it does not recognise', () => {
      // The five are an allow-list. A sixth string invented at a call site would
      // otherwise become a population nobody defined.
      expect(() => toEvidenceReference(valid({ population: 'whatever-was-handy' })))
        .toThrow(/population/);
    });

    it('throws on a missing selector — a reference must say which read produced it', () => {
      expect(() => toEvidenceReference(valid({ selector: '' }))).toThrow(/selector/);
    });

    it('throws on a reduction that is not one the code performs', () => {
      expect(() => toEvidenceReference(valid({ reduction: 'daily' }))).toThrow(/reduction/);
    });

    it('throws when rowCount is missing, negative or not an integer', () => {
      expect(() => toEvidenceReference(valid({ rowCount: undefined }))).toThrow(/rowCount/);
      expect(() => toEvidenceReference(valid({ rowCount: -1 }))).toThrow(/rowCount/);
      expect(() => toEvidenceReference(valid({ rowCount: 1.5 }))).toThrow(/rowCount/);
    });
  });

  describe('the populations stay apart', () => {
    it('canonical and operational produce distinguishable references', () => {
      // I4 at the persistence layer. Two decisions, two measurements — and the
      // stored reference has to be able to say which, without re-reading a row.
      const canonical = toEvidenceReference(valid({ measurementWindow: 'CUMULATIVE_30D' }));
      const operational = toEvidenceReference(valid({
        population: EVIDENCE_POPULATION.OPERATIONAL,
        selector:   EVIDENCE_SELECTOR.OPERATIONAL,
        reduction:  EVIDENCE_REDUCTION.SERIES,
      }));
      expect(canonical.population).not.toBe(operational.population);
      expect(canonical.selector).not.toBe(operational.selector);
      expect(canonical.measurementWindow).toBe('CUMULATIVE_30D');
      expect(operational.measurementWindow).toBeNull();
    });

    it('names all five populations the architecture keeps apart', () => {
      expect(Object.values(EVIDENCE_POPULATION).sort()).toEqual([
        'actual-revenue', 'canonical-fatigue', 'canonical-verdict', 'manual-revenue', 'operational',
      ]);
    });

    it('keeps the reduction names honest — none of them claims a daily series', () => {
      // `latest-per-stream-per-day` is an OBSERVATION-day rule over
      // trailing-window rows. A name like `daily` would claim the daily activity
      // the ingestion cannot produce, which is exactly what R4 refused to say.
      const names = Object.values(EVIDENCE_REDUCTION);
      expect(names).toContain('latest-per-stream-per-day');
      expect(names).not.toContain('daily');
      for (const n of names) expect(n).not.toMatch(/^daily/);
    });
  });
});
