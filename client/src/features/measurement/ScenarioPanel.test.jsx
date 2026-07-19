// ============================================================
// ScenarioPanel — honest empty state when unit economics is unconfigured
// ------------------------------------------------------------
// When the server marks economicsStatus = NOT_CONFIGURED it also blanks the
// AOV-derived projection ranges to null → the panel must render "—" for Volume /
// CAC / Gross Profit and surface a "Configure Unit Economics →" CTA, while the
// spend/ROAS-based rows (Revenue, MER) still render real values.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ScenarioPanel } from './ScenarioPanel.jsx';

const NULL_RANGE = { low: null, expected: null, high: null };

const configuredScenario = () => ({
  scenarioType: 'BUDGET_EXPANSION',
  change: { type: 'BUDGET_EXPANSION', deltaPct: 0.2 },
  currency: 'USD',
  economicsStatus: 'CONFIGURED',
  projections: {
    blendedCacMinor:  { low: 1800,   expected: 2000,   high: 2200 },
    volume:           { low: 90,     expected: 100,    high: 110 },
    revenueMinor:     { low: 450000, expected: 500000, high: 550000 },
    grossProfitMinor: { low: 225000, expected: 250000, high: 275000 },
    merAfter:         { low: 2.1,    expected: 2.5,    high: 2.9 },
  },
  assumptions: ['expected: added budget retains 85% of marginal efficiency'],
  confidence: 0.6,
  basis: 'BUDGET_EXPANSION: projected as a range',
});

// What the server sends when economics is unconfigured: status flipped +
// AOV-derived ranges blanked to null (revenue/MER preserved).
const notConfiguredScenario = () => ({
  ...configuredScenario(),
  economicsStatus: 'NOT_CONFIGURED',
  projections: {
    ...configuredScenario().projections,
    volume:           { ...NULL_RANGE },
    blendedCacMinor:  { ...NULL_RANGE },
    grossProfitMinor: { ...NULL_RANGE },
  },
  assumptions: [
    'expected: added budget retains 85% of marginal efficiency',
    'Volume, CAC and Gross Profit require configured Unit Economics. Default AOV was intentionally not used — configure Economics to unlock these projections.',
  ],
});

const renderPanel = (scenario) =>
  render(
    <MemoryRouter>
      <ScenarioPanel scenario={scenario} onRun={vi.fn()} currency="USD" />
    </MemoryRouter>,
  );

describe('ScenarioPanel — economics NOT configured', () => {
  it('renders "—" for Volume (no fabricated orders off a default AOV)', () => {
    renderPanel(notConfiguredScenario());
    // volume expected=100 would render as "100" when configured; blanked → absent
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('still renders the spend/ROAS-based MER (economics-independent)', () => {
    renderPanel(notConfiguredScenario());
    expect(screen.getByText('2.5×')).toBeInTheDocument();
  });

  it('surfaces a Configure Unit Economics CTA to the Growth Strategy page', () => {
    renderPanel(notConfiguredScenario());
    const link = screen.getByRole('link', { name: /configure unit economics/i });
    expect(link).toHaveAttribute('href', '/app/intelligence/insights');
  });
});

describe('ScenarioPanel — economics configured', () => {
  it('renders the real Volume value', () => {
    renderPanel(configuredScenario());
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('shows no Configure-Unit-Economics CTA', () => {
    renderPanel(configuredScenario());
    expect(screen.queryByRole('link', { name: /configure unit economics/i })).not.toBeInTheDocument();
  });
});
