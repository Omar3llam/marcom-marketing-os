// ============================================================
// useWorkspace — the workspace read and what it ESTABLISHED (Phase 5.9)
// ------------------------------------------------------------
// The hook has always reported `workspace: null` for every unhappy path —
// signed out, no workspace, 403, 500, dropped connection — so a consumer could
// not tell a refusal from an absence from an outage. `status` is the signal
// that separates them, and these tests pin each classification against a
// REALISTIC rejection: api.js rejects with a mapped domain error carrying
// `httpStatus`, not a raw axios error, so the 403 case is asserted in that
// shape (and in the raw shape too, since both reach this catch in practice).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mockAuth = { currentUser: { uid: 'u1' } };
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => mockAuth }));

import { useWorkspace, WORKSPACE_READ } from './useWorkspace.js';
import { api } from '@/lib/api.js';

const resolves = (data) => api.get.mockResolvedValue({ data });
const rejects = (err) => api.get.mockRejectedValue(err);

/** api.js's real rejection shape: a domain error, no `.response`. */
const domainError = (httpStatus) => Object.assign(new Error('mapped'), { httpStatus });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.currentUser = { uid: 'u1' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** Render and wait for the read to settle. */
async function settled() {
  const view = renderHook(() => useWorkspace());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe('useWorkspace — status classification', () => {
  it('starts in LOADING before the read resolves', () => {
    resolves({ hasWorkspace: true, workspace: { id: 'w1', plan: 'PRO' } });
    const { result } = renderHook(() => useWorkspace());
    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBe(WORKSPACE_READ.LOADING);
  });

  it.each(['FREE', 'GROWTH', 'PRO'])('a valid %s workspace is PRESENT', async (plan) => {
    resolves({ hasWorkspace: true, workspace: { id: 'w1', plan } });
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.PRESENT);
    expect(result.current.workspace.plan).toBe(plan);
    expect(result.current.hasWorkspace).toBe(true);
  });

  it('hasWorkspace:false is NOTHING_FOUND — a finding, not a failure', async () => {
    resolves({ hasWorkspace: false, workspace: null });
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOTHING_FOUND);
    expect(result.current.status).not.toBe(WORKSPACE_READ.PRESENT);
  });

  it('a 500 is NOT_REACHABLE', async () => {
    rejects(domainError(500));
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_REACHABLE);
  });

  it('a workspace lookup 503 is ERROR, not a setup absence finding', async () => {
    rejects(domainError(503));
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_REACHABLE);
    expect(result.current.status).not.toBe(WORKSPACE_READ.NOTHING_FOUND);
    expect(result.current.hasWorkspace).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('a transport error with no status at all is NOT_REACHABLE', async () => {
    rejects(new Error('Network Error'));
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_REACHABLE);
  });

  it('a 403 is NOT_PERMITTED, distinct from NOT_REACHABLE', async () => {
    rejects(domainError(403));
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_PERMITTED);
    expect(result.current.status).not.toBe(WORKSPACE_READ.NOT_REACHABLE);
  });

  it('classifies a RAW axios 403 the same way (response.status, no httpStatus)', async () => {
    rejects({ response: { status: 403, data: { error: 'Forbidden' } } });
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_PERMITTED);
  });

  it('keeps `error` available for consumers on a failed read', async () => {
    rejects(domainError(500));
    const { result } = await settled();
    expect(result.current.error).toBeTruthy();
  });
});

describe('useWorkspace — malformed responses never read as a plan', () => {
  it('a 200 with a workspace but NO plan field is NOT_REACHABLE', async () => {
    resolves({ hasWorkspace: true, workspace: { id: 'w1', name: 'Acme' } });
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_REACHABLE);
    // The RECORD is still usable — the Sidebar renders its name. Only the
    // entitlement is unknown, which is why these are two separate fields.
    expect(result.current.workspace).toEqual({ id: 'w1', name: 'Acme' });
    expect(result.current.hasWorkspace).toBe(true);
  });

  it('a plan value we do not recognise is NOT_REACHABLE, not a tier', async () => {
    resolves({ hasWorkspace: true, workspace: { id: 'w1', plan: 'LEGENDARY' } });
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_REACHABLE);
  });

  it('plan:null is NOT_REACHABLE', async () => {
    resolves({ hasWorkspace: true, workspace: { id: 'w1', plan: null } });
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_REACHABLE);
  });

  it('an empty 200 body is NOT_REACHABLE — a 200 that answers nothing', async () => {
    resolves({});
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_REACHABLE);
    expect(result.current.status).not.toBe(WORKSPACE_READ.NOTHING_FOUND);
  });

  it('hasWorkspace:true with no workspace object is NOT_REACHABLE', async () => {
    resolves({ hasWorkspace: true });
    const { result } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_REACHABLE);
    expect(result.current.hasWorkspace).toBe(false);
  });
});

describe('useWorkspace — session boundaries', () => {
  it('signed out: no read is made, and the status is not a finding about the workspace', async () => {
    mockAuth.currentUser = null;
    const { result } = await settled();
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.status).toBe(WORKSPACE_READ.NOT_REACHABLE);
    expect(result.current.workspace).toBeNull();
  });

  it('a user change drops the previous identity’s workspace and status immediately', async () => {
    resolves({ hasWorkspace: true, workspace: { id: 'w1', plan: 'PRO' } });
    const { result, rerender } = await settled();
    expect(result.current.status).toBe(WORKSPACE_READ.PRESENT);

    // Second identity: the read never resolves, so anything still PRESENT here
    // is the FIRST user's entitlement leaking into the second user's session.
    api.get.mockImplementation(() => new Promise(() => {}));
    mockAuth.currentUser = { uid: 'u2' };
    rerender();

    expect(result.current.status).toBe(WORKSPACE_READ.LOADING);
    expect(result.current.workspace).toBeNull();
    expect(result.current.hasWorkspace).toBe(false);
  });
});


describe('SC-06 useWorkspace recovery', () => {
  it('clears the old failure while retrying and accepts fresh success', async () => {
    const failure = Object.assign(new Error('temporary'), { httpStatus: 503 });
    let resolve;
    api.get.mockRejectedValueOnce(failure).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useWorkspace());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    act(() => { result.current.refetch(); });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => { resolve({ data: { hasWorkspace: true, workspace: { id: 'w1', plan: 'PRO' } } }); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.workspace).not.toBeNull();
  });
});
