// ============================================================
// R5 — the two provenance loss points in the entity-graph projection
// ============================================================
// Discovery located exactly where a verdict's evidence stopped being nameable:
//
//   metricsOf            — `source` was dropped here outright
//   toCampaignRow → tree — `date` survived only as `lastDate` and was dropped
//                          building the verdict node
//
// Both are pure functions, so both are testable without a database. What this
// file protects is that a projected row can say WHICH row(s) its numbers came
// from — including the case the whole R5 shape exists for, where there are two.
// ============================================================
import { describe, it, expect } from 'vitest';
import { effectiveByEntity, toCampaignRow } from './entityGraphEngine.js';

const C1 = 'c1';
const AUG10 = new Date('2026-08-10T09:00:00Z');
const AUG11 = new Date('2026-08-11T09:00:00Z');

const platform = (over = {}) => ({
  entityId: C1, source: 'META', date: AUG10,
  spendMinor: 100_000, revenueMinor: 0, conversions: 0, roas: null, ...over,
});
const actual = (over = {}) => ({
  entityId: C1, source: 'GA4', date: AUG11,
  spendMinor: 0, revenueMinor: 400_000, conversions: 12, ...over,
});

const campaign = { id: C1, name: 'Eid', channel: 'META' };
const rowsOf = (snap) => toCampaignRow(campaign, snap).evidenceRows;

describe('R5 — metricsOf keeps the row its numbers came from', () => {
  it('names the source, which this projection used to drop', () => {
    // The loss point, stated as an assertion. Before R5 nothing downstream of
    // here could say a verdict was decided on META rather than GOOGLE.
    expect(rowsOf(platform())).toEqual([
      { entityId: C1, source: 'META', observedAt: AUG10 },
    ]);
  });

  it('names the OBSERVATION timestamp, not a rendering of it', () => {
    // `lastDate` still rides on the row for display. This is the same instant
    // kept as provenance, so the verdict path stops depending on a display field
    // it was about to drop anyway.
    const row = toCampaignRow(campaign, platform());
    expect(row.evidenceRows[0].observedAt).toBe(AUG10);
    expect(row.lastDate).toBe(AUG10); // display, unchanged
  });

  it('reports NO rows when there is no snapshot — never a fabricated one', () => {
    // The same honesty the metric nulls carry: an unmeasured campaign has no
    // evidence, and an empty list says so without inventing a source or a date.
    expect(rowsOf(undefined)).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
  });

  it('leaves the metric projection alone', () => {
    // R5 is additive here. A provenance field that had quietly changed a
    // displayed number would be the one thing this PR must not do.
    const row = toCampaignRow(campaign, platform({ roas: 4, ctr: 0.0164 }));
    expect(row.spendMinor).toBe(100_000);
    expect(row.roas).toBe(4);
    expect(row.ctr).toBe(0.0164);
  });
});

describe('R5 — a BLENDED row describes both rows it was built from', () => {
  it('carries two sources and two observation times', () => {
    // THE REASON A SINGLE `snapshotId` WOULD NOT HAVE DONE. effectiveByEntity
    // overlays an actual-revenue row onto a platform row: the spend is META's,
    // observed on the 10th; the revenue is GA4's, observed on the 11th. One
    // reference would have to pick one and misattribute the other.
    const merged = effectiveByEntity([platform(), actual()]).get(C1);
    expect(rowsOf(merged)).toEqual([
      { entityId: C1, source: 'META', observedAt: AUG10 },
      { entityId: C1, source: 'GA4',  observedAt: AUG11 },
    ]);
  });

  it('puts the contributing rows in the order they contribute', () => {
    // Platform first: it supplies the spend and everything else. The actual
    // supplies revenue, and possibly the conversion count.
    const merged = effectiveByEntity([platform(), actual()]).get(C1);
    expect(merged.revenueMinor).toBe(400_000);
    expect(rowsOf(merged).map((r) => r.source)).toEqual(['META', 'GA4']);
  });

  it('OMITS an actual that was too stale to be used', () => {
    // The row keeps its platform figures and flags `revenueStale`, so the actual
    // contributed nothing. Listing it would be the reference claiming evidence
    // the number never rested on.
    // The bound is passed explicitly rather than leaned on: REVENUE_MAX_AGE_MS
    // reads an env var, and a fixture that depended on its default would pass or
    // fail according to how the machine was configured.
    const stale = actual({ date: new Date('2026-01-01T09:00:00Z') });
    const merged = effectiveByEntity([platform(), stale], { maxRevenueAgeMs: 90 * 86_400_000 }).get(C1);
    expect(merged.revenueStale).toBe(true);
    expect(rowsOf(merged)).toEqual([
      { entityId: C1, source: 'META', observedAt: AUG10 },
    ]);
    expect(rowsOf(merged).map((r) => r.source)).not.toContain('GA4');
  });

  it('a platform-only entity still reports exactly one row', () => {
    const merged = effectiveByEntity([platform()]).get(C1);
    expect(rowsOf(merged)).toHaveLength(1);
  });
});

describe('R5 — the basis is declared by the reader, never guessed from the row', () => {
  it('rides onto the row untouched when the caller declares one', () => {
    const basis = {
      population: 'canonical-verdict', selector: 'selectCanonicalVerdictSnapshots',
      measurementWindow: 'CUMULATIVE_30D', reduction: 'latest-per-entity', rowCount: 11,
    };
    expect(toCampaignRow(campaign, platform(), basis).evidenceBasis).toEqual(basis);
  });

  it('is NULL when no caller declared one — the row infers nothing', () => {
    // A projection that guessed a population from the row in front of it would
    // be reading a population out of a value, which is the merge the
    // canonical/operational split exists to prevent.
    expect(toCampaignRow(campaign, platform()).evidenceBasis).toBeNull();
  });
});
