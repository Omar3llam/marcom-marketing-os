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
    blendedRevenueEfficiencyAfter: { low: 2.1, expected: 2.5, high: 2.9 },
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

  it('still renders eligible blended efficiency without configured economics', () => {
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

// ── Tier gate (P1.4): a 403 from requirePlan('PRO') is an honest LOCKED state.
// `gated` wins over every other state (mirrors IncrementalityPanel) — the panel
// renders the UpgradePrompt, never the controls or an error flash.
describe('ScenarioPanel — tier gate (gated)', () => {
  const renderGate = (props) =>
    render(
      <MemoryRouter>
        <ScenarioPanel onRun={vi.fn()} currency="USD" {...props} />
      </MemoryRouter>,
    );

  it('permission refusal cannot recommend an upgrade or name a subscription', () => {
    const { container } = renderGate({ gated: true, gateReason: 'NOT_PERMITTED' });
    expect(screen.getByText('Scenario projection isn’t available for this seat.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/upgrade|\bPRO\b|subscription|payment|billing/i);
    expect(screen.queryByRole('button', { name: /retry|project/i })).not.toBeInTheDocument();
  });

  it('renders the upgrade prompt (PRO) when gated — no Project controls', () => {
    renderGate({ gated: true, gateReason: 'PLAN_REQUIRED' });
    expect(screen.getByText(/Scenario projection is a Pro feature/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /project/i })).not.toBeInTheDocument();
  });

  it('gated wins over a stale error — never shows both', () => {
    renderGate({ gated: true, gateReason: 'PLAN_REQUIRED', error: new Error('boom') });
    expect(screen.getByText(/Scenario projection is a Pro feature/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t project/i)).not.toBeInTheDocument();
  });

  it('renders the projection controls when ungated', () => {
    renderGate({ gated: false });
    expect(screen.getByRole('button', { name: /project/i })).toBeInTheDocument();
    expect(screen.queryByText(/is a Pro feature/i)).not.toBeInTheDocument();
  });

  it('an unclassified refusal is neutral and suppresses stale error/results', () => {
    renderGate({ gated: true, scenario: configuredScenario(), error: new Error('boom') });
    expect(screen.getByText('Scenario projection isn’t available for this seat.')).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t project|Projected outcome|Pro feature/i)).not.toBeInTheDocument();
  });

  it('pending projection disables the existing control and retains its pending label', () => {
    renderGate({ loading: true });
    expect(screen.getByRole('button', { name: 'Projecting…' })).toBeDisabled();
  });
});
