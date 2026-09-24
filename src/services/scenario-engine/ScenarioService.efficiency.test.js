import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: {
  accountPattern: { findMany: vi.fn(async () => []) },
  workspace: { findUnique: vi.fn(async () => ({ cohortTag: null })) },
} }));
vi.mock('../blended-truth/BlendedTruthService.js', () => ({ getBlendedTruth: vi.fn() }));
vi.mock('../unit-economics/EconomicsService.js', () => ({ getEconomics: vi.fn(async () => ({
  economics: { aovMinor: 5_000, grossMarginPct: 0.5, currency: 'USD' }, isDefault: false,
})) }));
vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { runScenario } from './ScenarioService.js';
import { projectScenario } from './scenarioEngine.js';

const channel = (efficiency = { status: 'VALID', reason: null, value: 3 }) => ({
  channelId: 'meta', channel: 'META', spendMinor: 100_000, blendedRevenueMinor: 300_000,
  currency: 'USD', monetaryStatus: 'MONETARY_VALID', monetaryReason: null,
  blendedRevenueEfficiency: efficiency,
});
const change = { type: 'BUDGET_EXPANSION', deltaPct: 0.2 };
const economics = { aovMinor: 5_000, grossMarginPct: 0.5, currency: 'USD' };

beforeEach(() => getBlendedTruth.mockResolvedValue({ channels: [channel()] }));

describe('scenario blended efficiency', () => {
  it('preserves the existing scenario methodology when evidence is valid', async () => {
    const out = await runScenario('ws', { change });
    const expected = projectScenario({ baseline: [{ channelId: 'meta', channel: 'META', spendMinor: 100_000, blendedRoas: 3 }],
      change, economics, config: { monetaryCurrency: 'USD' } });
    expect(out.efficiencyStatus).toBe('VALID');
    expect(out.projections).toEqual(expected.projections);
    expect(out.projections.blendedRevenueEfficiencyAfter.expected).toBeGreaterThan(0);
  });
  it.each(['MEASUREMENT_WINDOW_UNKNOWN', 'MEASUREMENT_WINDOW_MISMATCH', 'CURRENCY_MISMATCH'])(
    'keeps %s unavailable without fabricating a scenario ratio', async (reason) => {
      getBlendedTruth.mockResolvedValueOnce({ channels: [channel({ status: 'UNAVAILABLE', reason, value: null })] });
      const out = await runScenario('ws', { change });
      expect(out.efficiencyStatus).toBe('UNAVAILABLE');
      expect(out.efficiencyReason).toBe(reason);
      expect(out.currency).toBe('USD');
      expect(out.projections.blendedRevenueEfficiencyAfter).toEqual({ low: null, expected: null, high: null });
      expect(out.projections.revenueMinor.expected).toBeNull();
    },
  );
});
