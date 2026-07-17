// ============================================================
// RevenueCsvService — fuzzy match + MANUAL revenue actuals
// ------------------------------------------------------------
// Pins the match ladder, the currency-correct minor-unit conversion (incl. the
// 3-decimal Gulf dinar trap), workspace isolation, and — critically — that we
// land a SEPARATE MANUAL-source snapshot (spend 0) rather than overwriting the
// platform row. Unmatched identifiers and no-snapshot campaigns are surfaced.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    campaign: { findMany: vi.fn() },
    metricSnapshot: { findMany: vi.fn(), upsert: vi.fn((args) => Promise.resolve(args)) },
    $transaction: vi.fn((ops) => Promise.all(ops)),
  },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { processRevenueCsv, findBestMatch, parseAmount, parseCount, MAX_REVENUE_CSV_ROWS } from './RevenueCsvService.js';

const CAMPAIGNS = [
  { id: 'u1', name: 'Folla Facebook', externalId: '111' },
  { id: 'u2', name: 'Lead Alex Property', externalId: '222' },
  { id: 'u3', name: 'Sales Campaign', externalId: '333' },
];
const DATE = new Date('2026-07-01T00:00:00Z');
const snap = (entityId, currency = 'EGP') => ({ entityId, date: DATE, currency });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.campaign.findMany.mockResolvedValue(CAMPAIGNS);
  prismaMock.metricSnapshot.findMany.mockResolvedValue(CAMPAIGNS.map((c) => snap(c.id)));
});

// ── Pure helpers ────────────────────────────────────────────────
describe('findBestMatch — exact → case-insensitive → partial', () => {
  it('exact name', () => expect(findBestMatch(CAMPAIGNS, 'Folla Facebook')?.id).toBe('u1'));
  it('exact externalId', () => expect(findBestMatch(CAMPAIGNS, '222')?.id).toBe('u2'));
  it('case-insensitive', () => expect(findBestMatch(CAMPAIGNS, 'folla facebook')?.id).toBe('u1'));
  it('partial containment (export prefix)', () => expect(findBestMatch(CAMPAIGNS, 'EG | Sales Campaign | 2026')?.id).toBe('u3'));
  it('no match → null', () => expect(findBestMatch(CAMPAIGNS, 'Totally Unknown')).toBeNull());
  it('blank/nullish → null', () => {
    expect(findBestMatch(CAMPAIGNS, '')).toBeNull();
    expect(findBestMatch(CAMPAIGNS, null)).toBeNull();
  });
});

describe('parseAmount — strips symbols + thousands separators', () => {
  it('handles "EGP 12,500" and "8,300.50"', () => {
    expect(parseAmount('EGP 12,500')).toBe(12500);
    expect(parseAmount('8,300.50')).toBe(8300.5);
  });
  it('passes a real number through', () => expect(parseAmount(1000)).toBe(1000));
  it('rejects negatives and junk → null', () => {
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe('parseCount — a whole, non-negative count or null', () => {
  it('strips separators a CSV export writes ("1,204" → 1204, where Number() gives NaN)', () => {
    expect(parseCount('1,204')).toBe(1204);
    expect(parseCount(12)).toBe(12);
  });
  it('rounds a fractional cell — a count is whole', () => expect(parseCount('3.6')).toBe(4));
  it('absent / junk / negative → null (never a fabricated 0)', () => {
    expect(parseCount(undefined)).toBeNull();
    expect(parseCount('n/a')).toBeNull();
    expect(parseCount('-4')).toBeNull();
  });
});

// ── processRevenueCsv ───────────────────────────────────────────
describe('processRevenueCsv — lands MANUAL actuals, never overwrites platform', () => {
  it('matches by name and lands a MANUAL-source snapshot with spend 0', async () => {
    const res = await processRevenueCsv('ws1', [{ campaignIdentifier: 'Folla Facebook', revenueAmount: '12,500', currency: 'EGP' }]);
    expect(res).toMatchObject({ matched: 1, updated: 1, unmatched: [], errors: [] });

    const { create } = prismaMock.metricSnapshot.upsert.mock.calls[0][0];
    expect(create).toMatchObject({
      entityId: 'u1', entityLevel: 'CAMPAIGN', source: 'MANUAL', granularity: 'DAILY',
      spendMinor: 0, revenueMinor: 1250000, // 12,500 EGP × 100
      date: DATE, currency: 'EGP',
    });
  });

  it('converts minor units per currency — incl. the 3-decimal Gulf dinar', async () => {
    prismaMock.campaign.findMany.mockResolvedValue([{ id: 'u1', name: 'C', externalId: null }]);
    prismaMock.metricSnapshot.findMany.mockResolvedValue([snap('u1', 'USD')]);

    const cases = [
      { currency: 'USD', amount: '100', expect: 10000 },
      { currency: 'SAR', amount: '100', expect: 10000 },
      { currency: 'AED', amount: '100', expect: 10000 },
      { currency: 'KWD', amount: '100', expect: 100000 }, // 3 decimals → ×1000
    ];
    for (const c of cases) {
      prismaMock.metricSnapshot.upsert.mockClear();
      await processRevenueCsv('ws1', [{ campaignIdentifier: 'C', revenueAmount: c.amount, currency: c.currency }]);
      expect(prismaMock.metricSnapshot.upsert.mock.calls[0][0].create.revenueMinor).toBe(c.expect);
    }
  });

  it('surfaces unmatched identifiers (never silently dropped)', async () => {
    const res = await processRevenueCsv('ws1', [
      { campaignIdentifier: 'Folla Facebook', revenueAmount: '100', currency: 'EGP' },
      { campaignIdentifier: 'Ghost Campaign', revenueAmount: '999', currency: 'EGP' },
    ]);
    expect(res.matched).toBe(1);
    expect(res.updated).toBe(1);
    expect(res.unmatched).toEqual([{ identifier: 'Ghost Campaign', reason: 'no matching campaign' }]);
  });

  it('a matched campaign with no synced snapshot is surfaced, not written', async () => {
    prismaMock.metricSnapshot.findMany.mockResolvedValue([]); // nothing to attach to
    const res = await processRevenueCsv('ws1', [{ campaignIdentifier: 'Folla Facebook', revenueAmount: '100', currency: 'EGP' }]);
    expect(res.updated).toBe(0);
    expect(res.matched).toBe(0);
    expect(res.unmatched[0]).toMatchObject({ identifier: 'Folla Facebook' });
    expect(prismaMock.metricSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('invalid revenue amounts go to errors[], not a fabricated 0', async () => {
    const res = await processRevenueCsv('ws1', [{ campaignIdentifier: 'Folla Facebook', revenueAmount: 'N/A', currency: 'EGP' }]);
    expect(res.updated).toBe(0);
    expect(res.errors[0]).toMatchObject({ identifier: 'Folla Facebook', reason: 'invalid revenue amount' });
    expect(prismaMock.metricSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('workspace isolation — only loads the caller workspace campaigns', async () => {
    await processRevenueCsv('ws1', [{ campaignIdentifier: 'Folla Facebook', revenueAmount: '100' }]);
    expect(prismaMock.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'ws1' } }));
    expect(prismaMock.metricSnapshot.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: 'ws1' });
  });

  it('empty / non-array rows → no work', async () => {
    expect(await processRevenueCsv('ws1', [])).toMatchObject({ matched: 0, updated: 0 });
    expect(prismaMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it('exposes a 500-row cap constant', () => expect(MAX_REVENUE_CSV_ROWS).toBe(500));
});

// The optional conversions column: unlocks Blended CPA for a pixel-less account.
// It must never regress the 2-column upload that shipped before it existed.
describe('processRevenueCsv — the optional conversions column', () => {
  const create = () => prismaMock.metricSnapshot.upsert.mock.calls[0][0].create;

  it('lands a mapped conversion count on the MANUAL snapshot', async () => {
    await processRevenueCsv('ws1', [{ campaignIdentifier: 'Folla Facebook', revenueAmount: '12,500', conversions: '42', currency: 'EGP' }]);
    expect(create()).toMatchObject({ entityId: 'u1', source: 'MANUAL', revenueMinor: 1250000, conversions: 42 });
  });

  it('an omitted conversions column still lands 0 — the pre-existing upload is unchanged', async () => {
    await processRevenueCsv('ws1', [{ campaignIdentifier: 'Folla Facebook', revenueAmount: '12,500', currency: 'EGP' }]);
    expect(create().conversions).toBe(0);
  });

  it('an unparseable conversions cell degrades to 0 — it never fails the revenue row', async () => {
    const res = await processRevenueCsv('ws1', [{ campaignIdentifier: 'Folla Facebook', revenueAmount: '12,500', conversions: 'n/a', currency: 'EGP' }]);
    expect(res).toMatchObject({ matched: 1, updated: 1, errors: [] });
    expect(create().conversions).toBe(0);
  });

  // CPA is SPEND ÷ conversions (snapshotSink) and this row's spend is 0 BY
  // CONTRACT — so CPA is not derivable here. revenue ÷ conversions would be
  // average order value wearing the name `cpaMinor`, which GuardrailSweepService
  // reads as a cost. It must stay null however many conversions land.
  it('never derives cpaMinor from revenue — the MANUAL row carries no spend', async () => {
    await processRevenueCsv('ws1', [{ campaignIdentifier: 'Folla Facebook', revenueAmount: '12,500', conversions: '42', currency: 'EGP' }]);
    expect(create()).toMatchObject({ spendMinor: 0, cpaMinor: null });
  });
});
