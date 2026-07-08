// ============================================================
// HistoryRail — honest states + item rendering
// ------------------------------------------------------------
// Pure + prop-driven: loading skeleton, actionable empty state, error line, and
// a list whose items carry campaign name / relative time / sections / author.
// Clicking an item calls onSelect with that generation.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HistoryRail, { sectionsLabel, relTime } from './HistoryRail.jsx';

const GENS = [
  {
    id: 'g1',
    content: { copy: [{ tag: 'STORY', text: 'x' }] },
    context: { campaignContext: { name: 'Folla' }, options: { copy: true, headlines: true }, tone: 'Bold' },
    createdAt: new Date().toISOString(),
    createdBy: { email: 'a@b.com' },
  },
  {
    id: 'g2',
    content: {},
    context: { campaignContext: null, options: { visual: true } },
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    createdBy: { email: 'c@d.com' },
  },
];

describe('HistoryRail — helpers', () => {
  it('sectionsLabel maps toggles to a readable list', () => {
    expect(sectionsLabel({ copy: true, headlines: true, cta: false, visual: true })).toBe('Copy · Headlines · Visual');
    expect(sectionsLabel(null)).toBe('');
  });
  it('relTime is human + relative', () => {
    expect(relTime(new Date().toISOString())).toMatch(/just now|min ago/);
    expect(relTime(null)).toBe('');
  });
});

describe('HistoryRail — states', () => {
  it('loading → skeleton rows, no items', () => {
    const { container } = render(<HistoryRail isLoading />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('empty → actionable empty copy', () => {
    render(<HistoryRail generations={[]} />);
    expect(screen.getByText(/Your generations will appear here/i)).toBeInTheDocument();
  });

  it('error → honest line, never a blank rail', () => {
    render(<HistoryRail error={new Error('x')} />);
    expect(screen.getByText(/Couldn.t load history/i)).toBeInTheDocument();
  });

  it('list → renders campaign name, relative time, sections; falls back to "General brief"', () => {
    render(<HistoryRail generations={GENS} />);
    expect(screen.getByText('Folla')).toBeInTheDocument();
    expect(screen.getByText('General brief')).toBeInTheDocument();        // g2 has no campaign
    expect(screen.getByText('Copy · Headlines')).toBeInTheDocument();
  });

  it('clicking an item calls onSelect with that generation', () => {
    const onSelect = vi.fn();
    render(<HistoryRail generations={GENS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Folla/i }));
    expect(onSelect).toHaveBeenCalledWith(GENS[0]);
  });

  it('shows the author only when multiUser', () => {
    const { rerender } = render(<HistoryRail generations={GENS} multiUser={false} />);
    expect(screen.queryByText(/by a@b.com/i)).not.toBeInTheDocument();
    rerender(<HistoryRail generations={GENS} multiUser />);
    expect(screen.getByText(/by a@b.com/i)).toBeInTheDocument();
  });
});
