// ============================================================
// RoleContext — the seat, and the read that produced it (Phase 5.11)
// ------------------------------------------------------------
// This provider used to answer STRATEGIST on any error or miss. Measured in
// Phase 5.10: a 500, a 403, a dropped connection and a 200 with no role all
// rendered the full operator navigation, indistinguishable from a genuine
// STRATEGIST — while a MALFORMED role fell the other way, to the narrowest
// seat. These cases pin both halves: no failure yields a role, and no failure
// yields the opposite role either.
//
// api.js rejects with a mapped domain error carrying `httpStatus`, so the 403
// case is asserted in that shape AND in the raw axios shape, since both reach
// this catch in practice.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

import { RoleProvider, useRoleContext, ROLE_READ, WORKSPACE_ROLE } from '@/context/RoleContext.jsx';
import { api } from '@/lib/api.js';

const wrapper = ({ children }) => <RoleProvider>{children}</RoleProvider>;
const domainError = (httpStatus) => Object.assign(new Error('mapped'), { httpStatus });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function settled() {
  const view = renderHook(() => useRoleContext(), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe('RoleContext — a seat that WAS read', () => {
  it('starts in LOADING, claiming no role', () => {
    api.get.mockResolvedValue({ data: { role: 'STRATEGIST' } });
    const { result } = renderHook(() => useRoleContext(), { wrapper });
    expect(result.current.status).toBe(ROLE_READ.LOADING);
    expect(result.current.role).toBeNull();
  });

  it.each(Object.values(WORKSPACE_ROLE))('a valid %s is PRESENT and carries the role', async (role) => {
    api.get.mockResolvedValue({ data: { role, visibleStates: null } });
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.PRESENT);
    expect(result.current.role).toBe(role);
  });

  it('carries visibleStates through untouched on a valid read', async () => {
    api.get.mockResolvedValue({ data: { role: 'BUYER', visibleStates: ['KILL'] } });
    const { result } = await settled();
    expect(result.current.visibleStates).toEqual(['KILL']);
  });
});

describe('RoleContext — a seat that was NOT read', () => {
  const NOT_A_ROLE = (result) => {
    expect(result.current.role).toBeNull();
    expect(result.current.role).not.toBe(WORKSPACE_ROLE.STRATEGIST);
    expect(result.current.role).not.toBe(WORKSPACE_ROLE.CLIENT);
    expect(result.current.status).not.toBe(ROLE_READ.PRESENT);
  };

  // ── Phase 5.14 — the server now states the outcome ────────────────────
  it('REGRESSION: roleStatus UNRESOLVED is refused even when a role STRING came with it', async () => {
    // The exact defect: the endpoint published { role: "STRATEGIST" } from
    // DEFAULT_ROLE. If a server ever does that again while also saying
    // UNRESOLVED, the stated fact wins over the recognisable string.
    api.get.mockResolvedValue({
      data: { role: 'STRATEGIST', roleStatus: 'UNRESOLVED', roleReason: 'ROLE_LOOKUP_FAILED' },
    });
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOT_REACHABLE);
    expect(result.current.role).toBeNull();
  });

  it('ROLE_UNSET is NOTHING_FOUND — an answer, not a failure', async () => {
    api.get.mockResolvedValue({ data: { role: null, roleStatus: 'UNRESOLVED', roleReason: 'ROLE_UNSET' } });
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOTHING_FOUND);
    expect(result.current.role).toBeNull();
  });

  it('ROLE_LOOKUP_FAILED is NOT_REACHABLE — a retry would be honest', async () => {
    api.get.mockResolvedValue({ data: { role: null, roleStatus: 'UNRESOLVED', roleReason: 'ROLE_LOOKUP_FAILED' } });
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOT_REACHABLE);
  });

  it.each(['ROLE_UNKNOWN', 'ROLE_IDENTITY_MISSING'])('%s is an error with no strategist UI authority', async (roleReason) => {
    api.get.mockResolvedValue({ data: { role: null, roleStatus: 'UNRESOLVED', roleReason } });
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOT_REACHABLE);
    expect(result.current.role).toBeNull();
    expect(result.current.visibleStates).toBeNull();
  });

  it('the two unresolved reasons do NOT collapse to one state', async () => {
    api.get.mockResolvedValue({ data: { role: null, roleStatus: 'UNRESOLVED', roleReason: 'ROLE_UNSET' } });
    const unset = (await settled()).result.current.status;
    api.get.mockResolvedValue({ data: { role: null, roleStatus: 'UNRESOLVED', roleReason: 'ROLE_LOOKUP_FAILED' } });
    const failed = (await settled()).result.current.status;
    expect(unset).not.toBe(failed);
  });

  it('roleStatus RESOLVED with a valid role is PRESENT, and carries visibleStates', async () => {
    api.get.mockResolvedValue({
      data: { role: 'BUYER', roleStatus: 'RESOLVED', roleReason: null, visibleStates: ['REPORT'] },
    });
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.PRESENT);
    expect(result.current.role).toBe('BUYER');
    expect(result.current.visibleStates).toEqual(['REPORT']);
  });

  it('an UNRESOLVED body never carries visibleStates through', async () => {
    api.get.mockResolvedValue({
      data: { role: null, roleStatus: 'UNRESOLVED', roleReason: 'ROLE_UNSET', visibleStates: ['PORTFOLIO'] },
    });
    const { result } = await settled();
    expect(result.current.visibleStates).toBeNull();
  });

  it('degrades safely against a server that sends no roleStatus at all', async () => {
    // A deploy where the client lands first. A valid role still resolves, and
    // an absent one still refuses — the KNOWN_ROLES belt, unchanged.
    api.get.mockResolvedValue({ data: { role: 'CLIENT' } });
    expect((await settled()).result.current.status).toBe(ROLE_READ.PRESENT);
    api.get.mockResolvedValue({ data: {} });
    expect((await settled()).result.current.status).toBe(ROLE_READ.NOT_REACHABLE);
  });

  it('a 500 is NOT_REACHABLE, and is not a role', async () => {
    api.get.mockRejectedValue(domainError(500));
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOT_REACHABLE);
    NOT_A_ROLE(result);
  });

  it('a transport failure with no status is NOT_REACHABLE', async () => {
    api.get.mockRejectedValue(new Error('Network Error'));
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOT_REACHABLE);
    NOT_A_ROLE(result);
  });

  it('a 403 is NOT_PERMITTED — a refusal we can name, still not a role', async () => {
    api.get.mockRejectedValue(domainError(403));
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOT_PERMITTED);
    expect(result.current.status).not.toBe(ROLE_READ.NOT_REACHABLE);
    NOT_A_ROLE(result);
  });

  it('classifies a RAW axios 403 identically', async () => {
    api.get.mockRejectedValue({ response: { status: 403 } });
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOT_PERMITTED);
  });

  it('a 200 with NO role is NOT_REACHABLE — never the narrowest seat by accident', async () => {
    api.get.mockResolvedValue({ data: { visibleStates: null } });
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOT_REACHABLE);
    NOT_A_ROLE(result);
  });

  it('a MALFORMED role is NOT_REACHABLE, not CLIENT and not STRATEGIST', async () => {
    api.get.mockResolvedValue({ data: { role: 'SUPERUSER' } });
    const { result } = await settled();
    expect(result.current.status).toBe(ROLE_READ.NOT_REACHABLE);
    NOT_A_ROLE(result);
  });

  it('REGRESSION: the two failure directions now agree — a failed read and a malformed one land in the SAME state', async () => {
    api.get.mockRejectedValue(domainError(500));
    const failed = (await settled()).result.current.status;
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { role: 'SUPERUSER' } });
    const malformed = (await settled()).result.current.status;
    expect(failed).toBe(malformed);
    expect(failed).toBe(ROLE_READ.NOT_REACHABLE);
  });

  it('keeps the error for diagnostics without turning it into a seat', async () => {
    api.get.mockRejectedValue(domainError(500));
    const { result } = await settled();
    expect(result.current.error).toBeTruthy();
    expect(result.current.role).toBeNull();
  });
});
