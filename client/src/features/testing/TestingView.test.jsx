// ============================================================
// TestingView — honest sample counts (no fabricated zeros)
// ------------------------------------------------------------
// Governing law: an UNRECORDED arm is null → renders "—", never a coerced 0 that
// reads as a real zero-sample arm. A genuine recorded 0 still shows "0". The
// conclude gate (thinGate) coalesces null → 0 as calculation identity (an
// unrecorded arm is below the floor, so the gate stays closed).
// ============================================================
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TestingView, thinGate } from './TestingView.jsx';

function renderView(experiments) {
  return render(
    <MemoryRouter>
      <TestingView experiments={experiments} role="BUYER" />
    </MemoryRouter>,
  );
}

describe('TestingView — no fabricated sample zeros', () => {
  it('renders "—" for an unrecorded (null) arm, never "0 impressions"', () => {
    const { container } = renderView([{
      id: 't1', status: 'RUNNING', dimension: 'CREATIVE', metric: 'CTR',
      variants: [
        { id: 'a', label: 'Control', isControl: true, impressions: 1500, clicks: 30, conversions: 3 },
        { id: 'b', label: 'Variant B', isControl: false, impressions: null, clicks: null, conversions: null },
      ],
    }]);
    expect(container.textContent).toContain('1,500 impressions');   // real arm shows its count
    expect(container.textContent).toContain('Variant B— impressions'); // null arm → em-dash
    expect(container.textContent).not.toContain('Variant B0');      // never a fabricated zero
  });

  it('renders a genuine recorded 0 as "0" (a real zero is not hidden)', () => {
    const { container } = renderView([{
      id: 't2', status: 'RUNNING', dimension: 'CREATIVE', metric: 'CTR',
      variants: [
        { id: 'a', label: 'Control', isControl: true, impressions: 0, clicks: 0, conversions: 0 },
        { id: 'b', label: 'Variant B', isControl: false, impressions: 1200, clicks: 20, conversions: 2 },
      ],
    }]);
    expect(container.textContent).toContain('Control (control)0 impressions'); // recorded zero shown honestly
    expect(container.textContent).toContain('1,200 impressions');
  });
});

describe('thinGate — unrecorded arm counts as 0 (gate stays closed)', () => {
  it('null sample coalesces to 0 so the conclude gate is not "ready"', () => {
    const gate = thinGate({ metric: 'CTR', variants: [{ impressions: null }, { impressions: 1500 }] });
    expect(gate.minSample).toBe(0);
    expect(gate.ready).toBe(false);
  });

  it('both arms above the floor → ready, with the true minimum', () => {
    const gate = thinGate({ metric: 'CTR', variants: [{ impressions: 2000 }, { impressions: 1500 }] });
    expect(gate.ready).toBe(true);
    expect(gate.minSample).toBe(1500);
  });
});

// ── Tier 2b · an unreadable experiment is never an absent one ───────────────
// `useTests` used to drop a row that failed the contract, calling it an
// "honest seam, resilient to one bad row". A list every row of which failed
// then rendered "No experiments yet — Lumi proposes a weekly testing agenda you
// can commit." — a claim about the account, made from rows it could not read.
//
// This list is re-ordered by STATUS, so wire position carries no meaning here;
// what is asserted is that the row SURVIVES and the empty claim accounts for it.
describe('TestingView — unreadable experiments survive', () => {
  const unreadable = (index) => ({ state: 'UNREADABLE', index, value: null });

  it('does NOT claim "No experiments yet" when a row could not be read', () => {
    const { container } = render(
      <MemoryRouter><TestingView experiments={[]} experimentRows={[unreadable(0)]} /></MemoryRouter>,
    );
    expect(container.textContent).not.toMatch(/No experiments yet/i);
    expect(container.textContent).toMatch(/couldn’t be read/i);
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('a GENUINELY empty list still says so, with nothing marked', () => {
    const { container } = render(
      <MemoryRouter><TestingView experiments={[]} experimentRows={[]} /></MemoryRouter>,
    );
    expect(container.textContent).toMatch(/No experiments yet/i);
    expect(container.textContent).not.toMatch(/couldn’t be read/i);
  });

  it('and given no rows at all it still renders from experiments (back-compat)', () => {
    const { container } = render(
      <MemoryRouter><TestingView experiments={[]} /></MemoryRouter>,
    );
    expect(container.textContent).toMatch(/No experiments yet/i);
  });
});
