// ============================================================
// Currency Layer 2/3 — Measurement surfaces format money correctly
// ------------------------------------------------------------
// Proves money is no longer hardcoded to USD:
//   • the pure panels format in the currency they're GIVEN (a non-USD prop
//     produces a non-USD string — the '$' glyph never appears for EGP);
//   • incrementality never borrows scenario/workspace denomination;
//   • unproven historical revenue stays withheld while causal lift survives.
// (The minor-unit exponent correctness itself lives in money.ts's own tests.)
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const workspaceState = vi.hoisted(() => ({ currency: 'EGP' }));

// B8-05 — each holdout row now links to its own destination (/app/measure/:id),
// so these renders need a router in context. Wrapping here leaves every call
// site below untouched.
const render = (ui: React.ReactElement, opts?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: MemoryRouter, ...opts });

// MeasurementView's hooks are mocked file-wide; the pure-panel tests below don't
// touch these modules, so the mocks are inert for them.
vi.mock('@/hooks/useScenario.js', () => ({
  useScenario: () => ({
    scenario: {
      scenarioType: 'BUDGET_EXPANSION',
      projections: {
        blendedCacMinor:  { low: 1800, expected: 2000, high: 2300 },
        volume:           { low: 90, expected: 100, high: 110 },
        revenueMinor:     { low: 900000, expected: 1000000, high: 1100000 },
        grossProfitMinor: { low: 540000, expected: 600000, high: 660000 },
        blendedRevenueEfficiencyAfter: { low: 3.1, expected: 3.5, high: 3.9 },
      },
      assumptions: ['added budget retains efficiency'], confidence: 0.6,
    },
    message: null, loading: false, error: null, run: () => {},
  }),
}));
vi.mock('@/hooks/useIncrementality.js', () => ({
  useIncrementality: () => ({ tests: [concludedYes], readouts: {}, gated: false, loading: false, error: null, busyId: null, design: () => {}, recordCounts: () => {}, conclude: () => {} }),
}));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: workspaceState.currency } }) }));
vi.mock('@/components/auth/RoleGate.jsx', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

import { ScenarioPanel } from '../ScenarioPanel.jsx';
import { IncrementalityPanel } from '../IncrementalityPanel.jsx';
import { MeasurementView } from '../MeasurementView.jsx';

// A scenario that carries NO currency of its own → the threaded prop governs.
const scenarioNoCcy = {
  scenarioType: 'BUDGET_EXPANSION',
  projections: {
    blendedCacMinor:  { low: 1800, expected: 2000, high: 2300 },
    volume:           { low: 90, expected: 100, high: 110 },
    revenueMinor:     { low: 900000, expected: 1000000, high: 1100000 },
    grossProfitMinor: { low: 540000, expected: 600000, high: 660000 },
    blendedRevenueEfficiencyAfter: { low: 3.1, expected: 3.5, high: 3.9 },
  },
  assumptions: ['x'], confidence: 0.6,
};
const concludedYes = { id: 't3', channel: 'META', status: 'CONCLUDED', liftPct: 20, confidenceLabel: 'MEDIUM', incrementalRevenueMinor: 50000, sampleSizePerArm: 5000, durationDays: 14 };

describe('ScenarioPanel — formats money in the given currency (Layer 2/3)', () => {
  it('uses the threaded currency (EGP), never the hardcoded USD glyph', () => {
    const { container } = render(<ScenarioPanel scenario={scenarioNoCcy} currency="EGP" onRun={vi.fn()} />);
    expect(container.textContent).toMatch(/Projected outcome/);
    expect(container.textContent).not.toContain('$');
  });
  it('does not invent USD when neither scenario nor prop carries a currency', () => {
    const { container } = render(<ScenarioPanel scenario={scenarioNoCcy} onRun={vi.fn()} />);
    expect(container.textContent).not.toContain('$');
  });
});

describe('IncrementalityPanel — legacy money cannot borrow denomination', () => {
  it('does not format raw historical revenue using a currency prop', () => {
    const { container } = render(<IncrementalityPanel tests={[concludedYes]} currency="EGP" onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} />);
    expect(container.textContent).toMatch(/20% incremental lift/);
    expect(container.textContent).not.toMatch(/incremental revenue|EGP|500\.00/);
    expect(container.textContent).not.toContain('$');
  });
  it('cannot default historical revenue to USD when no currency is passed', () => {
    const { container } = render(<IncrementalityPanel tests={[concludedYes]} onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} />);
    expect(container.textContent).toMatch(/20% incremental lift/);
    expect(container.textContent).not.toMatch(/\$|USD|incremental revenue|500\.00/);
  });
});

describe('MeasurementView — workspace currency governs only scenario compatibility', () => {
  it('renders scenario money in the workspace currency (EGP), never USD', () => {
    const { container } = render(<MeasurementView />);
    expect(container.textContent).toMatch(/Projected outcome/);
    expect(container.textContent).not.toContain('$');
  });
  it('workspace currency changes cannot reinterpret the same historical holdout', () => {
    const { container, rerender } = render(<MeasurementView />);
    const lift = container.querySelector('a[href="/app/measure/t3"]')?.parentElement?.parentElement?.textContent;
    expect(lift).toContain('20% incremental lift');
    expect(lift).not.toMatch(/incremental revenue|500\.00/);
    workspaceState.currency = 'SAR';
    rerender(<MeasurementView />);
    expect(container.querySelector('a[href="/app/measure/t3"]')?.parentElement?.parentElement?.textContent).toBe(lift);
    workspaceState.currency = 'EGP';
  });
});
