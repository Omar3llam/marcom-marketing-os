// ============================================================
// useCampaignAnalysis — the "Sync Live Meta" trigger
// ------------------------------------------------------------
// Regression guard for the data-loss bug: the manual sync MUST request the
// 'maximum' window, never 'last_30d'. The old 30-day window returned no insights
// for accounts without recent delivery, and the roster merge then backfilled
// every campaign as a zero — overwriting real metrics. These pin the preset and
// that a successful sync refetches BOTH the connector campaigns and the verdicts.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCampaignAnalysis } from './useCampaignAnalysis.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const deps = () => ({
  refetch: vi.fn(),
  setCampaigns: vi.fn(),
  setUploadOpen: vi.fn(),
  refetchConnectors: vi.fn().mockResolvedValue(),
  refetchVerdicts: vi.fn().mockResolvedValue(),
});

describe('useCampaignAnalysis — handleMetaSync', () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs datePreset:'maximum' (never 'last_30d' — the overwrite bug)", async () => {
    api.post.mockResolvedValueOnce({ data: { synced: 1, failed: 0, results: [{ status: 'success', snapshots: 3 }] } });
    const d = deps();
    const { result } = renderHook(() => useCampaignAnalysis(d));

    await act(async () => { await result.current.handleMetaSync(); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/connections/sync', { datePreset: 'maximum' });
    const [, body] = api.post.mock.calls[0];
    expect(body.datePreset).not.toBe('last_30d');
  });

  it('refetches BOTH connector campaigns and verdicts after a sync that landed records', async () => {
    api.post.mockResolvedValueOnce({ data: { synced: 1, failed: 0, results: [{ status: 'success', snapshots: 5 }] } });
    const d = deps();
    const { result } = renderHook(() => useCampaignAnalysis(d));

    await act(async () => { await result.current.handleMetaSync(); });

    expect(d.refetchConnectors).toHaveBeenCalledTimes(1);
    expect(d.refetchVerdicts).toHaveBeenCalledTimes(1);
  });

  it('still refetches when nothing landed (entities may have changed) — never leaves a stale panel', async () => {
    api.post.mockResolvedValueOnce({ data: { synced: 1, failed: 0, results: [{ status: 'success', snapshots: 0 }] } });
    const d = deps();
    const { result } = renderHook(() => useCampaignAnalysis(d));

    await act(async () => { await result.current.handleMetaSync(); });

    expect(d.refetchConnectors).toHaveBeenCalledTimes(1);
    expect(d.refetchVerdicts).toHaveBeenCalledTimes(1);
  });
});
