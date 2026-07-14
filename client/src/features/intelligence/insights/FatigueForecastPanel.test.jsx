// ============================================================
// FatigueForecastPanel — named per-campaign fatigue display
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FatigueForecastPanel } from './FatigueForecastPanel.jsx';

const row = (o = {}) => ({
  entityId: 'c1', name: 'Ramadan Wave', channel: 'meta',
  currentFrequency: 3.6, velocity: 0.2, daysUntilSaturation: 0, status: 'SATURATED', ...o,
});

// Rows are now <Link>s → every render needs a Router context.
const renderPanel = (props) => render(<MemoryRouter><FatigueForecastPanel {...props} /></MemoryRouter>);

describe('FatigueForecastPanel', () => {
  it('renders a skeleton while loading', () => {
    renderPanel({ forecast: [], loading: true });
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it('hides entirely when the forecast is empty (not an empty-state card)', () => {
    const { container } = renderPanel({ forecast: [], loading: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a SATURATED campaign as "saturated now" with its name', () => {
    renderPanel({ forecast: [row({ status: 'SATURATED' })] });
    expect(screen.getByText('Ramadan Wave')).toBeInTheDocument();
    expect(screen.getByText('saturated now')).toBeInTheDocument();
  });

  it('shows AT_RISK as "~N days" plus the rising velocity', () => {
    renderPanel({ forecast: [row({ status: 'AT_RISK', daysUntilSaturation: 6, currentFrequency: 3.2, velocity: 0.05 })] });
    expect(screen.getByText('~6 days')).toBeInTheDocument();
    expect(screen.getByText(/\+0\.05\/day/)).toBeInTheDocument();
  });

  it('shows STABLE as "stable" with no velocity', () => {
    renderPanel({ forecast: [row({ status: 'STABLE', velocity: null, daysUntilSaturation: null, currentFrequency: 2.9 })] });
    expect(screen.getByText('stable')).toBeInTheDocument();
    expect(screen.queryByText(/\/day/)).not.toBeInTheDocument();
  });

  it('shows compact reach and "% of ceiling" when present', () => {
    renderPanel({ forecast: [row({ reach: 45200, exhaustionPct: 91 })] });
    expect(screen.getByText(/reach 45\.2k/)).toBeInTheDocument();
    expect(screen.getByText(/91% of ceiling/)).toBeInTheDocument();
  });

  it('omits reach and exhaustion when absent (honest, no fabrication)', () => {
    renderPanel({ forecast: [row({ reach: null, exhaustionPct: null })] });
    expect(screen.queryByText(/reach/)).not.toBeInTheDocument();
    expect(screen.queryByText(/of ceiling/)).not.toBeInTheDocument();
  });

  it('deep-links each campaign to its Campaigns row (?entity=)', () => {
    renderPanel({ forecast: [row({ entityId: 'abc-123' })] });
    const link = screen.getByRole('link', { name: /Ramadan Wave/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('entity=abc-123'));
  });
});
