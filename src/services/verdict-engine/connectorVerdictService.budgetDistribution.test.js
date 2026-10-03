import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { findMany: vi.fn(async () => []) } } }));
vi.mock('../entity-graph/index.js', () => ({ getCanonicalVerdictCampaigns: vi.fn(async () => ({ campaigns: [], noCanonicalWindow: [] })) }));
vi.mock('../decision-memory/index.js', () => ({
  getDecisionHistory: vi.fn(async () => ({ byEntityId: new Map(), status: 'OK' })),
  HISTORY_KNOWLEDGE: { knowledgeOf: () => 'KNOWN' },
}));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { getConnectorVerdicts } from './connectorVerdictService.js';

const row = (entityId, over = {}) => ({ entityId, spendMinor: 100, currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED', source: 'META', ...over });
const node = (id, verdict = 'HOLD') => ({ id, verdict, verdictConfidence: 0.5, metrics: { spendMinor: 999999 }, signalInput: { roas: 2 }, currency: 'USD' });
const absent = (status, reason) => ({ status, reason, currency: null, totalSpendMinor: null,
  killSpendMinor: null, holdSpendMinor: null, scaleSpendMinor: null, killPct: null, holdPct: null, scalePct: null });
const publish = async (campaigns, children, extra = {}) => getConnectorVerdicts('ws', {
  evaluation: { workspaceId: 'ws', campaigns, annotated: { verdict: 'HOLD', children }, gatedOut: [], status: 'OK', ...extra },
  memory: { records: [], status: 'NO_VALIDATED_MEMORY' },
});
beforeEach(() => vi.clearAllMocks());

describe('SC-17A published budget distribution', () => {
  it('withholds mixed authoritative EGP KILL and USD SCALE despite numeric verdict spend', async () => {
    const result = await publish([row('a'), row('b', { currency: 'USD' })], [node('a', 'KILL'), node('b', 'SCALE')]);
    expect(result.verdicts).toHaveLength(2);
    expect(result.budgetDistribution).toEqual(absent('UNAVAILABLE', 'MIXED_CURRENCY'));
  });
  it.each(['EGP', 'USD'])('publishes homogeneous authoritative %s using canonical amounts, not engine amounts', async (currency) => {
    const result = await publish([row('a', { currency, spendMinor: 250 }), row('b', { currency, spendMinor: 750 })], [node('a', 'KILL'), node('b', 'SCALE')]);
    expect(result.budgetDistribution).toEqual({ status: 'AVAILABLE', reason: null, currency,
      totalSpendMinor: 1000, killSpendMinor: 250, holdSpendMinor: 0, scaleSpendMinor: 750,
      killPct: 25, holdPct: 0, scalePct: 75 });
  });
  it.each(['WORKSPACE_INFERRED', 'LEGACY_UNKNOWN', 'FALLBACK_DEFAULT', 'SNAPSHOT_INFERRED', 'USER_SUPPLIED', undefined])
  ('%s cannot gain authority from supported USD, META, workspace currency or engine fallback', async (currencyProvenance) => {
    const result = await publish([row('a', { currency: 'USD', currencyProvenance })], [node('a')], { currency: 'USD', workspace: { currency: 'USD' } });
    expect(result.budgetDistribution).toEqual(absent('UNAVAILABLE', 'UNKNOWN_CURRENCY'));
  });
  it.each([null, undefined, 'XXX'])('missing/unsupported currency %s cannot borrow engine USD or first-row EGP', async (currency) => {
    const result = await publish([row('a'), row('b', { currency })], [node('a'), node('b')]);
    expect(result.budgetDistribution).toEqual(absent('UNAVAILABLE', 'UNKNOWN_CURRENCY'));
  });
  it('one unproven contributor invalidates a proven population', async () => {
    const result = await publish([row('a'), row('b', { currencyProvenance: 'WORKSPACE_INFERRED' })], [node('a'), node('b')]);
    expect(result.budgetDistribution).toEqual(absent('UNAVAILABLE', 'UNKNOWN_CURRENCY'));
  });
  it('no positive finite scored spend publishes empty with null amounts and shares', async () => {
    const campaigns = [null, undefined, 0, -1, Infinity, NaN].map((spendMinor, i) => row(String(i), { spendMinor }));
    const result = await publish(campaigns, campaigns.map((c) => node(c.entityId)));
    expect(result.budgetDistribution).toEqual(absent('EMPTY', 'NO_SCORED_SPEND'));
  });
  it('gated-out and unverdicted positive spend cannot enter either denominator or denomination check', async () => {
    const result = await publish([row('a'), row('gated', { currency: 'USD', spendMinor: 900 })], [node('a', 'KILL')], { gatedOut: [{ id: 'gated', reason: 'NO_MEASURABLE_DELIVERY' }] });
    expect(result.budgetDistribution).toMatchObject({ status: 'AVAILABLE', currency: 'EGP', totalSpendMinor: 100, killPct: 100 });
  });
  it('all six verdicts retain lane mapping and the same contributor population', async () => {
    const verdicts = ['KILL', 'SCALE', 'HOLD', 'WATCH', 'REALLOCATE', 'REFRESH'];
    const result = await publish(verdicts.map((v) => row(v)), verdicts.map((v) => node(v, v)));
    const d = result.budgetDistribution;
    expect(d).toMatchObject({ totalSpendMinor: 600, killSpendMinor: 100, scaleSpendMinor: 100, holdSpendMinor: 400, killPct: 16.67, scalePct: 16.67, holdPct: 66.67 });
    expect(d.killSpendMinor + d.holdSpendMinor + d.scaleSpendMinor).toBe(d.totalSpendMinor);
  });
  it('pins percentage rounding to two decimal places on each published lane', async () => {
    const result = await publish([row('a'), row('b'), row('c')], [node('a', 'KILL'), node('b', 'HOLD'), node('c', 'SCALE')]);
    expect(result.budgetDistribution).toMatchObject({ killPct: 33.33, holdPct: 33.33, scalePct: 33.33 });
  });
  it.each(['NO_CAMPAIGNS', 'NO_ELIGIBLE_CAMPAIGNS'])('early %s response has an explicit empty projection', async (status) => {
    const result = await publish([], [], { annotated: null, status });
    expect(result.status).toBe(status);
    expect(result.budgetDistribution).toEqual(absent('EMPTY', 'NO_SCORED_SPEND'));
  });
  it('NO_WORKSPACE response has an explicit empty projection', async () => {
    const result = await getConnectorVerdicts(null);
    expect(result.status).toBe('NO_WORKSPACE');
    expect(result.budgetDistribution).toEqual(absent('EMPTY', 'NO_SCORED_SPEND'));
  });
});
