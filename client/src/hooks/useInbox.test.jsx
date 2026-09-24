import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

import { api } from '@/lib/api.js';
import { useInbox } from './useInbox.js';

beforeEach(() => vi.resetAllMocks());

describe('useInbox reads the endpoint outcome', () => {
  it('keeps a successful empty response distinct from failure', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'ws1', role: 'BUYER', alerts: [], latestNarrative: null, pendingApprovals: [] } });
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ items: [], error: null });
  });

  it('normalizes successful items', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'ws1', role: 'BUYER', alerts: [{ kind: 'RADAR', id: 'd1', headline: 'Inspect', verdict: 'KILL' }] } });
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([expect.objectContaining({ type: 'radar', id: 'd1' })]);
  });

  it('keeps a 500 InboxUnavailable response as an error, not null-success', async () => {
    const failure = Object.assign(new Error('InboxUnavailable'), { httpStatus: 500 });
    api.get.mockRejectedValue(failure);
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(failure);
    expect(result.current.items).toEqual([]);
  });

  it('keeps a malformed 200 response as a contract error', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'ws1', role: null, alerts: [] } });
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error.message).toMatch(/contract validation/);
  });
});
