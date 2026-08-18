// ============================================================
// Phase 4-B — Account Briefing: the memory moat, read honestly
// ------------------------------------------------------------
// Pure-component assertions (no network) on the "What Lumi knows about this
// account" surface: every field traces to a real AccountPattern row, accuracy
// is "right —" until outcomes are known (never a fabricated %), and the empty /
// loading / error states are honest. Plus the route gate intent (CLIENT can't
// reach the strategist war room) and the contract seam.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountBriefing } from '../AccountBriefing.jsx';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { BriefingSchema } from '@/contracts/schemas/briefing.schema';
import { NetworkResponseSchema } from '@/contracts/schemas/networkInsight.schema';

const pattern = (over = {}) => ({
  id: 'p1', kind: 'FATIGUE_CEILING',
  statement: 'Creative fatigues at ~3.2 frequency on cold audiences.',
  support: 12, effectiveSupport: 9.4, accuracy: null, confidence: 0.72,
  status: 'ESTABLISHED', ...over,
});

const BRIEFING = {
  workspaceId: 'ws-1', generatedAt: '2026-06-16T00:00:00Z',
  patterns: [
    pattern(),
    pattern({ id: 'p2', accuracy: 0.8, confidence: 0.9, status: 'EMERGING', statement: 'Offer-led hooks convert returning traffic.' }),
  ],
  promotableCount: 2, conflicts: [], network: { status: 'NOT_CONSENTED' },
};

describe('AccountBriefing — honest memory-moat readout', () => {
  it('renders each pattern from a real row: statement, status, accuracy, confidence', () => {
    render(<AccountBriefing briefing={BRIEFING} />);
    expect(screen.getByText(/Creative fatigues at ~3.2 frequency/)).toBeInTheDocument();
    expect(screen.getByText('ESTABLISHED')).toBeInTheDocument();
    expect(screen.getByText(/right 80%/)).toBeInTheDocument();      // p2 accuracy 0.8
    expect(screen.getByText(/confidence 72%/)).toBeInTheDocument(); // p1 confidence 0.72
  });
  it('shows "right —" (never a fabricated %) until outcomes are known', () => {
    render(<AccountBriefing briefing={{ patterns: [pattern({ accuracy: null })], promotableCount: 0, conflicts: [] }} />);
    expect(screen.getByText(/right —/)).toBeInTheDocument();
  });
  it('surfaces the promotable count badge', () => {
    render(<AccountBriefing briefing={BRIEFING} />);
    expect(screen.getByText(/2 promotable to a rule/)).toBeInTheDocument();
  });
  it('honest empty state when no patterns are established yet', () => {
    render(<AccountBriefing briefing={{ patterns: [], promotableCount: 0, conflicts: [] }} />);
    expect(screen.getByText(/No established patterns yet/i)).toBeInTheDocument();
  });
  it('honest loading and error states', () => {
    const { rerender } = render(<AccountBriefing loading />);
    expect(screen.getByText(/Loading learnings/i)).toBeInTheDocument();
    rerender(<AccountBriefing error={new Error('x')} />);
    expect(screen.getByText(/Couldn’t load account learnings/i)).toBeInTheDocument();
  });
});

describe('AccountBriefing — promote a pattern to a rule (STRATEGIST owner action)', () => {
  const PROMOTABLE = {
    workspaceId: 'ws-1',
    patterns: [pattern({ id: 'pp', promotable: true, statement: 'Kill cold ad sets past 3.2 frequency.' })],
    promotableCount: 1, conflicts: [], network: { status: 'NOT_CONSENTED' },
  };

  it('a strategist sees "Make it a rule" on a promotable pattern; clicking fires onPromote(id)', () => {
    const onPromote = vi.fn();
    render(<AccountBriefing briefing={PROMOTABLE} canPromote onPromote={onPromote} />);
    const btn = screen.getByRole('button', { name: /make it a rule/i });
    fireEvent.click(btn);
    expect(onPromote).toHaveBeenCalledWith('pp');
  });

  it('a non-strategist (canPromote=false) never sees the promote control', () => {
    render(<AccountBriefing briefing={PROMOTABLE} canPromote={false} onPromote={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /make it a rule/i })).not.toBeInTheDocument();
  });

  it('shows no promote control on a non-promotable pattern, even for a strategist', () => {
    const notPromotable = { ...PROMOTABLE, patterns: [pattern({ id: 'np', promotable: false })], promotableCount: 0 };
    render(<AccountBriefing briefing={notPromotable} canPromote onPromote={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /make it a rule/i })).not.toBeInTheDocument();
  });

  it('hides the control on an already-promoted pattern (promotedRuleId set)', () => {
    const already = { ...PROMOTABLE, patterns: [pattern({ id: 'ap', promotable: true, promotedRuleId: 'rule-1' })] };
    render(<AccountBriefing briefing={already} canPromote onPromote={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /make it a rule/i })).not.toBeInTheDocument();
  });

  it('reflects the in-flight promote (disabled + Promoting…)', () => {
    render(<AccountBriefing briefing={PROMOTABLE} canPromote onPromote={vi.fn()} promotingId="pp" />);
    const btn = screen.getByRole('button', { name: /promoting/i });
    expect(btn).toBeDisabled();
  });

  it('surfaces the real promote error (the backend governance message), not a generic one', () => {
    render(<AccountBriefing briefing={PROMOTABLE} canPromote onPromote={vi.fn()} promoteError={new Error('pattern is CONFLICTED — not promotable')} />);
    expect(screen.getByText(/CONFLICTED — not promotable/i)).toBeInTheDocument();
  });
});

describe('Account Briefing route gate (STRATEGIST/BUYER, CLIENT denied)', () => {
  it('the strategist war room is reachable by operators, not by a CLIENT', () => {
    const allow = ['STRATEGIST', 'BUYER'];
    expect(roleAllowed('STRATEGIST', allow)).toBe(true);
    expect(roleAllowed('BUYER', allow)).toBe(true);
    expect(roleAllowed('CLIENT', allow)).toBe(false);
  });
});

describe('contract seam — BriefingSchema safeParses the fixture', () => {
  it('validates a representative briefing', () => {
    expect(BriefingSchema.safeParse(BRIEFING).success).toBe(true);
  });
});

// ── Phase 4-F — the gated cross-account network layer ──────────────────────
const NETWORK_OK = {
  status: 'OK', cohortTag: 'EG-apparel',
  insights: [
    {
      status: 'OK', cohortTag: 'EG-apparel', kind: 'FATIGUE_CEILING', metric: 'frequency',
      contributingWorkspaces: 7, threshold: 3.2, holdRate: 0.82, accuracyBand: [0.71, 0.9],
      statement: 'Across 7 consenting EG-apparel accounts, this fatigue ceiling held in ~82% of cases (71–90%).',
    },
    {
      status: 'INSUFFICIENT_DATA', cohortTag: 'EG-apparel', kind: 'SCALING_WINDOW', metric: 'roas',
      contributingWorkspaces: 2, needed: 5,
    },
  ],
};

describe('AccountBriefing — gated network layer (consent is the cross-tenant boundary)', () => {
  const withNet = (network: unknown) => ({ patterns: [], promotableCount: 0, conflicts: [], network });

  // R11 (F12 · RU-5): the cohort is server-assigned. This test used to type a
  // cohort into a text box and assert it was passed along — the client half of
  // membership-by-claim. It now asserts the box is GONE: leaving it rendered
  // while the server refuses the field would offer a choice that no longer
  // exists and fail the opt-in with a 400 the user could not explain.
  it('NOT_CONSENTED: a STRATEGIST opts in with one click — no cohort to choose', () => {
    const onConsent = vi.fn();
    render(<AccountBriefing briefing={withNet({ status: 'NOT_CONSENTED' })} canManageConsent onConsent={onConsent} />);
    expect(screen.getByText(/isn’t contributing to the anonymized network/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/cohort tag/i)).not.toBeInTheDocument();
    expect(screen.getByText(/assigned automatically/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /join network/i }));
    expect(onConsent).toHaveBeenCalledWith(true);
  });

  it('NOT_CONSENTED: a non-strategist (cannot manage) gets NO opt-in control', () => {
    render(<AccountBriefing briefing={withNet({ status: 'NOT_CONSENTED' })} canManageConsent={false} onConsent={vi.fn()} />);
    expect(screen.getByText(/only a strategist can opt/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /join network/i })).not.toBeInTheDocument();
  });

  it('OK: renders the engine’s banded statement (never a fabricated point)', () => {
    render(<AccountBriefing briefing={withNet(NETWORK_OK)} />);
    expect(screen.getByText(/Across 7 consenting EG-apparel accounts/)).toBeInTheDocument();
    expect(screen.getByText(/held in ~82% of cases/)).toBeInTheDocument(); // banded sentence
    expect(screen.getByText(/Sharing as/)).toBeInTheDocument();
  });

  it('OK: below the k-anonymity gate it says so honestly (N of K), not a market claim', () => {
    render(<AccountBriefing briefing={withNet(NETWORK_OK)} />);
    expect(screen.getByText(/not enough of the network yet — 2 of 5 accounts/i)).toBeInTheDocument();
  });

  it('OK + STRATEGIST: can leave the network', () => {
    const onConsent = vi.fn();
    render(<AccountBriefing briefing={withNet(NETWORK_OK)} canManageConsent onConsent={onConsent} />);
    fireEvent.click(screen.getByRole('button', { name: /leave network/i }));
    expect(onConsent).toHaveBeenCalledWith(false);
  });

  it('no network field → the panel is absent (nothing fabricated)', () => {
    render(<AccountBriefing briefing={{ patterns: [], promotableCount: 0, conflicts: [] }} />);
    expect(screen.queryByText(/Network Intelligence/i)).not.toBeInTheDocument();
  });
});

describe('contract seam — NetworkResponseSchema safeParses the fixtures', () => {
  it('validates NOT_CONSENTED and OK (with banded + gated insights) shapes', () => {
    expect(NetworkResponseSchema.safeParse({ status: 'NOT_CONSENTED' }).success).toBe(true);
    expect(NetworkResponseSchema.safeParse(NETWORK_OK).success).toBe(true);
  });
});
