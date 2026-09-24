// ============================================================
// PerformingWellSection — a count, and only a spend it can back up
// ------------------------------------------------------------
// "nothing measured" is not "zero protected": when no healthy campaign reported
// a spend the line is omitted, never printed as 0.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PerformingWellSection from './PerformingWellSection.jsx';

describe('the count', () => {
  it('renders the number of healthy campaigns', () => {
    render(<PerformingWellSection count={6} />);
    expect(screen.getByText('6 campaigns performing well')).toBeInTheDocument();
  });

  it('singular for one', () => {
    render(<PerformingWellSection count={1} />);
    expect(screen.getByText('1 campaign performing well')).toBeInTheDocument();
  });
});

describe('protected spend', () => {
  it('renders it in the reported currency', () => {
    render(<PerformingWellSection count={2} spend={500_000} currency="EGP" spendStatus="VALID" />);
    expect(screen.getByText(/Protected spend:/)).toBeInTheDocument();
  });

  it('is OMITTED when nothing reported a spend — never a fabricated 0', () => {
    render(<PerformingWellSection count={2} spend={null} />);
    expect(screen.queryByText(/Protected spend/)).not.toBeInTheDocument();
  });

  it('a real zero is still shown — measured zero is not missing', () => {
    render(<PerformingWellSection count={2} spend={0} currency="USD" spendStatus="VALID" />);
    expect(screen.getByText(/Protected spend:/)).toBeInTheDocument();
  });

  it.each(['MIXED', 'UNAVAILABLE'])('%s omits the number but keeps the count', (spendStatus) => {
    render(<PerformingWellSection count={2} spend={null} spendStatus={spendStatus} />);
    expect(screen.getByText('2 campaigns performing well')).toBeInTheDocument();
    expect(screen.getByText(/protected spend unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/Protected spend:/)).not.toBeInTheDocument();
  });
});

describe('no cards', () => {
  // The point of the band is that these need no attention; rendering three
  // decision cards would contradict the message it carries.
  it('renders no decision cards', () => {
    const { container } = render(<PerformingWellSection count={9} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
