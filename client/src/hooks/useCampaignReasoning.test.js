// ============================================================
// useCampaignReasoning — read pre-generated reasoning + session cache
// ------------------------------------------------------------
// Asserts: load() GETs the pre-generated read and exposes text + stale; a SECOND
// load for the same campaign serves the module cache with NO new API call; a
// null row surfaces as reasoning:null (honest "not yet"); an API failure surfaces
// as error (never a fabricated reasoning).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCampaignReasoning } from './useCampaignReasoning.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { reasoning: 'Frequency is high — refresh the creative.', stale: false, generatedAt: '2026-07-09T00:00:00.000Z' } });
});

describe('useCampaignReasoning', () => {
  it('GETs the pre-generated read and exposes the text + freshness', async () => {
    const { result } = renderHook(() => useCampaignReasoning());
    await act(async () => { await result.current.load('read-a'); });

    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/read-a/reasoning');
    expect(result.current.reasoning).toMatch(/refresh the creative/i);
    expect(result.current.stale).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('serves a second load for the same campaign from cache — no new API call', async () => {
    const { result } = renderHook(() => useCampaignReasoning());
    await act(async () => { await result.current.load('read-b'); });
    expect(api.get).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.load('read-b'); });
    expect(api.get).toHaveBeenCalledTimes(1); // cached
    expect(result.current.reasoning).toMatch(/refresh the creative/i);
  });

  it('exposes reasoning:null when nothing is generated yet (honest, never fabricated)', async () => {
    api.get.mockResolvedValue({ data: { reasoning: null, stale: false, generatedAt: null } });
    const { result } = renderHook(() => useCampaignReasoning());
    await act(async () => { await result.current.load('read-c'); });
    expect(result.current.reasoning).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('surfaces an API failure as error, never a fabricated reasoning', async () => {
    api.get.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useCampaignReasoning());
    await act(async () => { await result.current.load('read-e'); });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.reasoning).toBeNull();
  });
});
