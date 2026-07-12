// ============================================================
// FatigueForecastPanel — named per-campaign fatigue display
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FatigueForecastPanel } from './FatigueForecastPanel.jsx';

const row = (o = {}) => ({
  entityId: 'c1', name: 'Ramadan Wave', channel: 'meta',
  currentFrequency: 3.6, velocity: 0.2, daysUntilSaturation: 0, status: 'SATURATED', ...o,
});

describe('FatigueForecastPanel', () => {
  it('renders a skeleton while loading', () => {
    render(<FatigueForecastPanel forecast={[]} loading />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it('hides entirely when the forecast is empty (not an empty-state card)', () => {
    const { container } = render(<FatigueForecastPanel forecast={[]} loading={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a SATURATED campaign as "saturated now" with its name', () => {
    render(<FatigueForecastPanel forecast={[row({ status: 'SATURATED' })]} />);
    expect(screen.getByText('Ramadan Wave')).toBeInTheDocument();
    expect(screen.getByText('saturated now')).toBeInTheDocument();
  });

  it('shows AT_RISK as "~N days" plus the rising velocity', () => {
    render(<FatigueForecastPanel forecast={[row({ status: 'AT_RISK', daysUntilSaturation: 6, currentFrequency: 3.2, velocity: 0.05 })]} />);
    expect(screen.getByText('~6 days')).toBeInTheDocument();
    expect(screen.getByText(/\+0\.05\/day/)).toBeInTheDocument();
  });

  it('shows STABLE as "stable" with no velocity', () => {
    render(<FatigueForecastPanel forecast={[row({ status: 'STABLE', velocity: null, daysUntilSaturation: null, currentFrequency: 2.9 })]} />);
    expect(screen.getByText('stable')).toBeInTheDocument();
    expect(screen.queryByText(/\/day/)).not.toBeInTheDocument();
  });
});
