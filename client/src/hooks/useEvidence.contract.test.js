import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api.js';
import { useEvidence } from './useEvidence.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
const ranking = {
  entity: { entityId: 'c1', ctr: 0.02 },
  evidence: { dimension: 'ADSET', metric: 'ctr',
    ranked: [{ entityId: 'as1', ctr: 0.01, _gap: -0.34 }, { entityId: 'as2', ctr: 0.02, _gap: 0 }],
    summary: { bottom: { entityId: 'as1', ctr: 0.01, _gap: -0.34 } } },
  insufficientData: false, reasonKey: null,
};
beforeEach(() => vi.clearAllMocks());

describe('P7-04B evidence response contract', () => {
  it.each([
    {}, { evidence: null }, { insufficientData: false, evidence: null },
    { ...ranking, insufficientData: undefined },
    { ...ranking, evidence: { metric: 'ctr' } },
    { ...ranking, evidence: { ...ranking.evidence, metric: 'roas' } },
    { ...ranking, evidence: { ...ranking.evidence, summary: null } },
    { ...ranking, evidence: { ...ranking.evidence, ranked: null } },
    { ...ranking, evidence: { ...ranking.evidence, summary: {} } },
    { ...ranking, entity: null },
    { ...ranking, reasonKey: 'NO_MEANINGFUL_GAP' },
    { ...ranking, insufficientData: true },
    { ...ranking, insufficientData: true, evidence: null },
    { insufficientData: true, evidence: null, reasonKey: null },
    { insufficientData: true, evidence: null, reasonKey: '' },
    { ...ranking, evidence: { ...ranking.evidence, summary: { bottom: { ctr: 0.01 } } } },
    { ...ranking, evidence: { ...ranking.evidence, summary: { bottom: { ctr: NaN, _gap: -0.34 } } } },
    { ...ranking, evidence: { ...ranking.evidence, summary: { bottom: { ctr: 0.01, _gap: Infinity } } } },
  ])('does not cache malformed %j as refusal', async (data) => {
    api.get.mockResolvedValue({ data });
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });
    expect(result.current.byId['c1:ctr']).toBeUndefined();
    expect(result.current.failures['c1:ctr']).toEqual({ kind: 'CONTRACT_INVALID', retryable: true });
    expect(result.current.errors['c1:ctr']).toBeTruthy();
    expect(result.current.loading['c1:ctr']).toBe(false);
  });
  it('retries a validation failure and preserves a contradictory published gap verbatim', async () => {
    api.get.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: ranking });
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });
    await act(async () => { await result.current.load('c1'); });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.byId['c1:ctr'].evidence.summary.bottom._gap).toBe(-0.34);
    expect(result.current.byId['c1:ctr'].entity.ctr).toBe(0.02);
    expect(result.current.errors['c1:ctr']).toBeNull();
    expect(result.current.failures['c1:ctr']).toBeNull();
  });
  it.each(['BASELINE_UNAVAILABLE', 'INSUFFICIENT_REPORTING_ADSETS', 'INSUFFICIENT_REPORTING_ADS', 'NO_MEANINGFUL_GAP'])(
    'preserves named refusal %s without retry', async (reasonKey) => {
      api.get.mockResolvedValue({ data: { entity: null, insufficientData: true, evidence: null, reasonKey } });
      const { result } = renderHook(() => useEvidence());
      await act(async () => { await result.current.load('c1'); });
      await act(async () => { await result.current.load('c1'); });
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(result.current.byId['c1:ctr'].reasonKey).toBe(reasonKey);
      expect(result.current.errors['c1:ctr']).toBeNull();
    });
  it('retains a non-retryable permission failure', async () => {
    api.get.mockRejectedValue({ httpStatus: 403, message: 'Forbidden' });
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });
    await act(async () => { await result.current.load('c1'); });
    expect(result.current.failures['c1:ctr']).toEqual({ kind: 'NOT_PERMITTED', retryable: false });
    expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('ad-level malformed data is a failure in its own cache', async () => {
    api.get.mockResolvedValue({ data: { insufficientData: false, evidence: null } });
    const { result } = renderHook(() => useEvidence({ dimension: 'ad' }));
    await act(async () => { await result.current.load('as1'); });
    expect(result.current.byId['as1:ctr']).toBeUndefined();
    expect(result.current.failures['as1:ctr'].kind).toBe('CONTRACT_INVALID');
  });
});
