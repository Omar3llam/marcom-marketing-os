// ============================================================
// FE-02 — /app/memory, the ACROSS destination
// ------------------------------------------------------------
// B7 Ruling 2: "Memory is one surface, read two ways." Until now it was
// neither. The two readings lived on two different tabs of a third thing:
//
//   what Lumi learned      → a SECTION inside /app/intelligence/insights
//   whether it holds up    → a SIBLING TAB at /app/intelligence/proof
//
// so the object had no address, and the surface that did carry half of it
// simultaneously told the operator the memory layer was empty (see
// InsightsView.test.jsx — that claim came off a field S1-B deleted).
//
// These tests pin the RULING, not the copy:
//   1. one destination renders BOTH readings
//   2. the readings keep the entitlements they had BEFORE the move
//   3. a reading that could not be read says so, and never renders as "nothing
//      has been learned" — B8-02's law, applied to the axis that is all belief
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useAccountBriefing.js', () => ({ useAccountBriefing: vi.fn() }));
vi.mock('@/hooks/usePromotePattern.js', () => ({ usePromotePattern: vi.fn() }));
vi.mock('@/hooks/useAccuracy.js', () => ({ useAccuracy: vi.fn() }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: vi.fn(),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));

import MemoryView from './MemoryView.jsx';
import { useAccountBriefing } from '@/hooks/useAccountBriefing.js';
import { usePromotePattern } from '@/hooks/usePromotePattern.js';
import { useAccuracy } from '@/hooks/useAccuracy.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';

const briefing = (over = {}) => ({
  briefing: {
    patterns: [{
      id: 'p1',
      statement: 'Video creative fatigues after 9 days on this account',
      status: 'ESTABLISHED',
      accuracy: 0.8,
      confidence: 0.7,
      checks: { made: 5, held: 4, knowledge: 'KNOWN' },
      replacedBy: { value: null, knowledge: 'NOTHING_THERE' },
    }],
    conflicts: [],
    promotableCount: 0,
    network: null,
  },
  loading: false, error: null,
  refetch: vi.fn(), setConsent: vi.fn(), consentBusy: false,
  ...over,
});

const accuracy = (over = {}) => ({
  data: {
    calibration: { expectedCalibrationError: 0.08, brierScore: 0.1, direction: 'well-calibrated', accuracy: 0.72, bins: [] },
    velocity: null,
    coverage: { verdict: 'RELIABLE' },
  },
  surface: { gated: false, headline: 'Lumi is well-calibrated on this account.' },
  loading: false, error: null, refetch: vi.fn(),
  ...over,
});

const renderMemory = () => render(<MemoryRouter><MemoryView /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useAccountBriefing.mockReturnValue(briefing());
  useAccuracy.mockReturnValue(accuracy());
  usePromotePattern.mockReturnValue({
    requestPromotion: vi.fn(), grantPromotion: vi.fn(), revokePromotion: vi.fn(),
    busyId: null, error: null,
  });
  useCollabRole.mockReturnValue({ role: 'STRATEGIST', loading: false });
});

describe('FE-02 · one object, two readings, one destination', () => {
  it('renders WHAT LUMI LEARNED and WHETHER IT HOLDS UP on the same surface', () => {
    renderMemory();
    // reading 1 — the belief itself
    expect(screen.getByText(/Video creative fatigues after 9 days/)).toBeInTheDocument();
    // reading 2 — whether the belief has been any good
    expect(screen.getByText('Lumi is well-calibrated on this account.')).toBeInTheDocument();
  });

  it('is titled for the axis it serves, not for the tab it came from', () => {
    renderMemory();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Memory/);
  });
});

describe('FE-02 · the move changes the address, never an entitlement', () => {
  // BEFORE the move: /app/intelligence/proof carried NO RoleGate (a CLIENT may
  // read the narrative), while /app/intelligence/insights was STRATEGIST/BUYER.
  // Gating the whole destination would have silently deleted a CLIENT's access
  // to Proof of Learning — a regression dressed as consolidation.
  it('a CLIENT keeps the proof reading and still cannot read the briefing', () => {
    useCollabRole.mockReturnValue({ role: 'CLIENT', loading: false });
    renderMemory();
    expect(screen.getByText('Lumi is well-calibrated on this account.')).toBeInTheDocument();
    expect(screen.queryByText(/Video creative fatigues after 9 days/)).not.toBeInTheDocument();
    expect(screen.queryByText(/What Lumi Knows About This Account/i)).not.toBeInTheDocument();
  });

  it('a BUYER reads both, as they could across the two tabs before', () => {
    useCollabRole.mockReturnValue({ role: 'BUYER', loading: false });
    renderMemory();
    expect(screen.getByText(/Video creative fatigues after 9 days/)).toBeInTheDocument();
    expect(screen.getByText('Lumi is well-calibrated on this account.')).toBeInTheDocument();
  });

  it('renders neither reading while the role is still unknown', () => {
    // RoleGate's law: during the load window a denied fallback would bounce an
    // entitled operator. Nothing is asserted about them until the role resolves.
    useCollabRole.mockReturnValue({ role: null, loading: true });
    renderMemory();
    expect(screen.queryByText(/Video creative fatigues after 9 days/)).not.toBeInTheDocument();
  });
});

describe('FE-02 · a reading that failed says so, and claims nothing', () => {
  it('a failed briefing read is not rendered as "nothing has been learned"', () => {
    useAccountBriefing.mockReturnValue(briefing({ briefing: null, error: new Error('boom') }));
    const { container } = renderMemory();
    expect(container.textContent).toMatch(/couldn.t load account learnings/i);
    expect(container.textContent).not.toMatch(/No established patterns yet/i);
  });

  it('a failed accuracy read makes no calibration claim', () => {
    useAccuracy.mockReturnValue(accuracy({ data: null, surface: null, error: new Error('boom') }));
    const { container } = renderMemory();
    expect(container.textContent).not.toMatch(/well-calibrated/i);
    expect(container.textContent).toMatch(/Proof of Learning/i);
  });

  it('an empty briefing and an unreadable one do not spell the same', () => {
    useAccountBriefing.mockReturnValue(briefing({ briefing: { patterns: [], conflicts: [], promotableCount: 0, network: null } }));
    const empty = render(<MemoryRouter><MemoryView /></MemoryRouter>).container.textContent;
    expect(empty).toMatch(/No established patterns yet/i);
    expect(empty).not.toMatch(/couldn.t load account learnings/i);
  });
});
