// ============================================================
// Pagination
// ------------------------------------------------------------
// The range it prints is read as a fact about the whole result set, so the
// arithmetic tests matter more than the interaction ones.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from './Pagination.jsx';

const prev = () => screen.getByRole('button', { name: 'Previous page' });
const next = () => screen.getByRole('button', { name: 'Next page' });

describe('Pagination — when it renders at all', () => {
  it.each([
    ['everything fits on one page', { total: 20, limit: 25, offset: 0 }],
    ['exactly one full page', { total: 25, limit: 25, offset: 0 }],
    ['there is nothing at all', { total: 0, limit: 25, offset: 0 }],
  ])('renders nothing when %s', (_label, props) => {
    const { container } = render(<Pagination {...props} onPageChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders once there is a second page', () => {
    render(<Pagination total={26} limit={25} offset={0} onPageChange={vi.fn()} />);
    expect(next()).toBeInTheDocument();
  });
});

describe('Pagination — the range', () => {
  it('states the range and the real total', () => {
    render(<Pagination total={312} limit={25} offset={0} onPageChange={vi.fn()} />);
    expect(screen.getByText('1–25 of 312')).toBeInTheDocument();
    expect(screen.getByText('1 / 13')).toBeInTheDocument();
  });

  it('advances the range with the offset', () => {
    render(<Pagination total={312} limit={25} offset={25} onPageChange={vi.fn()} />);
    expect(screen.getByText('26–50 of 312')).toBeInTheDocument();
    expect(screen.getByText('2 / 13')).toBeInTheDocument();
  });

  it('the last page stops at the total, not at offset + limit', () => {
    render(<Pagination total={312} limit={25} offset={300} onPageChange={vi.fn()} />);
    expect(screen.getByText('301–312 of 312')).toBeInTheDocument();
    expect(screen.getByText('13 / 13')).toBeInTheDocument();
  });

  // A filter can narrow the set under a reader who is already deep in it.
  // "51–40 of 40" would be nonsense presented with the same confidence.
  it('clamps an offset that overshoots the total', () => {
    render(<Pagination total={40} limit={25} offset={50} onPageChange={vi.fn()} />);
    expect(screen.getByText('40–40 of 40')).toBeInTheDocument();
  });
});

describe('Pagination — the controls', () => {
  it('previous is disabled on the first page', () => {
    render(<Pagination total={312} limit={25} offset={0} onPageChange={vi.fn()} />);
    expect(prev()).toBeDisabled();
    expect(next()).toBeEnabled();
  });

  it('next is disabled on the last page', () => {
    render(<Pagination total={312} limit={25} offset={300} onPageChange={vi.fn()} />);
    expect(next()).toBeDisabled();
    expect(prev()).toBeEnabled();
  });

  it('next advances by one page', () => {
    const onPageChange = vi.fn();
    render(<Pagination total={312} limit={25} offset={50} onPageChange={onPageChange} />);
    fireEvent.click(next());
    expect(onPageChange).toHaveBeenCalledWith(75);
  });

  it('previous goes back by one page', () => {
    const onPageChange = vi.fn();
    render(<Pagination total={312} limit={25} offset={50} onPageChange={onPageChange} />);
    fireEvent.click(prev());
    expect(onPageChange).toHaveBeenCalledWith(25);
  });

  it('previous never asks for a negative offset', () => {
    const onPageChange = vi.fn();
    render(<Pagination total={312} limit={25} offset={10} onPageChange={onPageChange} />);
    fireEvent.click(prev());
    expect(onPageChange).toHaveBeenCalledWith(0);
  });

  // "←" as an accessible name tells a screen-reader user nothing.
  it('labels the arrows for assistive tech', () => {
    render(<Pagination total={312} limit={25} offset={25} onPageChange={vi.fn()} />);
    expect(prev()).toBeInTheDocument();
    expect(next()).toBeInTheDocument();
  });
});
