// ============================================================
// The role boundary — gates and shell, on an UNRESOLVED seat (Phase 5.11)
// ------------------------------------------------------------
// The approved ruling: a role-read failure must fail closed, must never be
// represented as a confirmed role, and must not expose operator-level
// navigation or controls while resolution is pending.
//
// Three outcomes replace two, in the same shape PlanGate took in 5.9:
//   loading        → nothing
//   PRESENT + allowed / denied → children / fallback
//   anything else  → absence, which is NEITHER of those
//
// `fallback` matters because at route level it is a REDIRECT. Firing it on an
// unread seat routes the user on a guess and tells them they lack a permission
// nobody established.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useCollabRole.js', async (io) => ({ ...(await io()), useCollabRole: vi.fn() }));
vi.mock('@/hooks/useUserRole.js', async (io) => ({ ...(await io()), useUserRole: vi.fn() }));

import RoleGate, { roleAllowed } from './RoleGate.jsx';
import RequireUserRole from './RequireUserRole.jsx';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { useUserRole } from '@/hooks/useUserRole.js';
import { ROLE_READ } from '@/context/RoleContext.jsx';

const seat = (role, status = ROLE_READ.PRESENT, loading = false) =>
  useCollabRole.mockReturnValue({ role, loading, status });
const admin = (isAdmin, status = ROLE_READ.PRESENT, isLoading = false) =>
  useUserRole.mockReturnValue({ isAdmin, isLoading, status });

const renderRoleGate = () => render(
  <RoleGate role={['STRATEGIST', 'BUYER']} fallback={<span>denied-redirect</span>}>
    <span>operator content</span>
  </RoleGate>,
);
const renderAdminGate = () => render(
  <RequireUserRole role="ADMIN" fallback={<span>bounced</span>}><span>admin panel</span></RequireUserRole>,
);

const UNRESOLVED = [
  ['a failed read', ROLE_READ.NOT_REACHABLE],
  ['a refused read', ROLE_READ.NOT_PERMITTED],
];

beforeEach(() => vi.clearAllMocks());

describe('RoleGate — a seat that WAS read', () => {
  it('renders children for an allowed role', () => {
    seat('STRATEGIST');
    renderRoleGate();
    expect(screen.getByText('operator content')).toBeInTheDocument();
  });

  it('renders the fallback for a genuinely denied role', () => {
    seat('CLIENT');
    renderRoleGate();
    expect(screen.getByText('denied-redirect')).toBeInTheDocument();
    expect(screen.queryByText('operator content')).not.toBeInTheDocument();
  });

  it('renders NOTHING while the seat is loading', () => {
    seat(null, ROLE_READ.LOADING, true);
    const { container } = renderRoleGate();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('RoleGate — a seat that was NOT read', () => {
  it.each(UNRESOLVED)('%s renders neither the operator content nor the denial', (_l, status) => {
    seat(null, status);
    renderRoleGate();
    expect(screen.queryByText('operator content')).not.toBeInTheDocument();
    expect(screen.queryByText('denied-redirect')).not.toBeInTheDocument();
  });

  it.each(UNRESOLVED)('%s says the read failed instead', (_l, status) => {
    seat(null, status);
    renderRoleGate();
    expect(screen.getByText(/couldn’t read this account/i)).toBeInTheDocument();
  });

  it('a refusal does not claim the fault is on our side; an outage does', () => {
    seat(null, ROLE_READ.NOT_PERMITTED);
    const { unmount } = renderRoleGate();
    expect(screen.queryByText(/problem on our side/i)).not.toBeInTheDocument();
    unmount();
    seat(null, ROLE_READ.NOT_REACHABLE);
    renderRoleGate();
    expect(screen.getByText(/problem on our side/i)).toBeInTheDocument();
  });

  it('REGRESSION: a failed read does not become STRATEGIST', () => {
    seat(null, ROLE_READ.NOT_REACHABLE);
    renderRoleGate();
    expect(screen.queryByText('operator content')).not.toBeInTheDocument();
  });
});

describe('roleAllowed — the imperative form the nav filters with', () => {
  it('withholds a CONSTRAINED item when the seat is unknown', () => {
    expect(roleAllowed(null, ['STRATEGIST', 'BUYER'])).toBe(false);
  });

  it('still shows an UNCONSTRAINED item — withholding it would invent a restriction', () => {
    expect(roleAllowed(null, [])).toBe(true);
    expect(roleAllowed(null, undefined)).toBe(true);
  });

  it('is unchanged for a known seat', () => {
    expect(roleAllowed('BUYER', ['STRATEGIST', 'BUYER'])).toBe(true);
    expect(roleAllowed('CLIENT', ['STRATEGIST', 'BUYER'])).toBe(false);
  });
});

describe('RequireUserRole — still fails CLOSED, now legibly', () => {
  it('an ADMIN gets the panel', () => {
    admin(true);
    renderAdminGate();
    expect(screen.getByText('admin panel')).toBeInTheDocument();
  });

  it('a genuine non-admin is bounced', () => {
    admin(false);
    renderAdminGate();
    expect(screen.getByText('bounced')).toBeInTheDocument();
  });

  it.each(UNRESOLVED)('%s never grants the panel', (_l, status) => {
    admin(false, status);
    renderAdminGate();
    expect(screen.queryByText('admin panel')).not.toBeInTheDocument();
  });

  it.each(UNRESOLVED)('%s is distinguishable from a genuine non-admin', (_l, status) => {
    admin(false, status);
    renderAdminGate();
    // The bounce is a DENIAL. An unread seat has not been denied anything.
    expect(screen.queryByText('bounced')).not.toBeInTheDocument();
    expect(screen.getByText(/couldn’t read this account/i)).toBeInTheDocument();
  });

  it('REGRESSION: a failed admin read never renders the panel', () => {
    admin(true, ROLE_READ.NOT_REACHABLE); // even if isAdmin somehow says true
    renderAdminGate();
    expect(screen.queryByText('admin panel')).not.toBeInTheDocument();
  });
});
