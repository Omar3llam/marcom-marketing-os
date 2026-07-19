// ============================================================
// useNarratives Hook Tests — the author-gate seam (P1.4b)
// ------------------------------------------------------------
// POST /narratives/generate is STRATEGIST-only. A 403 is NOT an error — it's the
// honest "CLIENT/BUYER can't author" state (`isRestricted`). Detection is:
//   status = err?.httpStatus ?? err?.response?.status
// The live api client rejects with a mapped AppError (.httpStatus); the raw axios
// shape (.response.status) is the backward-compat fallback. Both must restrict.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useNarratives } from './useNarratives.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

// The list load runs on mount — resolve a schema-valid empty list so it never
// sets its own error (keeps the generate() assertions unambiguous).
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { workspaceId: null, narratives: [] } });
});

async function mountSettled() {
  const { result } = renderHook(() => useNarratives());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
}

describe('useNarratives — author gate', () => {
  it('treats an AppError httpStatus 403 on generate as isRestricted — not an error', async () => {
    const result = await mountSettled();
    api.post.mockRejectedValueOnce({ httpStatus: 403 });

    await act(async () => { await result.current.generate({ period: 'M', audience: 'BOARD' }); });

    expect(result.current.isRestricted).toBe(true);
    expect(result.current.error).toBeNull(); // isRestricted=true, error=null — never both
  });

  it('also restricts on a raw response.status 403 (backward-compat fallback path)', async () => {
    const result = await mountSettled();
    api.post.mockRejectedValueOnce({ response: { status: 403 } });

    await act(async () => { await result.current.generate({ period: 'M', audience: 'BOARD' }); });

    expect(result.current.isRestricted).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a non-403 generate error honestly (and stays unrestricted)', async () => {
    const result = await mountSettled();
    api.post.mockRejectedValueOnce({ httpStatus: 500 });

    await act(async () => { await result.current.generate({ period: 'M', audience: 'BOARD' }); });

    expect(result.current.isRestricted).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});
