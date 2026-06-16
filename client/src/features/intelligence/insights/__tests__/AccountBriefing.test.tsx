// ============================================================
// Phase 4-B — Account Briefing: the memory moat, read honestly
// ------------------------------------------------------------
// Pure-component assertions (no network) on the "What Lumi knows about this
// account" surface: every field traces to a real AccountPattern row, accuracy
// is "right —" until outcomes are known (never a fabricated %), and the empty /
// loading / error states are honest. Plus the route gate intent (CLIENT can't
// reach the strategist war room) and the contract seam.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountBriefing } from '../AccountBriefing.jsx';
import { roleAllowed } from '@/components/auth/RoleGate.jsx';
import { BriefingSchema } from '@/contracts/schemas/briefing.schema';

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
