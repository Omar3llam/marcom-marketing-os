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

// Daily snapshot for an entity on day N of 2026-07.
const day = (n) => new Date(Date.UTC(2026, 6, n)).toISOString();
const snaps = (entityId, freqs) =>
  freqs.map((frequency, i) => ({ entityId, entityLevel: 'CAMPAIGN', date: day(1 + i), frequency, ctr: 0.02 }));
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

  it('returns [] without querying when there are no campaigns / no frequency', async () => {
    expect(await computeFatigueForecast('ws1', [])).toEqual([]);
    expect(await computeFatigueForecast('ws1', [{ entityId: 'c1', name: 'x', frequency: null }])).toEqual([]);
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});
