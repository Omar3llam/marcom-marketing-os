// ============================================================
// FatigueForecastService — per-campaign named fatigue forecast
// ------------------------------------------------------------
// prisma is mocked; the REAL forecaster (forecastFatigue) + series builder run,
// so these assert the reuse end-to-end. Snapshots are date-ordered daily points.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: { metricSnapshot: { findMany: vi.fn() } } }));

import { prisma } from '../../lib/prisma.js';
import { computeFatigueForecast } from './FatigueForecastService.js';

// One canonical CUMULATIVE_30D observation per day: each point is the trailing
// 30-day frequency AS OBSERVED on that day, not that day's own frequency.
const day = (n) => new Date(Date.UTC(2026, 6, n)).toISOString();
const snaps = (entityId, freqs, reach = null) =>
  freqs.map((frequency, i) => ({
    entityId, entityLevel: 'CAMPAIGN', date: day(1 + i), frequency, ctr: 0.02, reach,
  }));
// Phase K: the campaign row supplies IDENTITY only. Its `frequency` is the
// operational reading and is deliberately ignored — several tests below pass a
// deliberately wrong one to prove it cannot reach the output.
const campaign = (entityId, name, frequency) => ({ entityId, name, channel: 'meta', frequency });

beforeEach(() => vi.clearAllMocks());

describe('computeFatigueForecast', () => {
  it('flags an already-saturated campaign (freq ≥ 3.5) as SATURATED, 0 days', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c1', [3.4, 3.6]));
    const [row] = await computeFatigueForecast('ws1', [campaign('c1', 'Ramadan Wave', 3.6)]);
    expect(row).toMatchObject({ name: 'Ramadan Wave', status: 'SATURATED', daysUntilSaturation: 0 });
  });

  it('flags a fast-rising campaign breaching within a week as AT_RISK with a velocity', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c2', [3.0, 3.2]));
    const [row] = await computeFatigueForecast('ws1', [campaign('c2', 'Reels TOFU', 3.2)]);
    expect(row.status).toBe('AT_RISK');
    expect(row.daysUntilSaturation).toBeLessThanOrEqual(7);
    expect(row.velocity).toBeGreaterThan(0); // +X/day, never null when rising
  });

  it('reports flat/declining frequency as STABLE with null velocity + null days', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c3', [3.0, 2.9]));
    const [row] = await computeFatigueForecast('ws1', [campaign('c3', 'Steady Evergreen', 2.9)]);
    expect(row.status).toBe('STABLE');
    expect(row.velocity).toBeNull();       // never "+0.00/day"
    expect(row.daysUntilSaturation).toBeNull();
  });

  it('excludes a single-snapshot campaign that is NOT saturated (no fabricated velocity)', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c4', [2.0])); // 1 point → no trend
    const out = await computeFatigueForecast('ws1', [campaign('c4', 'Just Launched', 2.0)]);
    expect(out).toHaveLength(0);
  });

  it('still surfaces a single-snapshot campaign when it is ALREADY saturated', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c5', [4.0]));
    const [row] = await computeFatigueForecast('ws1', [campaign('c5', 'Overexposed', 4.0)]);
    expect(row).toMatchObject({ status: 'SATURATED', velocity: null, daysUntilSaturation: 0 });
  });

  it('batches all campaigns into ONE snapshot query (no N+1) and sorts by urgency', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([
      ...snaps('c1', [3.4, 3.6]),  // SATURATED
      ...snaps('c2', [3.0, 3.2]),  // AT_RISK
      ...snaps('c3', [3.0, 2.9]),  // STABLE
    ]);
    const out = await computeFatigueForecast('ws1', [
      campaign('c3', 'Stable', 2.9),
      campaign('c2', 'AtRisk', 3.2),
      campaign('c1', 'Saturated', 3.6),
    ]);
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1); // ONE call for N campaigns
    expect(out.map((r) => r.status)).toEqual(['SATURATED', 'AT_RISK', 'STABLE']);
  });

  it('scopes the query to the workspace + the requested entityIds', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await computeFatigueForecast('ws1', [campaign('c1', 'A', 2.0), campaign('c2', 'B', 2.5)]);
    const where = prisma.metricSnapshot.findMany.mock.calls[0][0].where;
    expect(where.workspaceId).toBe('ws1');
    expect(where.entityId).toEqual({ in: ['c1', 'c2'] });
  });

  it('returns [] without querying when there are no campaigns at all', async () => {
    expect(await computeFatigueForecast('ws1', [])).toEqual([]);
    expect(await computeFatigueForecast('ws1', [{ name: 'no id' }])).toEqual([]);
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });

  // Phase K: the operational `frequency` is no longer the gate. A campaign whose
  // operational row has none may still have canonical evidence, and refusing to
  // look would hide a real fatigue reading behind a field this service no longer
  // treats as evidence.
  it('still queries a campaign whose OPERATIONAL frequency is null', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c1', [3.0, 3.2]));
    const [row] = await computeFatigueForecast('ws1', [campaign('c1', 'No operational freq', null)]);
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    expect(row.currentFrequency).toBe(3.2); // from the canonical row, not the null
  });
});

// A campaign row carrying reach. Phase K: this reach is OPERATIONAL and must
// never reach the output — canonical reach comes off the snapshot row.
const campaignR = (entityId, name, frequency, reach) => ({ entityId, name, channel: 'meta', frequency, reach });

describe('computeFatigueForecast — reach + exhaustionPct (honest, additive)', () => {
  it('surfaces canonical reach and % of ceiling when reach is present', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c2', [3.0, 3.2], 5000));
    const [row] = await computeFatigueForecast('ws1', [campaign('c2', 'Reels', 3.2)]);
    expect(row.reach).toBe(5000);
    expect(row.exhaustionPct).toBe(91); // round(3.2 / 3.5 * 100), status untouched
    expect(row.status).toBe('AT_RISK'); // forward-looking status NOT overridden by the %
  });

  it('leaves exhaustionPct + reach null when the CANONICAL row has no reach', async () => {
    // The campaign row carries a reach; it is operational, so it is not evidence.
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c2', [3.0, 3.2], null));
    const [row] = await computeFatigueForecast('ws1', [campaignR('c2', 'Reels', 3.2, 9999)]);
    expect(row.reach).toBeNull();
    expect(row.exhaustionPct).toBeNull(); // never fabricated without real canonical reach
  });

  it('caps exhaustionPct at 100 for an already-saturated single-point campaign', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c5', [4.0], 8000));
    const [row] = await computeFatigueForecast('ws1', [campaign('c5', 'Overexposed', 4.0)]);
    expect(row.status).toBe('SATURATED');
    expect(row.exhaustionPct).toBe(100); // 4.0/3.5 → 114, clamped to 100
  });
});

// ── Phase K: evidence provenance ────────────────────────────────────────────
// The point of the phase, asserted directly: the operational campaign row can no
// longer influence a single number on this surface.
describe('computeFatigueForecast — canonical evidence only (Phase K)', () => {
  it('asks for CUMULATIVE_30D at CAMPAIGN level, never an operational window', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await computeFatigueForecast('ws1', [campaign('c1', 'A', 2.0)]);
    const { where } = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(where.measurementWindow).toEqual({ equals: 'CUMULATIVE_30D' });
    expect(where.entityLevel).toBe('CAMPAIGN');
  });

  it('omits a campaign with NO canonical row instead of using the operational one', async () => {
    // Operationally this campaign is loudly saturated. Without canonical
    // evidence it is simply not measured over the window, so it is not shown.
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    const out = await computeFatigueForecast('ws1', [campaignR('c1', 'Looks saturated', 9.9, 5000)]);
    expect(out).toEqual([]);
  });

  it('ignores the operational frequency and reach entirely', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c1', [3.0, 3.2], 4321));
    const [row] = await computeFatigueForecast('ws1', [campaignR('c1', 'Reels', 9.9, 111_111)]);
    expect(row.currentFrequency).toBe(3.2);  // canonical, not 9.9
    expect(row.reach).toBe(4321);            // canonical, not 111111
    expect(row.status).toBe('AT_RISK');      // 9.9 would have been SATURATED
  });

  it('carries canonical frequency verbatim — never summed or averaged across days', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(snaps('c1', [3.0, 3.1, 3.2], 5000));
    const [row] = await computeFatigueForecast('ws1', [campaign('c1', 'Reels', 0)]);
    expect(row.currentFrequency).toBe(3.2);  // the latest observation
    expect(row.currentFrequency).not.toBe(9.3);   // Σ
    expect(row.currentFrequency).toBeCloseTo(3.2, 5);
    expect(row.reach).toBe(5000);            // NOT 15000 (Σ reach)
  });
});
