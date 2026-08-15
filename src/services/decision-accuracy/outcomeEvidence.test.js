// ============================================================
// R6 — outcome provenance is PROJECTED FROM ROWS, never assembled
// ============================================================
// The projector alone, with the evidence seam mocked, so every assertion below
// is about what the rows say rather than about what a caller passed. What it
// protects:
//
//   • the population is OPERATIONAL and NAMED — never canonical, never inferred
//   • `observedAt` is MetricSnapshot.date and nothing else (no clock, no
//     measuredAt, no window bound the operator typed)
//   • `sources` / `entityIds` are derived from contributing rows, so nothing can
//     hand this function an array that disagrees with the database
//   • `rowCount` is what the read CONSUMED, which is not the number of rows that
//     fell inside the measured period
//   • an empty read reports an empty read, and a failed read reports nothing
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectOperationalSnapshots } = vi.hoisted(() => ({ selectOperationalSnapshots: vi.fn() }));
vi.mock('../evidence/index.js', () => ({ selectOperationalSnapshots }));

import { projectOutcomeEvidence, agreedMeasurementWindow, OUTCOME_EVIDENCE_SELECT } from './outcomeEvidence.js';

const WS = 'ws-1';
const ENT = 'ent-1';
const START = new Date('2026-08-01T00:00:00Z');
const END = new Date('2026-08-08T00:00:00Z');

const args = (over = {}) => ({
  entityId: ENT, entityLevel: 'ADSET', windowStart: START, windowEnd: END, ...over,
});

const row = (over = {}) => ({
  entityId: ENT, date: new Date('2026-08-03T06:00:00Z'), source: 'META',
  measurementWindow: 'ROLLING_WINDOW', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  selectOperationalSnapshots.mockResolvedValue([row()]);
});

describe('R6 — projectOutcomeEvidence', () => {
  describe('the read it makes', () => {
    it('asks the operational seam for this entity, at this level, from the window opening', async () => {
      await projectOutcomeEvidence(WS, args());
      const [ws, opts] = selectOperationalSnapshots.mock.calls[0];
      expect(ws).toBe(WS);
      expect(opts.since).toBe(START);
      expect(opts.entityIds).toEqual([ENT]);
      expect(opts.entityLevel).toBe('ADSET');
    });

    it('names its projection — an unprojected read widens on every new column', async () => {
      await projectOutcomeEvidence(WS, args());
      expect(selectOperationalSnapshots.mock.calls[0][1].select).toEqual(OUTCOME_EVIDENCE_SELECT);
      expect(OUTCOME_EVIDENCE_SELECT).toEqual({
        entityId: true, date: true, source: true, measurementWindow: true,
      });
    });

    it('does NOT ask the seam to reduce — an outcome rests on the whole in-window series', async () => {
      // `distinct` and `take` at this seam are six earlier PRs' negative control.
      // A latest-per-entity reduction here would silently shrink the evidence a
      // recorded result claims to rest on.
      await projectOutcomeEvidence(WS, args());
      const opts = selectOperationalSnapshots.mock.calls[0][1];
      expect(opts.distinct).toBeUndefined();
      expect(opts.take).toBeUndefined();
    });

    it('does not swallow a failed read — provenance we cannot establish is not provenance', async () => {
      selectOperationalSnapshots.mockRejectedValue(new Error('db down'));
      await expect(projectOutcomeEvidence(WS, args())).rejects.toThrow(/db down/);
    });

    it('refuses to run without a workspace or an entity', async () => {
      await expect(projectOutcomeEvidence('', args())).rejects.toThrow(/workspaceId/);
      await expect(projectOutcomeEvidence(WS, args({ entityId: null }))).rejects.toThrow(/entityId/);
    });
  });

  describe('the reference it returns', () => {
    it('names the operational population and the series reduction', async () => {
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.population).toBe('operational');
      expect(ref.selector).toBe('selectOperationalSnapshots');
      expect(ref.reduction).toBe('series');
    });

    it('never claims the canonical population an outcome was not measured on', async () => {
      // I4 at the outcome layer. A canonical verdict window is a different
      // measurement; a reference that could not tell them apart would re-merge
      // two populations the whole Evidence architecture keeps separate.
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.population).not.toBe('canonical-verdict');
      expect(ref.population).not.toBe('canonical-fatigue');
    });

    it('takes observedAt from the row\'s own date, exactly', async () => {
      selectOperationalSnapshots.mockResolvedValue([
        row({ date: new Date('2026-08-02T05:30:00Z') }),
        row({ date: new Date('2026-08-05T05:30:00Z'), source: 'GA4' }),
      ]);
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.observedAt).toEqual(['2026-08-02T05:30:00.000Z', '2026-08-05T05:30:00.000Z']);
      expect(ref.sources).toEqual(['META', 'GA4']);
      expect(ref.entityIds).toEqual([ENT]);
    });

    it('does not date the evidence to the measurement, the window or the clock', async () => {
      // The three plausible substitutes, each excluded by name. Any of them would
      // let a recorded outcome say it was measured against rows that were synced
      // at a moment nobody observed anything.
      const observed = '2026-08-03T06:00:00.000Z';
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.observedAt).toEqual([observed]);
      expect(ref.observedAt).not.toContain(START.toISOString());
      expect(ref.observedAt).not.toContain(END.toISOString());
      expect(ref.observedAt).not.toContain(new Date().toISOString());
    });
  });

  describe('rowCount is CONSUMED; the window decides who contributes', () => {
    it('counts every row the read returned, including those past the window', async () => {
      // THE TWO-COUNT ASSERTION. Three rows were consumed; one of them was synced
      // after the operator's period closed, so it is not evidence FOR that period
      // — but pretending the read only saw two would misdescribe what happened.
      selectOperationalSnapshots.mockResolvedValue([
        row({ date: new Date('2026-08-02T00:00:00Z') }),
        row({ date: new Date('2026-08-07T00:00:00Z') }),
        row({ date: new Date('2026-08-20T00:00:00Z'), source: 'SHOPIFY' }),
      ]);
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.rowCount).toBe(3);
      expect(ref.observedAt).toEqual(['2026-08-02T00:00:00.000Z', '2026-08-07T00:00:00.000Z']);
      expect(ref.sources).toEqual(['META']);          // the late row contributes nothing
      expect(ref.sources).not.toContain('SHOPIFY');
    });

    it('includes a row observed exactly at the closing bound', async () => {
      selectOperationalSnapshots.mockResolvedValue([row({ date: END })]);
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.observedAt).toEqual([END.toISOString()]);
    });

    it('counts a row with an unusable timestamp without claiming it as evidence', async () => {
      selectOperationalSnapshots.mockResolvedValue([row(), row({ date: null, source: 'MANUAL' })]);
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.rowCount).toBe(2);
      expect(ref.sources).toEqual(['META']);
    });
  });

  describe('an empty read is a result', () => {
    it('reports zero rows honestly, and is still a reference', async () => {
      // A period Lumi synced nothing across. "We looked and there was nothing" is
      // a fact about the account — it is not null (not captured), and it does not
      // block an operator from recording what they saw in the ads manager.
      selectOperationalSnapshots.mockResolvedValue([]);
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.rowCount).toBe(0);
      expect(ref.sources).toEqual([]);
      expect(ref.observedAt).toEqual([]);
      expect(ref.entityIds).toEqual([]);
      expect(ref.measurementWindow).toBeNull();
    });

    it('reports sources as NULL — not [] — when the rows carried none', async () => {
      selectOperationalSnapshots.mockResolvedValue([row({ source: null })]);
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.sources).toBeNull();
      expect(ref.sources).not.toEqual([]);
    });
  });

  describe('agreedMeasurementWindow', () => {
    it('reports the one window the contributing rows agree on', async () => {
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.measurementWindow).toBe('ROLLING_WINDOW');
    });

    it('reports NULL when they disagree, rather than preferring one', async () => {
      // The operational population admits more than one window by design, so this
      // genuinely happens. "Not established" is the honest answer; picking the
      // first row's value would invent a measurement period out of an ordering.
      selectOperationalSnapshots.mockResolvedValue([
        row({ measurementWindow: 'ROLLING_WINDOW' }),
        row({ measurementWindow: 'LEGACY_UNKNOWN', date: new Date('2026-08-04T00:00:00Z') }),
      ]);
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.measurementWindow).toBeNull();
    });

    it('is decided by contributing rows only, never by a row outside the window', async () => {
      selectOperationalSnapshots.mockResolvedValue([
        row({ measurementWindow: 'ROLLING_WINDOW' }),
        row({ measurementWindow: 'LEGACY_UNKNOWN', date: new Date('2026-09-09T00:00:00Z') }),
      ]);
      const ref = await projectOutcomeEvidence(WS, args());
      expect(ref.measurementWindow).toBe('ROLLING_WINDOW');
      expect(ref.rowCount).toBe(2);
    });

    it('is pure and null-safe on its own', () => {
      expect(agreedMeasurementWindow([])).toBeNull();
      expect(agreedMeasurementWindow([{ measurementWindow: null }])).toBeNull();
      expect(agreedMeasurementWindow([{ measurementWindow: 'ROLLING_WINDOW' }])).toBe('ROLLING_WINDOW');
    });
  });
});
