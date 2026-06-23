// ============================================================
// Phase 8 — Narrative surface: reasoned report, not a dashboard
// ------------------------------------------------------------
// Pure-component + contract assertions (network mocked):
//   • NarrativeCard renders sections, evidence chips per figure, and demotes an
//     unproven claim. Report confidence shows its score+breakdown when defensible
//     and SUPPRESSES the number ("still building confidence") at the LOW band.
//   • GenerateNarrativeForm is HIDDEN for non-strategists (not a disabled tease)
//     and emits { period, audience } for the explicit submit + the shortcuts.
//   • LeadershipView scopes the list by role (CLIENT/LEADERSHIP only, BUYER drops
//     leadership-only reports) and shows a role-appropriate honest empty state.
//   • The contract seam safeParses a representative serialized narrative envelope.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  StakeholderNarrativeSchema,
  NarrativesListResponseSchema,
} from '@/contracts/schemas';

// ── Hook mocks (for LeadershipView) ─────────────────────────
vi.mock('@/hooks/useCollabRole.js', () => ({
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
  useCollabRole: vi.fn(),
}));
vi.mock('@/hooks/useNarratives.js', () => ({ useNarratives: vi.fn() }));

import { useCollabRole } from '@/hooks/useCollabRole.js';
import { useNarratives } from '@/hooks/useNarratives.js';
import { NarrativeCard } from '../NarrativeCard.jsx';
import { GenerateNarrativeForm } from '../GenerateNarrativeForm.jsx';
import { LeadershipView } from '../LeadershipView.jsx';

// ── Fixtures (the serialized contract shape) ────────────────
const narrativeHigh = {
  id: 'n1', period: 'WEEKLY', audience: 'LEADERSHIP',
  periodStart: '2026-06-16T00:00:00.000Z', periodEnd: '2026-06-23T00:00:00.000Z',
  headline: '3 actions this period, 1 causally proven.',
  reportConfidence: { score: 82, label: 'HIGH', components: [{ key: 'memoryCoverage', weight: 0.3, value: 1 }] },
  sections: [
    { key: 'DID', title: 'What we did', claims: [
      { text: 'We acted on 3 entities this period — killed 2, scaled 1.', figures: [{ value: -120000, unit: 'USD', evidenceRef: 'o1', kind: 'OUTCOME' }], tier: 'exec', proven: true },
    ] },
    { key: 'PROVED', title: 'What we proved', claims: [
      { text: 'A META holdout proved a +17.0% causal lift.', figures: [{ value: 17, unit: '%', evidenceRef: 't1', kind: 'INCREMENTALITY' }], tier: 'exec', proven: true },
    ] },
  ],
  evidenceRefs: ['o1', 't1'],
};
const narrativeLow = { ...narrativeHigh, id: 'n2', reportConfidence: { score: 22, label: 'LOW', components: [{ key: 'memoryCoverage', weight: 0.3, value: 0.2 }] } };
const narrativeUnproven = {
  ...narrativeHigh, id: 'n3', audience: 'STRATEGIST',
  sections: [{ key: 'PROVED', title: 'What we proved', claims: [
    { text: 'A GOOGLE holdout measured a +4.0% causal lift, CI crosses zero.', figures: [{ value: 4, unit: '%', evidenceRef: 't2', kind: 'INCREMENTALITY' }], tier: 'exec', proven: false },
  ] }],
};

// ── NarrativeCard ───────────────────────────────────────────
describe('NarrativeCard — evidence-bound prose, defensible confidence', () => {
  it('renders the sections, claim prose, and an evidence chip per figure', () => {
    const { container } = render(<NarrativeCard narrative={narrativeHigh} />);
    expect(screen.getByText('What we did')).toBeInTheDocument();
    expect(screen.getByText('What we proved')).toBeInTheDocument();
    expect(screen.getByText(/killed 2, scaled 1/)).toBeInTheDocument();
    // every figure surfaces its kind chip — provenance is visible, not implied
    expect(container.textContent).toMatch(/outcome/i);
    expect(container.textContent).toMatch(/holdout/i);
  });

  it('shows a defensible score (with breakdown on expand) when the band is not LOW', () => {
    render(<NarrativeCard narrative={narrativeHigh} />);
    const btn = screen.getByRole('button', { name: /Report confidence 82 · HIGH/i });
    expect(btn).toBeInTheDocument();
    expect(screen.queryByText('memoryCoverage')).not.toBeInTheDocument();
    fireEvent.click(btn); // breakdown is the "never a bare number" guarantee
    expect(screen.getByText('memoryCoverage')).toBeInTheDocument();
  });

  it('SUPPRESSES the number at the LOW band (no weak score paraded as authoritative)', () => {
    const { container } = render(<NarrativeCard narrative={narrativeLow} />);
    expect(screen.getByText(/Still building confidence on this account/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Report confidence 22/);
  });

  it('demotes an unproven claim rather than dressing it up as a result', () => {
    render(<NarrativeCard narrative={narrativeUnproven} />);
    expect(screen.getByText(/not yet conclusive/i)).toBeInTheDocument();
  });
});

// ── GenerateNarrativeForm ───────────────────────────────────
describe('GenerateNarrativeForm — strategist-only authoring', () => {
  it('renders NOTHING for a BUYER or CLIENT (hidden, not a disabled tease)', () => {
    const { container: buyer } = render(<GenerateNarrativeForm role="BUYER" onGenerate={vi.fn()} />);
    expect(buyer).toBeEmptyDOMElement();
    const { container: client } = render(<GenerateNarrativeForm role="CLIENT" onGenerate={vi.fn()} />);
    expect(client).toBeEmptyDOMElement();
  });

  it('lets a STRATEGIST author — submit + shortcuts emit { period, audience }', () => {
    const onGenerate = vi.fn();
    render(<GenerateNarrativeForm role="STRATEGIST" onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: /^Generate report$/i }));
    expect(onGenerate).toHaveBeenLastCalledWith({ period: 'WEEKLY', audience: 'LEADERSHIP' });
    fireEvent.click(screen.getByRole('button', { name: /Monthly leadership/i }));
    expect(onGenerate).toHaveBeenLastCalledWith({ period: 'MONTHLY', audience: 'LEADERSHIP' });
  });
});

// ── LeadershipView ──────────────────────────────────────────
const baseHook = { narratives: [], isLoading: false, error: null, isRestricted: false, generate: vi.fn(), isGenerating: false };

beforeEach(() => {
  vi.mocked(useNarratives).mockReturnValue({ ...baseHook });
});

describe('LeadershipView — role-scoped reports + honest empty states', () => {
  it('CLIENT sees the leadership-only empty copy and no authoring form', () => {
    vi.mocked(useCollabRole).mockReturnValue({ role: 'CLIENT' });
    render(<LeadershipView />);
    expect(screen.getByText(/No leadership reports available yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Generate report$/i })).not.toBeInTheDocument();
  });

  it('STRATEGIST sees the generate prompt and its first-report empty copy', () => {
    vi.mocked(useCollabRole).mockReturnValue({ role: 'STRATEGIST' });
    render(<LeadershipView />);
    expect(screen.getByText(/generate your first weekly narrative/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Generate report$/i })).toBeInTheDocument();
  });

  it('BUYER reads strategist+buyer reports but NOT a leadership-only one', () => {
    vi.mocked(useCollabRole).mockReturnValue({ role: 'BUYER' });
    vi.mocked(useNarratives).mockReturnValue({
      ...baseHook,
      narratives: [
        { ...narrativeHigh, id: 'lead', audience: 'LEADERSHIP', headline: 'Leadership-only report' },
        { ...narrativeHigh, id: 'buy', audience: 'BUYER', headline: 'Buyer-facing report' },
      ],
    });
    render(<LeadershipView />);
    expect(screen.getByText('Buyer-facing report')).toBeInTheDocument();
    expect(screen.queryByText('Leadership-only report')).not.toBeInTheDocument();
  });

  it('expands a row into the full narrative card', () => {
    vi.mocked(useCollabRole).mockReturnValue({ role: 'STRATEGIST' });
    vi.mocked(useNarratives).mockReturnValue({ ...baseHook, narratives: [narrativeHigh] });
    render(<LeadershipView />);
    // collapsed: the headline row is present, section titles are not
    expect(screen.queryByText('What we proved')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /3 actions this period/i }));
    expect(screen.getByText('What we proved')).toBeInTheDocument();
  });
});

// ── Contract seam ───────────────────────────────────────────
describe('contract seam — the serialized narrative envelope safeParses', () => {
  it('StakeholderNarrativeSchema validates a representative serialized narrative', () => {
    expect(StakeholderNarrativeSchema.safeParse(narrativeHigh).success).toBe(true);
  });
  it('NarrativesListResponseSchema validates the list envelope', () => {
    const parsed = NarrativesListResponseSchema.safeParse({ workspaceId: 'ws', narratives: [narrativeHigh, narrativeLow] });
    expect(parsed.success).toBe(true);
  });
  it('rejects a figure with no evidenceRef (a bare number is not a contract)', () => {
    const bad = { ...narrativeHigh, sections: [{ key: 'DID', title: 'x', claims: [{ text: 'y', figures: [{ value: 1, unit: '%', evidenceRef: '' }] }] }] };
    expect(StakeholderNarrativeSchema.safeParse(bad).success).toBe(false);
  });
});
