// ============================================================
// useProjectId — recoverable when the project lookup fails
// ------------------------------------------------------------
// Without refetch(), a failed /api/projects/mine left every caller (notably
// the onboarding Connect step) permanently unable to build a connect URL,
// with a full page reload as the only escape.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { get, AUTH } = vi.hoisted(() => ({
  get: vi.fn(),
  // Must be a STABLE reference: the fetch effect keys off currentUser, so a
  // fresh object per render would re-run it forever (the real AuthContext
  // provides one stable value per session).
  AUTH: { currentUser: { uid: 'u1' } },
}));
vi.mock('@/lib/api.js', () => ({ api: { get } }));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => AUTH }));

import { useProjectId } from './useProjectId.js';

beforeEach(() => vi.clearAllMocks());

describe('useProjectId', () => {
  it('resolves the active projectId', async () => {
    get.mockResolvedValue({ data: { projectId: 'proj_1' } });
    const { result } = renderHook(() => useProjectId());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projectId).toBe('proj_1');
  });

  it('a failed lookup leaves projectId null with an error, never a throw', async () => {
    get.mockRejectedValue({ response: { data: { error: 'nope' } } });
    const { result } = renderHook(() => useProjectId());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projectId).toBeNull();
    expect(result.current.error).toBe('nope');
  });

  it('refetch() retries and can recover — no page reload needed', async () => {
    get.mockRejectedValueOnce({ response: { data: { error: 'nope' } } });
    const { result } = renderHook(() => useProjectId());
    await waitFor(() => expect(result.current.projectId).toBeNull());

    get.mockResolvedValue({ data: { projectId: 'proj_2' } });
    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.projectId).toBe('proj_2'));
    expect(result.current.error).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
