// ============================================================
// EntityGraphEngine — pure shaping correctness
// ============================================================
import { describe, it, expect } from 'vitest';
import { latestByEntity, effectiveByEntity, toCampaignRow, toAdSetRow } from './entityGraphEngine.js';

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
