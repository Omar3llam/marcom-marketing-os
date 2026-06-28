// ============================================================
// useUserRole — system-role (ADMIN|VIEWER) read-point
// ------------------------------------------------------------
// Reads userRole off GET /api/lumi/roles/me and errs CLOSED (a transient miss
// or no session NEVER grants admin). useAuth is mocked so we can drive the
// session presence; api is mocked to drive the response.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const authMock = vi.hoisted(() => ({ currentUser: { uid: 'u1' } }));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => authMock }));
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

import { api } from '@/lib/api.js';
import { useUserRole } from './useUserRole.js';

describe('useUserRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.currentUser = { uid: 'u1' };
  });

  it('isAdmin=true when /roles/me returns userRole ADMIN', async () => {
    api.get.mockResolvedValue({ data: { role: 'STRATEGIST', userRole: 'ADMIN' } });
    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.get).toHaveBeenCalledWith('/api/lumi/roles/me');
    expect(result.current.isAdmin).toBe(true);
  });

  it('isAdmin=false for a VIEWER', async () => {
    api.get.mockResolvedValue({ data: { role: 'STRATEGIST', userRole: 'VIEWER' } });
    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
  });

  it('errs CLOSED on a fetch failure (never grants admin)', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
  });

  it('no session → not admin, not loading, and no request fired', async () => {
    authMock.currentUser = null;
    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
  });
});
