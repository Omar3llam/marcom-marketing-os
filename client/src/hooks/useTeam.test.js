// ============================================================
// useTeam — roster read + STRATEGIST mutations
// ------------------------------------------------------------
// api + useAuth are mocked. We assert the load endpoint, that a mutation
// reloads the roster, and that a load failure surfaces the server message.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const authMock = vi.hoisted(() => ({ currentUser: { uid: 'u1' } }));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => authMock }));
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import { api } from '@/lib/api.js';
import { useTeam } from './useTeam.js';

describe('useTeam', () => {
  beforeEach(() => { vi.clearAllMocks(); authMock.currentUser = { uid: 'u1' }; });

  it('loads members + pending invitations from /api/team/members', async () => {
    api.get.mockResolvedValue({ data: { members: [{ id: 'm1', email: 'a@b.com', collabRole: 'STRATEGIST', isSelf: true }], pendingInvitations: [{ id: 'i1' }] } });
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.get).toHaveBeenCalledWith('/api/team/members');
    expect(result.current.members).toHaveLength(1);
    expect(result.current.pendingInvitations).toHaveLength(1);
  });

  it('invite() posts the body then reloads the roster', async () => {
    api.get.mockResolvedValue({ data: { members: [], pendingInvitations: [] } });
    api.post.mockResolvedValue({ data: { emailSent: true } });
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.invite('x@y.com', 'BUYER'); });
    expect(api.post).toHaveBeenCalledWith('/api/team/invite', { email: 'x@y.com', collabRole: 'BUYER' });
    expect(api.get).toHaveBeenCalledTimes(2); // initial load + post-invite reload
  });

  it('surfaces the server message on a load failure', async () => {
    api.get.mockRejectedValue({ response: { data: { message: 'nope' } } });
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('nope');
  });

  it('fires no request when there is no session', async () => {
    authMock.currentUser = null;
    const { result } = renderHook(() => useTeam());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.get).not.toHaveBeenCalled();
  });
});
