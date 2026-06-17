// ============================================================
// Phase 4-E — Measurement OS: honest states + the write→read loop
// ------------------------------------------------------------
// Pure-component assertions (no network):
//   • Scenario projects RANGES (never points) and labels its CAC PROJECTED —
//     distinct from the realized current CAC on the economics surface.
//   • Incrementality is honest end to end: a 403 is a LOCKED state (not a
//     failure); a DESIGNED holdout cannot be concluded (no button until counts
//     are recorded — never a lift off empty arms); a CONCLUDED row renders its
//     persisted result, and an inconclusive one says so plainly.
// The contract seam safeParses representative response envelopes.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScenarioPanel } from '../ScenarioPanel.jsx';
import { IncrementalityPanel } from '../IncrementalityPanel.jsx';
import {
  ScenarioResponseSchema,
  IncrementalityListResponseSchema,
  ConcludeIncrementalityResponseSchema,
} from '@/contracts/schemas';

// ── Fixtures ────────────────────────────────────────────────
const scenario = {
  scenarioType: 'BUDGET_EXPANSION',
  change: { type: 'BUDGET_EXPANSION', deltaPct: 0.2 },
  currency: 'USD',
  projections: {
    blendedCacMinor:  { low: 1800, expected: 2000, high: 2300 },
    volume:           { low: 90, expected: 100, high: 110 },
    revenueMinor:     { low: 900000, expected: 1000000, high: 1100000 },
    grossProfitMinor: { low: 540000, expected: 600000, high: 660000 },
    merAfter:         { low: 3.1, expected: 3.5, high: 3.9 },
  },
  assumptions: ['expected: added budget retains 85% of marginal efficiency', 'diminishing returns above +25% per-channel spend swing'],
  confidence: 0.6,
  basis: 'BUDGET_EXPANSION: projected as a range under 3 retention assumptions',
  memoryBasis: [{ patternId: 'p1', kind: 'CHANNEL', statement: 'META scales', accuracy: 0.8 }],
};

const designed = { id: 't1', workspaceId: 'ws', name: 'META holdout', channel: 'META', holdoutPct: 0.1, mde: 0.1, sampleSizePerArm: 5000, durationDays: 14, status: 'DESIGNED' };
const running = { ...designed, id: 't2', status: 'RUNNING', exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250 };
const concludedYes = { ...designed, id: 't3', status: 'CONCLUDED', liftPct: 20, ciLow: 0.001, ciHigh: 0.018, confidenceLabel: 'MEDIUM', incrementalRevenueMinor: 50000 };
const concludedNo = { ...designed, id: 't4', status: 'CONCLUDED', liftPct: 4, ciLow: -0.01, ciHigh: 0.02, confidenceLabel: null, incrementalRevenueMinor: null };

// ── ScenarioPanel ───────────────────────────────────────────
describe('ScenarioPanel — forward what-if as ranges, CAC labelled projected', () => {
  it('shows controls and fabricates nothing before a run', () => {
    const { container } = render(<ScenarioPanel onRun={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^project$/i })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Projected outcome/i);
  });

  it('renders projection ranges + confidence + assumptions, and labels CAC projected', () => {
    const { container } = render(<ScenarioPanel scenario={scenario} onRun={vi.fn()} />);
    const t = container.textContent || '';
    expect(t).toMatch(/Projected CAC/);
    expect(t).toContain('(90–110)');               // a range, not a point
    expect(t).toMatch(/60% confidence/);
    expect(t).toMatch(/retains 85% of marginal efficiency/);
    expect(t).toMatch(/forward hypothetical/i);     // not the realized current CAC
    expect(t).toMatch(/Powered by 1 learned pattern/);
  });

  it('honest empty when there is no channel data, and honest error', () => {
    const { rerender, container } = render(<ScenarioPanel message="No channel data to project yet." onRun={vi.fn()} />);
    expect(container.textContent).toMatch(/No channel data to project yet/);
    rerender(<ScenarioPanel error={new Error('x')} onRun={vi.fn()} />);
    expect(screen.getByText(/Couldn’t project that scenario/i)).toBeInTheDocument();
  });

  it('runs an expansion by default and a signed contraction when toggled', () => {
    const onRun = vi.fn();
    render(<ScenarioPanel onRun={onRun} />);
    fireEvent.click(screen.getByRole('button', { name: /^project$/i }));
    expect(onRun).toHaveBeenLastCalledWith({ type: 'BUDGET_EXPANSION', deltaPct: 0.2 });
    fireEvent.click(screen.getByRole('button', { name: /^contract$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^project$/i }));
    expect(onRun).toHaveBeenLastCalledWith({ type: 'BUDGET_CONTRACTION', deltaPct: -0.2 });
  });
});

// ── IncrementalityPanel ─────────────────────────────────────
describe('IncrementalityPanel — gated lock + honest holdout loop', () => {
  it('renders the tier-gate as an honest locked state (not an error)', () => {
    render(<IncrementalityPanel gated onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} />);
    expect(screen.getByText(/Agency\/Enterprise capability/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Channel$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load/i)).not.toBeInTheDocument();
  });

  it('a DESIGNED holdout awaits results and CANNOT be concluded yet', () => {
    render(<IncrementalityPanel tests={[designed]} onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} />);
    expect(screen.getByText(/Awaiting observed results/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /conclude holdout/i })).not.toBeInTheDocument();
  });

  it('a RUNNING holdout (counts recorded) can be concluded', () => {
    render(<IncrementalityPanel tests={[running]} onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} />);
    expect(screen.getByRole('button', { name: /conclude holdout/i })).toBeInTheDocument();
  });

  it('a conclusive CONCLUDED holdout shows its persisted lift + confidence', () => {
    const { container } = render(<IncrementalityPanel tests={[concludedYes]} onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} />);
    expect(container.textContent).toMatch(/\+20% incremental lift/);
    expect(container.textContent).toMatch(/MEDIUM confidence/);
  });

  it('an inconclusive CONCLUDED holdout says so plainly (no hopeful number)', () => {
    render(<IncrementalityPanel tests={[concludedNo]} onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} />);
    expect(screen.getByText(/No causal lift called/i)).toBeInTheDocument();
  });
});

describe('IncrementalityPanel — design + record write the real shapes', () => {
  it('design converts CVR/MDE percents to rates', () => {
    const onDesign = vi.fn();
    render(<IncrementalityPanel tests={[]} onDesign={onDesign} onRecord={vi.fn()} onConclude={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Channel$/i), { target: { value: 'meta' } });
    fireEvent.change(screen.getByLabelText(/Baseline CVR percent/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Minimum detectable lift percent/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Daily eligible users/i), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /design holdout/i }));
    expect(onDesign).toHaveBeenCalledWith({ channel: 'META', baselineCvr: 0.02, mde: 0.1, dailyEligible: 5000 });
  });

  it('record submits the four integer counts for the holdout', () => {
    const onRecord = vi.fn();
    render(<IncrementalityPanel tests={[designed]} onDesign={vi.fn()} onRecord={onRecord} onConclude={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Exposed users$/i), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/^Exposed conversions$/i), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText(/^Holdout users$/i), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/^Holdout conversions$/i), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: /record observed results/i }));
    expect(onRecord).toHaveBeenCalledWith('t1', { exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250 });
  });
});

// ── Contract seam ───────────────────────────────────────────
describe('contract seam — response envelopes safeParse', () => {
  it('ScenarioResponseSchema validates a real projection', () => {
    expect(ScenarioResponseSchema.safeParse({ workspaceId: 'ws', generatedAt: new Date().toISOString(), scenario }).success).toBe(true);
  });
  it('ScenarioResponseSchema validates the null/no-data envelope', () => {
    expect(ScenarioResponseSchema.safeParse({ workspaceId: 'ws', scenario: null, message: 'No channel data to project yet.' }).success).toBe(true);
  });
  it('IncrementalityListResponseSchema validates the holdout list', () => {
    expect(IncrementalityListResponseSchema.safeParse({ workspaceId: 'ws', tests: [designed, running, concludedYes, concludedNo] }).success).toBe(true);
  });
  it('ConcludeIncrementalityResponseSchema validates an attributed readout', () => {
    const res = {
      workspaceId: 'ws', memoryId: 'm1', decisionId: 'd1',
      readout: {
        status: 'CONCLUSIVE', exposedCvr: 0.06, holdoutCvr: 0.05, absoluteLift: 0.01, liftPct: 20,
        ci: [0.001, 0.018], confidenceLabel: 'MEDIUM', conclusive: true,
        incrementalConversions: { value: 50, source: 'INCREMENTALITY', confidence: 'MEDIUM', band: [0.001, 0.018], caveat: 'lift among exposed' },
        incrementalRevenueMinor: { value: 50000, source: 'INCREMENTALITY', confidence: 'MEDIUM', band: null, caveat: 'conversions × AOV' },
        rationale: 'Exposed 0.06 vs holdout 0.05 CVR → +20% incremental, MEDIUM confidence.',
      },
    };
    expect(ConcludeIncrementalityResponseSchema.safeParse(res).success).toBe(true);
  });
});
