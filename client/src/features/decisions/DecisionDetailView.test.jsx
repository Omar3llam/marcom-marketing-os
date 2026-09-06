// ============================================================
// B8-04 — the Decision detail is REACHED
// ------------------------------------------------------------
// This slice renders three things that had landed and never reached a person:
//
//   C-11  hypotheses / counterfactuals   published, rendered by nothing
//   C-11  explainedAt                    published, rendered by nothing
//   C-16  memoryProvenance / baseConfidence  published by B8-01, read by nothing
//
// Each assertion below is the fourth step of the close-out gate for one of
// them. Without this file the slice would have repeated the defect the B7
// consumer sweep exists to catch.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useDecisionDetail = vi.fn();
vi.mock('@/hooks/useDecisionDetail.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useDecisionDetail: () => useDecisionDetail() };
});
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useParams: () => ({ id: 'd1' }) };
});

const DecisionDetailView = (await import('./DecisionDetailView.jsx')).default;
const { DETAIL_REFUSAL } = await import('@/hooks/useDecisionDetail.js');

const committed = (over = {}) => ({
  ctrAtDecision:     { value: 0.012, knowledge: 'KNOWN' },
  roasAtDecision:    { value: 0.4, knowledge: 'KNOWN' },
  objective:         { value: 'CONVERSIONS', knowledge: 'KNOWN' },
  channel:           { value: 'META', knowledge: 'KNOWN' },
  hypotheses:        { value: [{ statement: 'Creative is fatiguing' }], knowledge: 'KNOWN' },
  counterfactuals:   { value: [{ statement: 'Raise the budget', preferredBecause: 'ROAS was already below floor' }], knowledge: 'KNOWN' },
  evidenceReference: { value: null, knowledge: 'COULD_NOT_LOOK' },
  ...over,
});

const signal = {
  id: 'd1', decisionClass: 'SIGNAL', entityId: 'c1', entityLevel: 'CAMPAIGN',
  decidedAt: new Date('2026-09-01T10:00:00Z'),
  verdict: 'KILL', confidence: 0.71, diagnosis: 'ROAS below floor for 14 days',
  rootCause: null, status: 'SUPERSEDED',
  explainedAt: new Date('2026-09-02T09:00:00Z'), intentAt: null,
  humanExecutedAt: null, platformExecutedAt: null, dismissedAt: null,
  resolvedAt: null, resolution: null, confidenceDelta: null, closureReason: null,
  humanResponse: null, humanReasonCode: null, humanReasonNote: null, humanRespondedAt: null,
  guardrailRuleId: null, openHitKey: null,
  memoryProvenance: {
    factor: 0.89, applied: true,
    patterns: [{ patternId: 'p1', statement: 'KILL calls on this account hold up', accuracy: 0.8, effectiveSupport: 12 }],
  },
  baseConfidence: 0.8, memoryStatus: 'OK',
  committed: committed(),
};

const state = (over = {}) => ({ decision: null, refusal: null, isLoading: false, refetch: vi.fn(), ...over });
const renderView = () => render(<MemoryRouter><DecisionDetailView /></MemoryRouter>);

beforeEach(() => { useDecisionDetail.mockReset(); });

describe('B8-04 · the committed reasoning finally reaches a person (C-11)', () => {
  it('renders what Lumi considered', () => {
    useDecisionDetail.mockReturnValue(state({ decision: signal }));
    renderView();
    expect(screen.getByText(/Creative is fatiguing/)).toBeInTheDocument();
  });

  it('renders what it SET ASIDE, and why the call beat it', () => {
    // "How strong the thing set aside was is the whole question" — the only
    // place the product shows Lumi CONSIDERED rather than computed.
    useDecisionDetail.mockReturnValue(state({ decision: signal }));
    renderView();
    expect(screen.getByText(/Raise the budget/)).toBeInTheDocument();
    expect(screen.getByText(/ROAS was already below floor/)).toBeInTheDocument();
  });

  it('renders whether a human looked, and when (explainedAt)', () => {
    useDecisionDetail.mockReturnValue(state({ decision: signal }));
    renderView();
    expect(screen.getByText(/Reviewed/)).toBeInTheDocument();
  });

  it('says plainly when nobody has looked', () => {
    useDecisionDetail.mockReturnValue(state({ decision: { ...signal, explainedAt: null, intentAt: null } }));
    renderView();
    expect(screen.getByText(/Nobody has opened this decision yet/i)).toBeInTheDocument();
  });
});

describe('B8-04 · the memory measured at commitment reaches a person (C-16)', () => {
  it('states the shift memory made, from the engine\'s number to the published one', () => {
    useDecisionDetail.mockReturnValue(state({ decision: signal }));
    renderView();
    expect(screen.getByText(/from 80%.*to 71% confidence/s)).toBeInTheDocument();
  });

  it('names the pattern BY VALUE, with its own track record', () => {
    useDecisionDetail.mockReturnValue(state({ decision: signal }));
    renderView();
    expect(screen.getByText(/KILL calls on this account hold up/)).toBeInTheDocument();
    expect(screen.getByText(/right 80% of the time across 12 cases/)).toBeInTheDocument();
  });

  it('marks it as what memory said THEN — R-5, never reconciled with now', () => {
    useDecisionDetail.mockReturnValue(state({ decision: signal }));
    renderView();
    expect(screen.getByText(/Memory may say something different today/i)).toBeInTheDocument();
  });

  it('says memory was not consulted rather than showing nothing', () => {
    useDecisionDetail.mockReturnValue(state({
      decision: { ...signal, memoryStatus: 'NOT_CONSULTED', memoryProvenance: null, baseConfidence: null },
    }));
    renderView();
    expect(screen.getByText(/wasn’t consulted/i)).toBeInTheDocument();
  });
});

describe('B8-04 · the class layer, and L-4', () => {
  const guardrail = {
    ...signal, decisionClass: 'GUARDRAIL', confidence: 0.9,
    guardrailRuleId: 'r1', memoryProvenance: null, baseConfidence: null, memoryStatus: 'NOT_CONSULTED',
    committed: committed({
      hypotheses:      { value: null, knowledge: 'CANNOT_ASK' },
      counterfactuals: { value: null, knowledge: 'CANNOT_ASK' },
    }),
  };

  it('shows NO confidence percentage on a GUARDRAIL — a constant is not a measurement', () => {
    useDecisionDetail.mockReturnValue(state({ decision: guardrail }));
    renderView();
    expect(screen.queryByText(/90%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it('names the rule instead of inventing reasoning it never had', () => {
    useDecisionDetail.mockReturnValue(state({ decision: guardrail }));
    renderView();
    expect(screen.getByText(/rule was breached/i)).toBeInTheDocument();
    expect(screen.queryByText(/What it considered/i)).not.toBeInTheDocument();
  });

  it('DOES show the confidence on a SIGNAL, where it is a measurement', () => {
    useDecisionDetail.mockReturnValue(state({ decision: signal }));
    renderView();
    // It appears twice by design, and the two are different statements: the
    // header states the call's confidence, the memory section states the SHIFT
    // that produced it. That is provenance, not doubt counted twice (L-3).
    expect(screen.getAllByText(/71% confidence/).length).toBeGreaterThan(0);
  });
});

describe('B8-04 · the three refusals stay three different answers', () => {
  it('a 409 says the row is not a destination — never "not found"', () => {
    useDecisionDetail.mockReturnValue(state({ refusal: DETAIL_REFUSAL.NOT_DESTINATION }));
    renderView();
    expect(screen.getByText(/isn’t a decision you can open/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t find it/i)).not.toBeInTheDocument();
  });

  it('a 404 says we could not find it — never "not a decision"', () => {
    useDecisionDetail.mockReturnValue(state({ refusal: DETAIL_REFUSAL.NOT_FOUND }));
    renderView();
    expect(screen.getByText(/couldn’t find it in this workspace/i)).toBeInTheDocument();
    expect(screen.queryByText(/plan artifact/i)).not.toBeInTheDocument();
  });

  it('a failed read blames our side, not the account', () => {
    useDecisionDetail.mockReturnValue(state({ refusal: DETAIL_REFUSAL.UNREADABLE }));
    renderView();
    expect(screen.getByText(/problem on our side/i)).toBeInTheDocument();
  });
});
