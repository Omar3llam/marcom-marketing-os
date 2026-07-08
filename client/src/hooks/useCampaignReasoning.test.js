// ============================================================
// useCampaignReasoning — on-demand generation + session cache
// ------------------------------------------------------------
// Asserts: getReasoning POSTs and exposes the text; a SECOND request for the same
// campaign returns from the module cache with NO new API call; regenerate bypasses
// the cache; an API failure surfaces as error (never a fabricated reasoning).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCampaignReasoning } from './useCampaignReasoning.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  api.post.mockResolvedValue({ data: { reasoning: 'Frequency is high — refresh the creative.' } });
});

describe('useCampaignReasoning', () => {
  it('POSTs to the reasoning endpoint and exposes the text', async () => {
    const { result } = renderHook(() => useCampaignReasoning());
    await act(async () => { await result.current.getReasoning('cache-a', { dialect: 'egy' }); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/entities/cache-a/reasoning', { dialect: 'egy' });
    expect(result.current.reasoning).toMatch(/refresh the creative/i);
    expect(result.current.error).toBeNull();
  });

  it('serves a second request for the same campaign from cache — no new API call', async () => {
    const { result } = renderHook(() => useCampaignReasoning());
    await act(async () => { await result.current.getReasoning('cache-b'); });
    expect(api.post).toHaveBeenCalledTimes(1);

    // Second call for the SAME entityId → cached, no additional POST.
    await act(async () => { await result.current.getReasoning('cache-b'); });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(result.current.reasoning).toMatch(/refresh the creative/i);
  });

  it('regenerate bypasses the cache and re-requests', async () => {
    const { result } = renderHook(() => useCampaignReasoning());
    await act(async () => { await result.current.getReasoning('cache-c'); });
    expect(api.post).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.regenerate('cache-c'); });
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('omits the body when no dialect is given', async () => {
    const { result } = renderHook(() => useCampaignReasoning());
    await act(async () => { await result.current.getReasoning('cache-d'); });
    expect(api.post).toHaveBeenCalledWith('/api/lumi/entities/cache-d/reasoning', {});
  });

  it('surfaces an API failure as error, never a fabricated reasoning', async () => {
    api.post.mockRejectedValue(new Error('502'));
    const { result } = renderHook(() => useCampaignReasoning());
    await act(async () => { await result.current.getReasoning('cache-e'); });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.reasoning).toBeNull();
  });
});
