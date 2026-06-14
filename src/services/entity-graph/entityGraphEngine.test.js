// ============================================================
// EntityGraphEngine — pure shaping correctness
// ============================================================
import { describe, it, expect } from 'vitest';
import { latestByEntity, toCampaignRow, toAdSetRow } from './entityGraphEngine.js';

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

  it('toCampaignRow nulls every metric when the snapshot is missing', () => {
    const row = toCampaignRow({ id: 'c2', name: 'Cold', channel: 'GOOGLE', adSetCount: 0 }, undefined);
    expect(row.spendMinor).toBeNull();
    expect(row.roas).toBeNull();
    expect(row.ctr).toBeNull();
    expect(row.frequency).toBeNull();
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
