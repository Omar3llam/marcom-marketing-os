// ============================================================
// usePendingOutcomes Hook Tests
// ------------------------------------------------------------
// The manual-entry queue: EXECUTED decisions still missing an outcome + the
// workspace currency. Asserts: it GETs + contract-validates the list and exposes
// currency; a contract-invalid response errors honestly (no half-parsed rows
// leak through); and refetch re-requests.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePendingOutcomes } from './usePendingOutcomes.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

const RESP = {
  workspaceId: 'ws',
  decisions: [{
    id: 'd-1', verdict: 'KILL', confidence: 0.9, diagnosis: 'CPA breach',
    entityId: 'e-1', entityLevel: 'ADSET', createdAt: '2026-06-01T00:00:00.000Z',
  }],
  currency: 'EGP',
};

describe('usePendingOutcomes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads + validates the pending list and exposes the workspace currency', async () => {
    api.get.mockResolvedValue({ data: RESP });
    const { result } = renderHook(() => usePendingOutcomes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.get).toHaveBeenCalledWith('/api/lumi/decisions/pending-outcomes');
    expect(result.current.decisions).toHaveLength(1);
    expect(result.current.currency).toBe('EGP');
    expect(result.current.error).toBeNull();
  });

  it('errors honestly on a contract-invalid response (no half-parsed rows leak through)', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'ws', decisions: [{ id: 'd-1' }], currency: 'USD' } });
    const { result } = renderHook(() => usePendingOutcomes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.decisions).toHaveLength(0);
    expect(result.current.error).toBeTruthy();
  });

  it('refetch re-requests the list', async () => {
    api.get.mockResolvedValue({ data: RESP });
    const { result } = renderHook(() => usePendingOutcomes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { result.current.refetch(); });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
});
