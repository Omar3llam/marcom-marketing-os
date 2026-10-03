import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

import { api } from '@/lib/api.js';
import { useInbox } from './useInbox.js';
import { READ } from '@/design-system/states/readStatus.js';

beforeEach(() => vi.resetAllMocks());

describe('useInbox reads the endpoint outcome', () => {
  it('keeps a successful empty response distinct from failure', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'ws1', role: 'BUYER', alerts: [], latestNarrative: null, pendingApprovals: [] } });
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ items: [], error: null, status: READ.NOTHING_FOUND, reason: null });
  });

  it('normalizes successful items', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'ws1', role: 'BUYER', alerts: [{ kind: 'RADAR', id: 'd1', headline: 'Inspect', verdict: 'KILL' }] } });
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe(READ.PRESENT);
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

  it.each([
    [409, 'RoleNotConfigured'],
    [503, 'RoleUnavailable'],
  ])('keeps unresolved-role HTTP %s as an error, never a caught-up Inbox', async (httpStatus, code) => {
    const failure = Object.assign(new Error(code), { httpStatus });
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
    expect(result.current.status).toBe(READ.NOT_REACHABLE);
  });

  it.each([
    [{ httpStatus: 409, code: 'NoWorkspace' }, READ.NOTHING_FOUND, 'NoWorkspace'],
    [{ httpStatus: 409, code: 'RoleNotConfigured', context: { roleReason: 'ROLE_UNSET' } }, READ.NOTHING_FOUND, 'ROLE_UNSET'],
    [{ response: { status: 409, data: { error: 'RoleNotConfigured', roleReason: 'ROLE_UNSET' } } }, READ.NOTHING_FOUND, 'ROLE_UNSET'],
    [{ httpStatus: 503, context: { roleReason: 'ROLE_LOOKUP_FAILED' } }, READ.NOT_REACHABLE, 'ROLE_LOOKUP_FAILED'],
    [{ response: { status: 503, data: { error: 'RoleUnavailable', roleReason: 'ROLE_LOOKUP_FAILED' } } }, READ.NOT_REACHABLE, 'ROLE_LOOKUP_FAILED'],
    [{ httpStatus: 503, context: { roleReason: 'ROLE_UNKNOWN' } }, READ.NOT_REACHABLE, 'ROLE_UNKNOWN'],
    [{ httpStatus: 503, context: { roleReason: 'ROLE_IDENTITY_MISSING' } }, READ.NOT_REACHABLE, 'ROLE_IDENTITY_MISSING'],
    [{ httpStatus: 403 }, READ.NOT_PERMITTED, null],
    [{ response: { status: 403 } }, READ.NOT_PERMITTED, null],
    [{ httpStatus: 500 }, READ.NOT_REACHABLE, null],
    [{ code: 'NETWORK_ERROR' }, READ.NOT_REACHABLE, null],
  ])('classifies structured error %j as %s / %s without treating it as empty success', async (details, status, reason) => {
    const failure = Object.assign(new Error('same opaque message'), details);
    api.get.mockRejectedValue(failure);
    const { result } = renderHook(useInbox);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ status, reason, error: failure, items: [] });
  });
});


describe('SC-06 useInbox recovery', () => {
  it('clears the old failure while retrying and accepts fresh success', async () => {
    const failure = Object.assign(new Error('temporary'), { httpStatus: 503 });
    let resolve;
    api.get.mockRejectedValueOnce(failure).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useInbox());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    act(() => { result.current.refetch(); });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => { resolve({ data: { workspaceId: 'ws', role: 'BUYER', alerts: [], latestNarrative: null, pendingApprovals: [] } }); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it('role lookup retry clears the old reason while loading and accepts fresh populated success', async () => {
    const failure = Object.assign(new Error('role lookup failed'), { httpStatus: 503, context: { roleReason: 'ROLE_LOOKUP_FAILED' } });
    let resolve;
    api.get.mockRejectedValueOnce(failure).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { result } = renderHook(useInbox);
    await waitFor(() => expect(result.current.reason).toBe('ROLE_LOOKUP_FAILED'));
    act(() => { result.current.refetch(); });
    expect(result.current).toMatchObject({ status: READ.LOADING, reason: null, error: null, items: [] });
    await act(async () => resolve({ data: { workspaceId: 'ws', role: 'BUYER', alerts: [{ kind: 'RADAR', id: 'd1', headline: 'Inspect', verdict: 'KILL' }] } }));
    expect(result.current).toMatchObject({ status: READ.PRESENT, reason: null, error: null });
    expect(result.current.items[0]).toMatchObject({ id: 'd1', type: 'radar' });
  });
});
