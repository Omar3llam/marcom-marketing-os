// ============================================================
// Currency Layer 2/3 — Measurement surfaces format money correctly
// ------------------------------------------------------------
// Proves money is no longer hardcoded to USD:
//   • the pure panels format in the currency they're GIVEN (a non-USD prop
//     produces a non-USD string — the '$' glyph never appears for EGP);
//   • they fall back to USD only when given nothing;
//   • MeasurementView threads the WORKSPACE currency into both panels, so an
//     EGP workspace renders EGP money without any prop being passed by hand.
// (The minor-unit exponent correctness itself lives in money.ts's own tests.)
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

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
        merAfter:         { low: 3.1, expected: 3.5, high: 3.9 },
      },
      assumptions: ['added budget retains efficiency'], confidence: 0.6,
    },
    message: null, loading: false, error: null, run: () => {},
  }),
}));
vi.mock('@/hooks/useIncrementality.js', () => ({
  useIncrementality: () => ({ tests: [], readouts: {}, gated: false, loading: false, error: null, busyId: null, design: () => {}, recordCounts: () => {}, conclude: () => {} }),
}));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: 'EGP' } }) }));
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
    merAfter:         { low: 3.1, expected: 3.5, high: 3.9 },
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
  it('falls back to USD only when neither scenario nor prop carries a currency', () => {
    const { container } = render(<ScenarioPanel scenario={scenarioNoCcy} onRun={vi.fn()} />);
    expect(container.textContent).toContain('$10,000.00'); // 1000000 minor → $10,000.00 via money.ts
  });
});

describe('IncrementalityPanel — formats incremental revenue in the given currency', () => {
  it('uses the threaded currency (EGP), not USD', () => {
    const { container } = render(<IncrementalityPanel tests={[concludedYes]} currency="EGP" onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} />);
    expect(container.textContent).toMatch(/incremental revenue/);
    expect(container.textContent).not.toContain('$');
  });
  it('defaults to USD when no currency prop is passed', () => {
    const { container } = render(<IncrementalityPanel tests={[concludedYes]} onDesign={vi.fn()} onRecord={vi.fn()} onConclude={vi.fn()} />);
    expect(container.textContent).toContain('$500.00'); // 50000 minor → $500.00
  });
});

describe('MeasurementView — threads the workspace currency into both panels', () => {
  it('renders scenario money in the workspace currency (EGP), never USD', () => {
    const { container } = render(<MeasurementView />);
    expect(container.textContent).toMatch(/Projected outcome/);
    expect(container.textContent).not.toContain('$');
  });
});
