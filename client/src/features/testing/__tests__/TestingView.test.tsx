// ============================================================
// Phase 4-A — Testing OS readout: honesty + the thin-sample gate
// ------------------------------------------------------------
// Pure-component assertions (no network): a CONCLUDED test shows the real
// persisted readout; an inconclusive one refuses to invent a winner; the
// Conclude action is gated until the smaller arm clears the metric floor; and
// a non-operator role never sees the control. The contract seam safeParses a
// representative row.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TestingView, thinGate, SAMPLE_FLOOR } from '../TestingView.jsx';
import { TestExperimentSchema } from '@/contracts/schemas';

const base = {
  workspaceId: 'ws-1', dimension: 'HOOK', hypothesis: 'Hook B lifts CTR',
  metric: 'CTR', expectedSignal: 'CTR up', priority: 1, currency: 'USD',
};
const variant = (id, label, isControl, impressions, clicks) => ({
  id, testId: 'x', label, isControl, impressions, clicks,
});

const CONCLUDED_WINNER = {
  ...base, id: 't-win', status: 'CONCLUDED',
  winnerLabel: 'Hook B', lift: 31, confidence: 0.98, confidenceLabel: 'HIGH',
  sampleNote: '50,000 impressions on the smaller arm.', decisionId: 'dec-1',
  variants: [variant('v-a', 'Hook A', true, 50000, 800), variant('v-b', 'Hook B', false, 50000, 1050)],
};
const CONCLUDED_INCONCLUSIVE = {
  ...base, id: 't-inc', status: 'CONCLUDED',
  winnerLabel: null, lift: 0, confidence: 0, confidenceLabel: 'INCONCLUSIVE',
  sampleNote: 'Only 180 impressions on the smaller arm — too thin to call (need 1000).', decisionId: null,
  variants: [variant('v-a', 'A', true, 180, 3), variant('v-b', 'B', false, 180, 4)],
};
const RUNNING_THIN = {
  ...base, id: 't-thin', status: 'RUNNING',
  variants: [variant('v-a', 'A', true, 200, 5), variant('v-b', 'B', false, 180, 6)],
};
const RUNNING_READY = {
  ...base, id: 't-ready', status: 'RUNNING',
  variants: [variant('v-a', 'A', true, 5000, 120), variant('v-b', 'B', false, 5200, 160)],
};

const renderView = (props) =>
  render(<MemoryRouter><TestingView {...props} /></MemoryRouter>);

describe('thinGate — mirrors the readout engine sample floor', () => {
  it('a below-floor running test is not ready, with the right shortfall', () => {
    const g = thinGate(RUNNING_THIN);
    expect(g.ready).toBe(false);
    expect(g.floor).toBe(SAMPLE_FLOOR.CTR);
    expect(g.minSample).toBe(180); // min of 200/180
  });
  it('a test past the floor is ready', () => {
    expect(thinGate(RUNNING_READY).ready).toBe(true);
  });
  it('an unknown metric does not fabricate a gate (ready, backend stays arbiter)', () => {
    expect(thinGate({ metric: 'XYZ', variants: [] }).ready).toBe(true);
  });
});

describe('TestingView — CONCLUDED readouts are honest', () => {
  it('renders the real winner, lift, confidence and a link to the proposed decision', () => {
    renderView({ experiments: [CONCLUDED_WINNER], role: 'BUYER' });
    expect(screen.getByText('Hook B')).toBeInTheDocument();
    expect(screen.getByText(/\+31% CTR/)).toBeInTheDocument();
    expect(screen.getByText(/HIGH confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/review in Decisions/i)).toBeInTheDocument();
  });
  it('refuses to invent a winner when inconclusive — shows WHY, not a fake call', () => {
    renderView({ experiments: [CONCLUDED_INCONCLUSIVE], role: 'BUYER' });
    expect(screen.getByText(/No winner called/i)).toBeInTheDocument();
    expect(screen.getByText(/too thin to call/i)).toBeInTheDocument();
    expect(screen.queryByText(/review in Decisions/i)).not.toBeInTheDocument();
  });
});

describe('TestingView — Conclude action + thin-sample gate', () => {
  it('disables Conclude with a shortfall note while below the floor', () => {
    renderView({ experiments: [RUNNING_THIN], role: 'BUYER', onConclude: vi.fn() });
    const btn = screen.getByRole('button', { name: /conclude/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/820 more impressions/)).toBeInTheDocument(); // 1000 - 180
  });
  it('enables Conclude past the floor and fires onConclude with the test id', () => {
    const onConclude = vi.fn();
    renderView({ experiments: [RUNNING_READY], role: 'BUYER', onConclude });
    const btn = screen.getByRole('button', { name: /conclude/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onConclude).toHaveBeenCalledWith('t-ready');
  });
  it('a non-operator role (CLIENT) never sees the Conclude control', () => {
    renderView({ experiments: [RUNNING_READY], role: 'CLIENT', onConclude: vi.fn() });
    expect(screen.queryByRole('button', { name: /conclude/i })).not.toBeInTheDocument();
  });
});

describe('TestingView — honest empty state', () => {
  it('shows the honest empty message and the proposed agenda', () => {
    renderView({ experiments: [], agenda: [{ id: 'a1', hypothesis: 'Try a softer hook' }], role: 'BUYER' });
    expect(screen.getByText(/No experiments yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Try a softer hook/i)).toBeInTheDocument();
  });
});

describe('contract seam — TestExperimentSchema safeParses a real row', () => {
  it('validates the concluded fixture', () => {
    expect(TestExperimentSchema.safeParse(CONCLUDED_WINNER).success).toBe(true);
  });
});
