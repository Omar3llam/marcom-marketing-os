import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useHome } from './useHome.js';
import { api } from '@/lib/api.js';
import { READ } from '@/design-system/states/readStatus.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
const band = { title: 'Valid band', items: [], count: 0, empty: true };
const validHome = {
  role: 'STRATEGIST', summary: 'Valid agenda', buyerBand: band, strategistBand: band,
  loop: { stageStatus: [], closed: false, staleStages: [], loopHealth: 'HEALTHY',
    lastRunAt: null, nextRunAt: null, intervalMs: 900000 },
  aiInsight: null, aiInsightStatus: 'EMPTY',
};
beforeEach(() => vi.resetAllMocks());
describe('Home optional briefing read and recovery', () => {
  it.each(['PRESENT', 'EMPTY'])('briefing failure remains a valid Home and refetch recovers to %s', async (nextStatus) => {
    const recoveredInsight = nextStatus === 'PRESENT' ? 'Recovered briefing' : null;
    api.get.mockResolvedValueOnce({ data: { ...validHome, aiInsightStatus: 'UNAVAILABLE' } })
      .mockResolvedValueOnce({ data: { ...validHome, aiInsightStatus: nextStatus, aiInsight: recoveredInsight } });
    const { result } = renderHook(useHome);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ home: { aiInsightStatus: 'UNAVAILABLE', aiInsight: null },
      status: READ.PRESENT, error: null, reason: null });
    expect(result.current.home.buyerBand).toEqual(validHome.buyerBand);
    await act(async () => { await result.current.refetch(); });
    expect(result.current).toMatchObject({ home: { aiInsightStatus: nextStatus, aiInsight: recoveredInsight },
      status: READ.PRESENT, error: null });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('missing briefing status fails validation rather than manufacturing absence', async () => {
    const { aiInsightStatus: _status, ...oldHome } = validHome;
    api.get.mockResolvedValueOnce({ data: oldHome });
    const { result } = renderHook(useHome);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.home).toBeNull();
    expect(result.current.error.message).toMatch(/contract validation/i);
  });

});
