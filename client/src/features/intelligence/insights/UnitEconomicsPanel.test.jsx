// ============================================================
// UnitEconomicsPanel — the assertion form is denominated, in BOTH directions
// ------------------------------------------------------------
// This file already carries the fix, three lines above the defect. Its own
// comment records it: the read-only display was "an inline /100 that truncated
// 3-dp currencies like KWD and added cents to 0-dp JPY", and it now formats
// through the canonical table. The FORM was missed, and the form is the
// dangerous half, because it is the only WRITE path to AccountEconomics:
//
//   display wrong → operator "corrects" the number they were shown
//                 → a wrong minor value is persisted
//                 → LTV, contribution per order and the LTV:CAC band inherit it
//
// The rule: never assume a 2-digit currency exponent. `lib/money.ts` is the
// table, and `fromMinor` / `toMinor` are the only two ways across the boundary.
//
// The closure condition Omar set is the ROUND TRIP: the number shown to the
// operator must be the number that comes back as minor units, at that
// currency's exponent. That is asserted below in both directions, and across a
// save — which is why the payload must carry the denomination it converted in.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { formatCurrency } from '@/lib/money';
import { UnitEconomicsPanel } from './UnitEconomicsPanel.jsx';

const economics = (over = {}) => ({
  workspaceId: 'ws-1',
  currency: 'USD',
  aovMinor: 5_000,
  grossMarginPct: 0.6,
  repeatRate: 0,
  avgOrdersPerCustomer: 1,
  targetLtvToCac: 3,
  ...over,
});

// reason NOT_CONFIGURED is the state that renders the assertion form.
const form = (over = {}) => ({
  workspaceId: 'ws-1',
  economics: economics(over),
  isDefault: true,
  currentCac: null,
  assessment: null,
  reason: 'NOT_CONFIGURED',
});

const aovField = () => screen.getByLabelText('Average order value');
const save = () => fireEvent.click(screen.getByRole('button', { name: /Save economics/ }));

describe('reading a stored AOV back into the form', () => {
  it('KWD (3 digits): 50,000 fils is 50 dinars, not 500', () => {
    render(<UnitEconomicsPanel data={form({ currency: 'KWD', aovMinor: 50_000 })} onSave={vi.fn()} />);
    expect(aovField()).toHaveValue('50');
  });

  it('JPY (0 digits): 5,000 minor units is 5,000 yen, not 50', () => {
    render(<UnitEconomicsPanel data={form({ currency: 'JPY', aovMinor: 5_000 })} onSave={vi.fn()} />);
    expect(aovField()).toHaveValue('5000');
  });

  it.each(['USD', 'EGP'])('%s (2 digits): unchanged', (code) => {
    render(<UnitEconomicsPanel data={form({ currency: code, aovMinor: 5_000 })} onSave={vi.fn()} />);
    expect(aovField()).toHaveValue('50');
  });

  it('an unknown code falls back to the table default of 2', () => {
    render(<UnitEconomicsPanel data={form({ currency: 'XYZ', aovMinor: 5_000 })} onSave={vi.fn()} />);
    expect(aovField()).toHaveValue('50');
  });
});

describe('writing an asserted AOV back out', () => {
  it('KWD (3 digits): 50 dinars saves as 50,000 fils, not 5,000', () => {
    const onSave = vi.fn();
    render(<UnitEconomicsPanel data={form({ currency: 'KWD', aovMinor: 50_000 })} onSave={onSave} />);
    fireEvent.change(aovField(), { target: { value: '50' } });
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aovMinor: 50_000 }));
  });

  it('KWD keeps the third decimal a 2-exponent write would have rounded away', () => {
    const onSave = vi.fn();
    render(<UnitEconomicsPanel data={form({ currency: 'KWD', aovMinor: 50_000 })} onSave={onSave} />);
    fireEvent.change(aovField(), { target: { value: '50.125' } });
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aovMinor: 50_125 }));
  });

  it('JPY (0 digits): 5,000 yen saves as 5,000, not 500,000', () => {
    const onSave = vi.fn();
    render(<UnitEconomicsPanel data={form({ currency: 'JPY', aovMinor: 5_000 })} onSave={onSave} />);
    fireEvent.change(aovField(), { target: { value: '5000' } });
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aovMinor: 5_000 }));
  });

  it.each(['USD', 'EGP'])('%s (2 digits): unchanged', (code) => {
    const onSave = vi.fn();
    render(<UnitEconomicsPanel data={form({ currency: code, aovMinor: 5_000 })} onSave={onSave} />);
    fireEvent.change(aovField(), { target: { value: '50' } });
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aovMinor: 5_000 }));
  });
});

// ── THE CLOSURE CONDITION ───────────────────────────────────────────────────
// "The value shown to the operator is the value that returns as the minor
// representation, at that currency's exponent." Asserted end to end: read the
// stored minor units, submit the form untouched, get the SAME minor units back.
describe('round trip — display and save agree at every exponent', () => {
  it.each([
    ['KWD', 50_000, '50'],
    ['BHD', 1_500, '1.5'],
    ['OMR', 2_250, '2.25'],
    ['JOD', 99_000, '99'],
    ['JPY', 5_000, '5000'],
    ['USD', 5_000, '50'],
    ['EGP', 424_207, '4242.07'],
  ])('%s: %i minor units render as %s and return unchanged', (currency, aovMinor, shown) => {
    const onSave = vi.fn();
    render(<UnitEconomicsPanel data={form({ currency, aovMinor })} onSave={onSave} />);
    expect(aovField()).toHaveValue(shown);
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aovMinor }));
  });
});

// A minor-unit amount without its currency is not a number, it is a guess. The
// only writer of AccountEconomics is this form, and the row is CREATED with the
// column default 'USD' when the payload omits currency — so a KWD account that
// saves 50 dinars would read back 500 on the very next refetch. The save must
// carry the denomination it just converted in.
describe('the write carries its denomination', () => {
  it.each(['KWD', 'JPY', 'EGP'])('%s travels with the amount', (currency) => {
    const onSave = vi.fn();
    render(<UnitEconomicsPanel data={form({ currency, aovMinor: 5_000 })} onSave={onSave} />);
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ currency }));
  });
});

// The non-money inputs are not part of this slice and must come through intact.
describe('the rest of the assertion is unchanged', () => {
  it('margin is still a ratio, orders and target still pass through', () => {
    const onSave = vi.fn();
    render(<UnitEconomicsPanel data={form({ grossMarginPct: 0.45, avgOrdersPerCustomer: 2.5, targetLtvToCac: 4 })} onSave={onSave} />);
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      grossMarginPct: 0.45, avgOrdersPerCustomer: 2.5, targetLtvToCac: 4,
    }));
  });

  it('an invalid AOV still saves nothing', () => {
    const onSave = vi.fn();
    render(<UnitEconomicsPanel data={form({ currency: 'KWD' })} onSave={onSave} />);
    fireEvent.change(aovField(), { target: { value: '' } });
    save();
    expect(onSave).not.toHaveBeenCalled();
  });
});

// The read-only verdict figures were fixed once already. This is the regression
// guard that keeps them fixed while the form catches up.
describe('the read-only verdict figures stay currency-aware', () => {
  const assessed = {
    workspaceId: 'ws-1',
    economics: economics({ currency: 'KWD', aovMinor: 50_000 }),
    isDefault: false,
    currentCac: { currentBlendedCacMinor: 12_000, totalSpendMinor: 1, totalConversions: 1, currency: 'KWD' },
    assessment: {
      contributionPerOrderMinor: 30_000,
      ltvMinor: 150_000,
      paybackOrders: 2,
      ltvToCac: { low: 8, expected: 12, high: 15 },
      sustainabilityBand: { low: 'THIN', expected: 'HEALTHY', high: 'HEALTHY' },
      sustainable: true,
      assumptions: [],
      currency: 'KWD',
    },
    reason: null,
  };

  it('LTV, contribution and CAC all format through the canonical table', () => {
    const { container } = render(<UnitEconomicsPanel data={assessed} onSave={vi.fn()} />);
    expect(container.textContent).toContain(formatCurrency(150_000, 'KWD'));
    expect(container.textContent).toContain(formatCurrency(30_000, 'KWD'));
    expect(container.textContent).toContain(formatCurrency(12_000, 'KWD'));
  });
});
