// ============================================================
// EntityGraphEngine — pure shaping correctness
// ============================================================
import { describe, it, expect } from 'vitest';
import { latestByEntity, effectiveByEntity, toCampaignRow, toAdSetRow, REVENUE_MAX_AGE_MS } from './entityGraphEngine.js';

describe('entityGraphEngine.latestByEntity', () => {
  it('keeps the latest snapshot per entity regardless of input order', () => {
    const m = latestByEntity([
      { entityId: 'a', date: '2026-01-01', spendMinor: 100 },
      { entityId: 'a', date: '2026-03-01', spendMinor: 300 },
      { entityId: 'a', date: '2026-02-01', spendMinor: 200 },
      { entityId: 'b', date: '2026-01-15', spendMinor: 50 },
    ]);
    expect(m.size).toBe(2);
    expect(m.get('a').spendMinor).toBe(300);  // max date wins
    expect(m.get('b').spendMinor).toBe(50);
  });

  it('ignores rows with no entityId (and a null row)', () => {
    const m = latestByEntity([{ date: '2026-01-01' }, null, { entityId: 'x', date: '2026-01-01' }]);
    expect(m.size).toBe(1);
    expect(m.has('x')).toBe(true);
  });

  it('returns an empty map for no snapshots', () => {
    expect(latestByEntity().size).toBe(0);
    expect(latestByEntity([]).size).toBe(0);
  });
});

describe('entityGraphEngine.effectiveByEntity — overlay actual revenue onto the platform row', () => {
  it('no actual rows → identical to latest-per-entity (zero behaviour change)', () => {
    const snaps = [
      { entityId: 'a', source: 'META', date: '2026-01-01', spendMinor: 100, revenueMinor: 0, roas: null },
      { entityId: 'a', source: 'META', date: '2026-03-01', spendMinor: 300, revenueMinor: 0, roas: null },
    ];
    const eff = effectiveByEntity(snaps).get('a');
    expect(eff.spendMinor).toBe(300); // latest platform row
    expect(eff.revenueMinor).toBe(0);
    expect(eff.roas).toBeNull();
  });

  it('a MANUAL actual overlays revenue onto the platform spend and re-derives roas', () => {
    const snaps = [
      { entityId: 'a', source: 'META', date: '2026-07-01', spendMinor: 10000, revenueMinor: 0, roas: null },
      { entityId: 'a', source: 'MANUAL', date: '2026-07-01', spendMinor: 0, revenueMinor: 40000, roas: null },
    ];
    const eff = effectiveByEntity(snaps).get('a');
    expect(eff.spendMinor).toBe(10000);   // platform spend survives (MANUAL spend:0 does NOT shadow)
    expect(eff.revenueMinor).toBe(40000); // manual revenue overlays
    expect(eff.roas).toBe(4);             // 40000 / 10000, re-derived from platform spend
  });

  it('overlay never lets a spend-0 actual row shadow platform spend even when it is newer', () => {
    const snaps = [
      { entityId: 'a', source: 'META', date: '2026-07-01', spendMinor: 5000, revenueMinor: 0 },
      { entityId: 'a', source: 'GA4', date: '2026-07-05', spendMinor: 0, revenueMinor: 15000 }, // newer, spend 0
    ];
    const eff = effectiveByEntity(snaps).get('a');
    expect(eff.spendMinor).toBe(5000); // platform base, not the newer GA4 spend-0 row
    expect(eff.revenueMinor).toBe(15000);
    expect(eff.roas).toBe(3);
  });

  it('an actual with no revenue does not overlay (keeps the platform row)', () => {
    const snaps = [
      { entityId: 'a', source: 'META', date: '2026-07-01', spendMinor: 5000, revenueMinor: 200, roas: 0.04 },
      { entityId: 'a', source: 'MANUAL', date: '2026-07-02', spendMinor: 0, revenueMinor: 0 },
    ];
    const eff = effectiveByEntity(snaps).get('a');
    expect(eff.revenueMinor).toBe(200);
    expect(eff.roas).toBe(0.04);
  });

  it('actual-only entity (no platform row) returns the actual row as-is', () => {
    const eff = effectiveByEntity([{ entityId: 'a', source: 'MANUAL', date: '2026-07-01', spendMinor: 0, revenueMinor: 9000 }]).get('a');
    expect(eff.revenueMinor).toBe(9000);
    expect(eff.spendMinor).toBe(0);
  });

  // A manual upload may carry the conversion COUNT a pixel-less account has no
  // other way to report. Without this overlay it would sit on the spend-0 MANUAL
  // row, shadowed by the platform row, and never reach the Blended CPA aggregate
  // — the feature would silently no-op.
  it('a MANUAL actual overlays its conversion count onto the platform row', () => {
    const snaps = [
      { entityId: 'a', source: 'META', date: '2026-07-01', spendMinor: 10000, revenueMinor: 0, conversions: 0 },
      { entityId: 'a', source: 'MANUAL', date: '2026-07-01', spendMinor: 0, revenueMinor: 40000, conversions: 8 },
    ];
    const eff = effectiveByEntity(snaps).get('a');
    expect(eff.conversions).toBe(8);
    expect(eff.spendMinor).toBe(10000); // CPA is derivable downstream: 10000 / 8
  });

  it('an actual with no conversions column leaves a counting pixel standing (never erases it)', () => {
    const snaps = [
      { entityId: 'a', source: 'META', date: '2026-07-01', spendMinor: 10000, revenueMinor: 0, conversions: 12 },
      { entityId: 'a', source: 'MANUAL', date: '2026-07-01', spendMinor: 0, revenueMinor: 40000, conversions: 0 },
    ];
    expect(effectiveByEntity(snaps).get('a').conversions).toBe(12);
  });

  it('stale revenue withholds the conversion count too — old counts do not pair with newer spend', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const snaps = [
      { entityId: 'a', source: 'META', date: '2026-08-01', spendMinor: 10000, revenueMinor: 0, conversions: 0 },
      { entityId: 'a', source: 'MANUAL', date: '2026-07-01', spendMinor: 0, revenueMinor: 40000, conversions: 8 },
    ];
    const eff = effectiveByEntity(snaps, { maxRevenueAgeMs: 30 * DAY }).get('a');
    expect(eff.conversions).toBe(0);      // platform's own count, untouched
    expect(eff.revenueStale).toBe(true);
  });
});

// A connector row is a rolling-window aggregate re-stamped on every sync, so a
// once-uploaded revenue drifts away from the spend it gets divided by. Past the
// bound we stop scoring it rather than publish a confidently wrong ROAS. The lag
// is measured BETWEEN THE ROWS, never against the wall clock, so this stays pure.
describe('entityGraphEngine.effectiveByEntity — revenue staleness bound', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const platformAt = (iso, over = {}) => ({ entityId: 'a', source: 'META', date: iso, spendMinor: 10000, revenueMinor: 0, roas: null, ...over });
  const manualAt = (iso, revenueMinor = 40000) => ({ entityId: 'a', source: 'MANUAL', date: iso, spendMinor: 0, revenueMinor });

  it('revenue within the bound still overlays and is marked fresh', () => {
    // platform 29 days ahead of the upload → inside a 30-day bound
    const eff = effectiveByEntity([platformAt('2026-07-30'), manualAt('2026-07-01')], { maxRevenueAgeMs: 30 * DAY }).get('a');
    expect(eff.revenueMinor).toBe(40000);
    expect(eff.roas).toBe(4);
    expect(eff.revenueStale).toBe(false);
  });

  it('revenue lagging the platform row past the bound does NOT overlay — no scored ROAS', () => {
    // platform 31 days ahead of the upload → the spend has moved on
    const eff = effectiveByEntity([platformAt('2026-08-01'), manualAt('2026-07-01')], { maxRevenueAgeMs: 30 * DAY }).get('a');
    expect(eff.revenueMinor).toBe(0);      // platform's own figure, untouched
    expect(eff.roas).toBeNull();           // never a stale-revenue ROAS
    expect(eff.revenueStale).toBe(true);   // "revenue data outdated", not "never uploaded"
  });

  it('a stale manual upload never blanks a fresh platform pixel revenue', () => {
    // The regression the honest-null instinct would cause: nulling revenueMinor
    // on stale would discard the platform's OWN current revenue.
    const eff = effectiveByEntity(
      [platformAt('2026-08-01', { revenueMinor: 25000, roas: 2.5 }), manualAt('2026-07-01')],
      { maxRevenueAgeMs: 30 * DAY },
    ).get('a');
    expect(eff.revenueMinor).toBe(25000);  // pixel revenue stands on its own
    expect(eff.roas).toBe(2.5);
    expect(eff.revenueStale).toBe(true);
  });

  it('an actual NEWER than the platform row is fresh, never stale (negative lag)', () => {
    const eff = effectiveByEntity([platformAt('2026-07-01'), manualAt('2026-07-20')], { maxRevenueAgeMs: 30 * DAY }).get('a');
    expect(eff.revenueMinor).toBe(40000);
    expect(eff.revenueStale).toBe(false);
  });

  it('exactly at the bound still overlays (only PAST it goes stale)', () => {
    const eff = effectiveByEntity([platformAt('2026-07-31'), manualAt('2026-07-01')], { maxRevenueAgeMs: 30 * DAY }).get('a');
    expect(eff.revenueStale).toBe(false);
    expect(eff.revenueMinor).toBe(40000);
  });

  it('a never-synced-again account is NOT stale — its revenue and spend are contemporaries', () => {
    // Both rows old in wall-clock terms, but aligned with each other. A wall-clock
    // Date.now() bound would wrongly flag this; connectorHealth owns staleness here.
    const eff = effectiveByEntity([platformAt('2020-01-02'), manualAt('2020-01-01')], { maxRevenueAgeMs: 30 * DAY }).get('a');
    expect(eff.revenueStale).toBe(false);
    expect(eff.roas).toBe(4);
  });

  it('the bound is order-independent and defaults without an options arg', () => {
    const rows = [manualAt('2026-07-01'), platformAt('2026-07-02')];
    expect(effectiveByEntity(rows).get('a').revenueMinor).toBe(40000); // default 90d
    expect(effectiveByEntity([...rows].reverse()).get('a').revenueMinor).toBe(40000);
  });
});

// The default bound was widened 30 → 90 days: a manual revenue upload stays
// evidence about its spend for a full quarter before we stop scoring it. These
// lock the DEFAULT (options-less) behaviour — the value the REVENUE_MAX_AGE_DAYS
// env var populates at module load — at the 90-day boundary.
describe('entityGraphEngine.effectiveByEntity — 90-day default staleness bound', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const platformAt = (iso, over = {}) => ({ entityId: 'a', source: 'META', date: iso, spendMinor: 10000, revenueMinor: 0, roas: null, ...over });
  const manualAt = (iso, revenueMinor = 40000) => ({ entityId: 'a', source: 'MANUAL', date: iso, spendMinor: 0, revenueMinor });

  it('the default bound is 90 days', () => {
    expect(REVENUE_MAX_AGE_MS).toBe(90 * DAY);
  });

  it('revenue 89 days behind the platform row still overlays and is fresh (default bound)', () => {
    // No options arg → uses REVENUE_MAX_AGE_MS. 89-day lag is inside 90.
    const eff = effectiveByEntity([platformAt('2026-09-28'), manualAt('2026-07-01')]).get('a');
    expect(eff.revenueMinor).toBe(40000);
    expect(eff.roas).toBe(4);
    expect(eff.revenueStale).toBe(false);
  });

  it('revenue 91 days behind the platform row goes stale — no scored ROAS (default bound)', () => {
    // 91-day lag is past 90: the upload no longer pairs with this spend.
    const eff = effectiveByEntity([platformAt('2026-09-30'), manualAt('2026-07-01')]).get('a');
    expect(eff.revenueMinor).toBe(0);      // platform figure untouched
    expect(eff.roas).toBeNull();
    expect(eff.revenueStale).toBe(true);
  });

  it('the bound is overridable per call — the seam REVENUE_MAX_AGE_DAYS feeds at load', () => {
    // A 60-day lag is fresh under the 90-day default but stale under a tighter
    // injected bound: proves the value is a knob, not a constant baked into logic.
    const rows = [platformAt('2026-08-30'), manualAt('2026-07-01')]; // 60-day lag
    expect(effectiveByEntity(rows).get('a').revenueStale).toBe(false);              // default 90d
    expect(effectiveByEntity(rows, { maxRevenueAgeMs: 30 * DAY }).get('a').revenueStale).toBe(true); // override
  });
});

describe('entityGraphEngine shapers — null-where-absent (honest "—", never a fabricated 0)', () => {
  it('toCampaignRow lifts real metrics verbatim', () => {
    const row = toCampaignRow(
      { id: 'c1', name: 'Summer Promo', channel: 'META', adSetCount: 3 },
      { spendMinor: 4200, roas: 2.1, ctr: 0.03, frequency: 1.4, currency: 'EGP', date: '2026-06-01' },
    );
    expect(row).toMatchObject({
      entityId: 'c1', name: 'Summer Promo', channel: 'META', adSetCount: 3,
      spendMinor: 4200, roas: 2.1, ctr: 0.03, frequency: 1.4, currency: 'EGP',
    });
  });

  // revenueStale has to survive the projection or the reader can never tell
  // "revenue outdated" from "never uploaded" — two different things to say.
  it('toCampaignRow carries revenueStale through, defaulting false', () => {
    const stale = toCampaignRow({ id: 'c1', name: 'A', channel: 'META' },
      { spendMinor: 100, revenueStale: true, date: '2026-06-01' });
    expect(stale.revenueStale).toBe(true);
    const fresh = toCampaignRow({ id: 'c2', name: 'B', channel: 'META' },
      { spendMinor: 100, date: '2026-06-01' }); // no actual row at all
    expect(fresh.revenueStale).toBe(false);
  });

  it('toCampaignRow lifts reach verbatim and nulls it when unreported', () => {
    expect(toCampaignRow({ id: 'c1', name: 'A', channel: 'META', adSetCount: 0 },
      { reach: 12000, frequency: 2.1, date: '2026-06-01' }).reach).toBe(12000);
    expect(toCampaignRow({ id: 'c2', name: 'B', channel: 'META', adSetCount: 0 },
      { frequency: 2.1, date: '2026-06-01' }).reach).toBeNull(); // snapshot without reach
  });

  it('toCampaignRow nulls every metric when the snapshot is missing', () => {
    const row = toCampaignRow({ id: 'c2', name: 'Cold', channel: 'GOOGLE', adSetCount: 0 }, undefined);
    expect(row.spendMinor).toBeNull();
    expect(row.roas).toBeNull();
    expect(row.ctr).toBeNull();
    expect(row.frequency).toBeNull();
    expect(row.reach).toBeNull();
    expect(row.currency).toBeNull();
    expect(row.lastDate).toBeNull();
    expect(row.adSetCount).toBe(0);   // structural field still real
  });

  it('toCampaignRow defaults a missing adSetCount to 0', () => {
    expect(toCampaignRow({ id: 'c3', name: 'X', channel: 'META' }, undefined).adSetCount).toBe(0);
  });

  it('toAdSetRow lifts metrics and nulls a missing snapshot', () => {
    expect(toAdSetRow({ id: 'as1', name: 'Lookalike 1%', channel: 'META' },
      { spendMinor: 900, roas: 3.0, ctr: 0.05, frequency: 1.1, currency: 'USD', date: '2026-06-02' }))
      .toMatchObject({ entityId: 'as1', name: 'Lookalike 1%', spendMinor: 900, roas: 3.0 });

    const empty = toAdSetRow({ id: 'as2', name: 'Broad', channel: 'META' }, undefined);
    expect(empty.spendMinor).toBeNull();
    expect(empty.ctr).toBeNull();
  });
});
