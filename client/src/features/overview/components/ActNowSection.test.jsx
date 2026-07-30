// ============================================================
// ActNowSection — the header quotes the TRUE total, not the visible cards
// ------------------------------------------------------------
// Capping at SECTION_CAP must never shrink how much the account is told it has.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ActNowSection from './ActNowSection.jsx';

vi.mock('./DecisionCard.jsx', () => ({
  default: ({ name }) => <div data-testid="card">{name}</div>,
}));

const rows = (n) => Array.from({ length: n }, (_, i) => ({ entityId: `e${i}`, name: `Campaign ${i}` }));
const setup = (items, total) => render(
  <MemoryRouter><ActNowSection items={items} total={total} /></MemoryRouter>,
);

describe('the count', () => {
  it('quotes the true total even when the band is capped', () => {
    setup(rows(3), 7);
    expect(screen.getByText('7 decisions')).toBeInTheDocument();
    expect(screen.getAllByTestId('card')).toHaveLength(3);
  });

  it('singular for one decision', () => {
    setup(rows(1), 1);
    expect(screen.getByText('1 decision')).toBeInTheDocument();
  });
});

describe('the overflow link', () => {
  it('appears with the true total when there is more than fits', () => {
    setup(rows(3), 7);
    expect(screen.getByRole('link', { name: /View all 7 decisions/ })).toBeInTheDocument();
  });

  it('is absent when every decision is already on screen', () => {
    setup(rows(2), 2);
    expect(screen.queryByRole('link', { name: /View all/ })).not.toBeInTheDocument();
  });
});

describe('the ordering claim', () => {
  // The claim lives in this component, which only mounts when there are cards —
  // so it cannot outlive the order it describes.
  it('is made here, where the cards are', () => {
    setup(rows(3), 3);
    expect(screen.getByText('Highest impact first')).toBeInTheDocument();
  });
});
