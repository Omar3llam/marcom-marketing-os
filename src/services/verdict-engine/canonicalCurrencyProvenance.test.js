import { canonicalContentHash } from './evidenceReference.js';
import { Prisma } from '@prisma/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: {
  campaign: { findMany: vi.fn() }, $queryRaw: vi.fn(),
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
  // The immutable projection, including stored denomination, is the actual query result.
  prisma.$queryRaw.mockImplementation(async () => captured(rows));
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
    // References must differ with the stored denomination fact. Everything
    // about the statistical evaluation remains identical.
    const withoutRefs = (node) => {
      const rest = { ...node }; delete rest.evidenceRows;
      return { ...rest, ...(node.children ? { children: node.children.map(withoutRefs) } : {}) };
    };
    expect(withoutRefs(unproven.annotated)).toEqual(withoutRefs(authoritative.annotated));
    expect(withoutRefs(unproven.tree)).toEqual(withoutRefs(authoritative.tree));
    expect(unproven.campaigns[0].evidenceRows[0].contentHash).not.toBe(authoritative.campaigns[0].evidenceRows[0].contentHash);
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
    const query = Prisma.sql(...prisma.$queryRaw.mock.calls[0]);
    expect(query.values).toEqual(['ws', 'c1']);
    for (const predicate of ["o.entity_level='CAMPAIGN'", "o.source='META'", "o.measurement_window='CUMULATIVE_30D'", "w.outcome='COMMITTED'"])
      expect(query.sql).toContain(predicate);
    expect(query.sql).toContain('ORDER BY o.date');
  });
});

// Synthetic immutable capture results at the actual observation-query seam.
// These are unit fixtures, not authority for legacy database snapshots.
const captured = (rows, workspaceId = 'ws') => rows.map((row, index) => {
  const committedProjection = { formatVersion: 1,
    snapshot: JSON.parse(JSON.stringify({ ...row, workspaceId, entityLevel: 'CAMPAIGN' })),
    attributes: { objective: 'OUTCOME_SALES' } };
  const day = (v) => v == null ? null : new Date(v).toISOString().slice(0, 10);
  const sourceFacts = { binding: 'EXACT', providerAccountId: 'act_unit',
    rawDates: { start: { presence: row.windowStart ? 'VALID' : 'MISSING', value: day(row.windowStart) },
      stop: { presence: row.windowEnd ? 'VALID' : 'MISSING', value: day(row.windowEnd) } },
    metricFields: { spend: 'VALID', impressions: 'VALID', clicks: 'VALID', revenue: 'VALID', conversions: 'VALID', frequency: 'VALID' } };
  const id = (n) => '10000000-0000-4000-8000-' + String(index * 4 + n).padStart(12, '0');
  return { workspaceId, entityId: row.entityId, observationId: id(1), refreshId: id(2),
    sourceAttemptId: id(3), writeId: id(4), committedProjection, sourceFacts,
    contentHash: canonicalContentHash({ projection: committedProjection, facts: sourceFacts }).toString('hex'),
    sourceScope: { providerAccountId: 'act_unit' }, sourceReceipt: { outcome: 'EXHAUSTED' } };
});
