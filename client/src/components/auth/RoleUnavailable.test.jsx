// ============================================================
// RoleUnavailable — one state, one sentence (R-14, Phase 5.14)
// ------------------------------------------------------------
// Phase 5.13 recorded this component as NOT COVERED. Its copy was asserted in
// five places, every one of them through the regex /couldn't read this
// account/i — which ALSO matched PlanGate's EntitlementUnavailable. No test
// could tell the two apart, because no text could: both rendered byte-identical
// titles, and a role failure and a workspace failure were indistinguishable to
// the user (5.13, M-4).
//
// These cases pin the three things that were wrong:
//   1. each read state says something different from the others;
//   2. the ROLE axis is named, so it cannot be confused with the workspace one;
//   3. an unassigned seat is spoken as an ANSWER with a next step, not as an
//      outage — and an outage is not spoken as a refusal.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import RoleUnavailable, { ROLE_UNAVAILABLE_COPY } from './RoleUnavailable.jsx';
import { ROLE_READ } from '@/context/RoleContext.jsx';
import { ENTITLEMENT_COPY } from './PlanGate.jsx';

const at = (status) => render(<RoleUnavailable status={status} />);

// The three states this component is ever handed. LOADING never reaches it —
// every gate holds before rendering it — and PRESENT is not an absence.
const STATES = [ROLE_READ.NOTHING_FOUND, ROLE_READ.NOT_REACHABLE, ROLE_READ.NOT_PERMITTED];

describe('RoleUnavailable — the ROLE axis names itself', () => {
  it.each(STATES)('%s says ACCESS, never the bare "this account"', (status) => {
    at(status);
    // /access/i rather than /your access/i: NOTHING_FOUND reads "No access
    // LEVEL is set…". It still discriminates — no workspace-axis sentence
    // contains the word at all, which the cross-axis block below asserts.
    expect(screen.getAllByText(/access/i).length).toBeGreaterThan(0);
  });

  it.each(STATES)('%s never claims the user lacks a permission we did not read', (status) => {
    at(status);
    // "You don't have permission" is a claim about the CALLER. Two of these
    // three states know nothing about the caller at all.
    expect(screen.queryByText(/you (do not|don’t|don't) have/i)).not.toBeInTheDocument();
  });

  it.each(STATES)('%s never mentions a plan, a tier or money', (status) => {
    at(status);
    expect(screen.queryByText(/upgrade|plan|tier|billing/i)).not.toBeInTheDocument();
  });
});

describe('RoleUnavailable — each state says its own thing', () => {
  it('NOTHING_FOUND is an ANSWER with a next step, not a failure', () => {
    at(ROLE_READ.NOTHING_FOUND);
    expect(screen.getByText(/No access level is set for your account/i)).toBeInTheDocument();
    expect(screen.getByText(/Ask a Strategist/i)).toBeInTheDocument();
    // A retry changes nothing here, so nothing suggests one.
    expect(screen.queryByText(/problem on our side/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
  });

  it('NOT_REACHABLE states LUMI’s position, not a fact about the account', () => {
    at(ROLE_READ.NOT_REACHABLE);
    expect(screen.getByText(/Lumi couldn’t check your access just now/i)).toBeInTheDocument();
    expect(screen.getByText(/problem on our side/i)).toBeInTheDocument();
    expect(screen.queryByText(/No access level is set/i)).not.toBeInTheDocument();
  });

  it('NOT_PERMITTED is a refusal — and does not blame our side for it', () => {
    at(ROLE_READ.NOT_PERMITTED);
    expect(screen.getByText(/isn’t allowed to check your access/i)).toBeInTheDocument();
    expect(screen.queryByText(/problem on our side/i)).not.toBeInTheDocument();
  });

  it('no two states read alike', () => {
    const seen = new Set();
    for (const status of STATES) {
      const { container, unmount } = at(status);
      seen.add(container.textContent.trim());
      unmount();
    }
    expect(seen.size).toBe(STATES.length);
  });

  it('every state this component handles has a sentence — no silent gap', () => {
    for (const status of STATES) {
      expect(ROLE_UNAVAILABLE_COPY[status]).toBeDefined();
      expect(ROLE_UNAVAILABLE_COPY[status].title).toBeTruthy();
    }
  });

  it('an unrecognised status falls back to the least-claiming sentence', () => {
    at('SOMETHING_NEW');
    expect(screen.getByText(/Lumi couldn’t check your access just now/i)).toBeInTheDocument();
  });
});

describe('RoleUnavailable is DISTINGUISHABLE from EntitlementUnavailable', () => {
  // The whole point of 5.13's M-4. These are two different reads on two
  // different axes, and a support engineer looking at a screenshot must be able
  // to tell which one failed.
  it('shares no title with the workspace-axis copy', () => {
    const roleTitles = Object.values(ROLE_UNAVAILABLE_COPY).map((c) => c.title);
    const planTitles = Object.values(ENTITLEMENT_COPY).map((c) => c.title);
    for (const t of roleTitles) expect(planTitles).not.toContain(t);
  });

  it('every role title names access; every workspace title names the workspace', () => {
    for (const c of Object.values(ROLE_UNAVAILABLE_COPY)) {
      expect(c.title).toMatch(/access/i);
      expect(c.title).not.toMatch(/workspace/i);
    }
    for (const c of Object.values(ENTITLEMENT_COPY)) {
      expect(c.title).toMatch(/workspace/i);
      expect(c.title).not.toMatch(/access/i);
    }
  });

  it('REGRESSION: the old shared sentence is gone from both', () => {
    const all = [...Object.values(ROLE_UNAVAILABLE_COPY), ...Object.values(ENTITLEMENT_COPY)];
    for (const c of all) {
      expect(c.title).not.toMatch(/couldn’t read this account just now/i);
    }
  });
});

describe('RoleUnavailable promises no recovery it does not have', () => {
  // RoleContext fetches once with [] deps and exposes no refetch, so a reload
  // is the only recovery. A "Try again" control would be a lie.
  it.each(STATES)('%s renders no button', (status) => {
    at(status);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(STATES)('%s does not tell the user to retry', (status) => {
    at(status);
    expect(screen.queryByText(/try again|retry|refresh/i)).not.toBeInTheDocument();
  });
});
