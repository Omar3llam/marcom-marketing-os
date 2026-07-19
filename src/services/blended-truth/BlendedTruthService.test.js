// ============================================================
// BlendedTruthService.buildChannelInputs — label join correctness (P1.2)
// ------------------------------------------------------------
// Snapshots are CAMPAIGN-grain: MetricSnapshot.entityId == Campaign.id. The
// label map is now keyed off Campaign.id, so a channel row must carry the
// name/channel of the campaign whose id equals its entityId — never a different
// entity's. Pure function → tested without a DB (mirrors the engine tests).
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildChannelInputs } from './BlendedTruthService.js';

const snap = (over = {}) => ({
  entityId: 'B', entityLevel: 'CAMPAIGN', source: 'META',
  revenueMinor: 0, spendMinor: 0, currency: 'USD', ...over,
});

// labelsById as getBlendedTruth now builds it: keyed by Campaign.id.
const labels = () => new Map([
  ['A', { name: 'Always On',    channel: 'META',   currency: 'USD' }],
  ['B', { name: 'Summer Promo', channel: 'GOOGLE', currency: 'USD' }],
]);

describe('buildChannelInputs — campaign-keyed label join', () => {
  it('INVARIANT: a snapshot with entityId=B resolves to Campaign B, NOT Campaign A', () => {
    const [row] = buildChannelInputs([snap({ entityId: 'B' })], labels());
    expect(row.channelId).toBe('B');
    expect(row.name).toBe('Summer Promo'); // B's name, never A's
    expect(row.channel).toBe('GOOGLE');    // B's channel, never A's
  });

  it('hits the label map on the campaign id (returns name + channel)', () => {
    const [row] = buildChannelInputs([snap({ entityId: 'A' })], labels());
    expect(row.name).toBe('Always On');
    expect(row.channel).toBe('META');
  });

  it('is graceful when no campaign matches the entityId (name/channel null)', () => {
    const [row] = buildChannelInputs([snap({ entityId: 'Z-orphan' })], labels());
    expect(row.name).toBeNull();
    expect(row.channel).toBeNull();
    expect(row.channelId).toBe('Z-orphan'); // the view's last-resort identity
  });

  it('aggregates spend/platform/actual per entity unchanged (labels are identity-only)', () => {
    const rows = buildChannelInputs([
      snap({ entityId: 'B', source: 'META', spendMinor: 2000, revenueMinor: 8000 }),
      snap({ entityId: 'B', source: 'GA4',  revenueMinor: 6000 }), // actual
    ], labels());
    expect(rows).toHaveLength(1);
    const b = rows[0];
    expect(b.spendMinor).toBe(2000);
    expect(b.platformRevenueMinor).toBe(8000);
    expect(b.actualRevenueMinor).toBe(6000);
  });
});
