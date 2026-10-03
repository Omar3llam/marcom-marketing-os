import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: {
  campaign: { findMany: vi.fn() }, metricSnapshot: { findMany: vi.fn() },
} }));
vi.mock('../../utils/logger.js', () => ({ logger: {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
} }));
import { prisma } from '../../lib/prisma.js';
import { CANONICAL_VERDICT_SELECT, selectCanonicalVerdictSnapshots } from './canonicalVerdictEvidence.js';
import { METRIC_SELECT } from '../entity-graph/EntityGraphService.js';
import { toCampaignRow } from '../entity-graph/entityGraphEngine.js';
import { evaluateConnectorVerdicts } from './connectorVerdictService.js';
import { isAuthoritativeCurrency } from '../../lib/currencyProvenance.js';

const stored = (over = {}) => ({
  entityId: 'c1', source: 'META', currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED',
  date: new Date('2026-10-03T09:00:00Z'), measurementWindow: 'CUMULATIVE_30D',
  windowStart: new Date('2026-09-04T00:00:00Z'), windowEnd: new Date('2026-10-03T00:00:00Z'),
  spendMinor: 10000, revenueMinor: 30000, impressions: 10000, clicks: 200,
  conversions: 10, roas: 3, ctr: 0.02, frequency: 2,
  ...over,
});
let rows;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  rows = [stored()];
  prisma.campaign.findMany.mockResolvedValue([{
    id: 'c1', name: 'Campaign', channel: 'META', objective: 'OUTCOME_SALES', _count: { adSets: 0 },
  }]);
  // Emulate Prisma's SELECT at the real query seam: returning whole objects
  // would conceal the exact defect this suite must detect.
  prisma.metricSnapshot.findMany.mockImplementation(async ({ select }) => rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => select[key] === true))));
});
afterEach(() => vi.useRealTimers());

describe('SC-17A canonical denomination path', () => {
  it('pins monetary field parity with the operational selector', () => {
    for (const key of ['currency', 'currencyProvenance', 'spendMinor']) {
      expect(METRIC_SELECT[key]).toBe(true);
      expect(CANONICAL_VERDICT_SELECT[key]).toBe(true);
    }
  });
  it('stored authoritative origin survives query, resolution, projection and evaluation', async () => {
    const evaluation = await evaluateConnectorVerdicts('ws');
    expect(evaluation.status).toBe('OK');
    expect(evaluation.campaigns[0]).toMatchObject({ currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED' });
    expect(isAuthoritativeCurrency(evaluation.campaigns[0])).toBe(true);
  });
  it.each(['LEGACY_UNKNOWN', 'WORKSPACE_INFERRED', 'FALLBACK_DEFAULT', 'SNAPSHOT_INFERRED', 'USER_SUPPLIED'])
  ('query preserves stored %s exactly, without promoting the evaluated row', async (origin) => {
    rows = [stored({ currencyProvenance: origin })];
    const selected = await selectCanonicalVerdictSnapshots('ws', ['c1']);
    expect(selected[0].currencyProvenance).toBe(origin);
    const evaluation = await evaluateConnectorVerdicts('ws');
    // Existing blended-metric protection may narrow origin to LEGACY_UNKNOWN;
    // preserving stored origin at SELECT must never bypass that protection.
    expect(isAuthoritativeCurrency(evaluation.campaigns[0])).toBe(false);
    expect(evaluation.campaigns[0].currencyProvenance).not.toBe('PLATFORM_REPORTED');
  });
  it('missing persisted origin never gains authority from META or a supported code', async () => {
    rows = [stored({ currencyProvenance: undefined })];
    const evaluation = await evaluateConnectorVerdicts('ws');
    expect(evaluation.campaigns[0].currencyProvenance).toBe('LEGACY_UNKNOWN');
  });
  it('origin preservation changes no scoring, confidence or canonical measurement', async () => {
    const authoritative = await evaluateConnectorVerdicts('ws');
    rows = [stored({ currencyProvenance: 'FALLBACK_DEFAULT' })];
    const unproven = await evaluateConnectorVerdicts('ws');
    expect(unproven.annotated).toEqual(authoritative.annotated);
    expect(unproven.tree).toEqual(authoritative.tree);
  });
  it.each([
    { _revenueCurrency: 'USD', _revenueCurrencyProvenance: 'PLATFORM_REPORTED' },
    { _revenueCurrency: 'EGP', _revenueCurrencyProvenance: 'USER_SUPPLIED' },
  ])('preserves existing blended-unit/origin degradation: %j', (revenue) => {
    const row = toCampaignRow({ id: 'c1' }, stored(revenue));
    expect(row.currencyProvenance).toBe('LEGACY_UNKNOWN');
    expect(isAuthoritativeCurrency(row)).toBe(false);
  });
  it('leaves canonical population, bounds and provider predicates unchanged', async () => {
    await evaluateConnectorVerdicts('ws');
    expect(prisma.metricSnapshot.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        workspaceId: 'ws', entityId: { in: ['c1'] }, entityLevel: 'CAMPAIGN',
        measurementWindow: { equals: 'CUMULATIVE_30D' },
        source: { in: ['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN'] },
      }, orderBy: { date: 'asc' },
    });
  });
});
