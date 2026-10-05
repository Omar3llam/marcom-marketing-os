import { describe, it, expect } from 'vitest';
import { OutcomeEvidenceResponseSchema } from './accuracy.schema';

const money = { spendMinor: 100, revenueMinor: 200, roas: 2, currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED' };
const noMoney = { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null };
const window = (over = {}) => ({ ...money, days: ['2026-08-03'], coverage: { required: 7, observed: 7, missing: [], complete: true }, refs: [], ...over });
const payload = (over = {}) => ({ workspaceId: 'ws', decisionId: 'd', entityId: 'e', entityLevel: 'CAMPAIGN', verdict: 'KILL',
  interventionAt: '2026-08-10T09:30:00.000Z', interventionDay: '2026-08-10', source: 'META', status: 'MEASURABLE', reason: null,
  policy: { comparisonWindowDays: 7, baselineWindow: { start: '2026-08-03', end: '2026-08-09' },
    observationWindow: { start: '2026-08-11', end: '2026-08-17' }, interventionDayExcluded: true },
  baseline: window(), observation: window(), delta: { ...money, spendMinor: 0, revenueMinor: 0, roas: 0 }, ...over });

describe('P7-07C published outcome monetary contract', () => {
  it('retains authoritative denomination and provenance at all three levels', () => {
    const admitted = OutcomeEvidenceResponseSchema.parse(payload());
    for (const side of [admitted.baseline, admitted.observation, admitted.delta]) expect(side).toMatchObject({ currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED' });
  });
  it.each(['baseline', 'observation', 'delta'] as const)('rejects numeric %s without its own authority', side => {
    for (const over of [{ currency: null }, { currency: '' }, { currency: 'ZZZ' }, { currencyProvenance: null }, { currencyProvenance: 'LEGACY_UNKNOWN' }]) {
      expect(OutcomeEvidenceResponseSchema.safeParse(payload({ [side]: side === 'delta' ? { ...money, ...over } : window(over) })).success).toBe(false);
    }
  });
  it('rejects a supposedly measurable cross-currency comparison', () => {
    expect(OutcomeEvidenceResponseSchema.safeParse(payload({ observation: window({ currency: 'USD' }) })).success).toBe(false);
  });
  it('rejects denomination borrowed for a delta from another side', () => {
    expect(OutcomeEvidenceResponseSchema.safeParse(payload({ delta: { ...money, currency: 'USD' } })).success).toBe(false);
  });
  it('allows partial authoritative windows with different currencies and no comparison', () => {
    expect(OutcomeEvidenceResponseSchema.safeParse(payload({ status: 'INSUFFICIENT_COVERAGE',
      observation: window({ currency: 'USD' }), delta: noMoney })).success).toBe(true);
  });
  it.each(['NOT_OBSERVED', 'AMBIGUOUS', 'NOT_MEASURABLE', 'INSUFFICIENT_COVERAGE', 'UNSUPPORTED', 'UNAVAILABLE'])(
    'preserves %s with a uniform null delta', status => {
      expect(OutcomeEvidenceResponseSchema.safeParse(payload({ status, baseline: null, observation: null, delta: noMoney })).success).toBe(true);
      expect(OutcomeEvidenceResponseSchema.safeParse(payload({ status, delta: money })).success).toBe(false);
    });
  it('rejects numeric ROAS lacking authoritative money', () => {
    expect(OutcomeEvidenceResponseSchema.safeParse(payload({ baseline: window({ ...noMoney, roas: 2 }) })).success).toBe(false);
  });
  it('rejects unknown statuses', () => { expect(OutcomeEvidenceResponseSchema.safeParse(payload({ status: 'UNKNOWN' })).success).toBe(false); });
});
