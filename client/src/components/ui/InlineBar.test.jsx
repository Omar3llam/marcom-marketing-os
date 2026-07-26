// ============================================================
// InlineBar — one scale, always higher-is-better
// ------------------------------------------------------------
// The bar has NO `inverted` prop and never will: a metric where higher is worse
// (wasted spend) is the caller's problem to state, by passing the value it
// actually wants shown. Putting business meaning in a bar is how the Wasted
// Spend card ended up painting 12% waste RED and 80% waste GREEN.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import InlineBar from './InlineBar.jsx';

const fillOf = (ui) => render(ui).container.querySelector('[role="progressbar"] > div');

describe('InlineBar — colour tiers', () => {
  it('high value → green', () => {
    expect(fillOf(<InlineBar value={80} max={100} />)).toHaveClass('bg-signal-scale');
  });

  it('mid value → gold', () => {
    expect(fillOf(<InlineBar value={50} max={100} />)).toHaveClass('bg-lumi-gold');
  });

  it('low value → red', () => {
    expect(fillOf(<InlineBar value={20} max={100} />)).toHaveClass('bg-signal-kill');
  });

  it('tiers scale with max, not with a hardcoded 100', () => {
    // The impact caller passes max={10}; 8/10 must read the same as 80/100.
    expect(fillOf(<InlineBar value={8} max={10} />)).toHaveClass('bg-signal-scale');
    expect(fillOf(<InlineBar value={2} max={10} />)).toHaveClass('bg-signal-kill');
  });
});

// The caller inverts. These are the two cases the shipped bug got backwards.
describe('InlineBar — the caller states the direction', () => {
  it('12% wasted → the caller passes 88 → GREEN (a healthy account reads healthy)', () => {
    expect(fillOf(<InlineBar value={100 - 12} max={100} />)).toHaveClass('bg-signal-scale');
  });

  it('80% wasted → the caller passes 20 → RED (a burning account reads burning)', () => {
    expect(fillOf(<InlineBar value={100 - 80} max={100} />)).toHaveClass('bg-signal-kill');
  });

  it('exposes no inversion prop — the component stays free of business meaning', () => {
    // Passing one must change nothing: it is not part of the API.
    const withProp = fillOf(<InlineBar value={20} max={100} inverted />);
    const without  = fillOf(<InlineBar value={20} max={100} />);
    expect(withProp.className).toBe(without.className);
  });
});

describe('InlineBar — contract', () => {
  it('keeps its progressbar semantics', () => {
    const { container } = render(<InlineBar value={40} max={100} ariaLabel="40% of spend working" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-label', '40% of spend working');
  });

  it('clamps out-of-range values rather than overflowing', () => {
    expect(fillOf(<InlineBar value={140} max={100} />)).toHaveStyle({ width: '100%' });
    expect(fillOf(<InlineBar value={-10} max={100} />)).toHaveStyle({ width: '0%' });
  });
});
