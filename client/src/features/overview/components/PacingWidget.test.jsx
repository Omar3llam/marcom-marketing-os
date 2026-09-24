// ============================================================
// PacingWidget — the burn rate is denominated in the ACCOUNT'S currency
// ------------------------------------------------------------
// This widget's header used to instruct: "Money is integer minor units; divide
// by 100 before formatting." That is true of most currencies and false of the
// ones this product already declares: `lib/money.ts` records KWD, BHD, OMR and
// JOD at THREE minor digits and JPY at ZERO. A hardcoded 100 therefore
// overstates a Gulf-dinar account TENFOLD and understates a yen account by a
// HUNDRED — on the one surface whose entire job is telling an operator whether
// they are burning budget too fast.
//
// PARITY-01 fixed exactly this defect on the account aggregate. It never swept
// here. The rule that closes it:
//
//   Never assume a 2-digit currency exponent. Minor-unit conversion must come
//   from the canonical currency table.
//
// The assertions compare against `formatCurrencyWhole(<hand-computed major>)`,
// never against digit strings: the Gulf locales render Arabic-Indic numerals,
// and the point under test is the VALUE, not the glyphs. Each currency case
// also asserts the 2-exponent answer is ABSENT, so a test that merely rendered
// something could not pass.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatCurrencyWhole } from '@/lib/currencyFormatter.js';

const seam = vi.hoisted(() => ({
  portfolio: { data: null, loading: false, error: null },
  workspace: { workspace: { currency: 'USD' } },
  role: { role: 'STRATEGIST', loading: false },
}));

vi.mock('@/hooks/usePortfolio.js', () => ({ usePortfolio: () => seam.portfolio }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => seam.workspace }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => seam.role,
  WORKSPACE_ROLE: { CLIENT: 'CLIENT', BUYER: 'BUYER', STRATEGIST: 'STRATEGIST' },
}));

import PacingWidget from './PacingWidget.jsx';

// Two connected channels and a committed budget — the widget's honest gates all
// open, so what remains on screen is the money.
const portfolio = ({ projectedSpendMinor, budgetMinor, runRateMinor }, currency = 'USD') => ({
  data: {
    channels: [{ channel: 'meta' }, { channel: 'google' }],
    monthlyBudgetMinor: budgetMinor,
    monthlyBudgetCurrency: currency,
    pacingMonetaryStatus: 'MONETARY_VALID',
    spendPeriod: { currency, status: 'MEASURABLE' },
    pacing: { projectedSpendMinor, runRateMinor, status: 'OVER', daysEarly: 4 },
  },
  loading: false,
  error: null,
});

const renderAt = (currency, amounts) => {
  seam.portfolio = portfolio(amounts, currency);
  seam.workspace = { workspace: { currency } };
  return render(<MemoryRouter><PacingWidget /></MemoryRouter>).container.textContent;
};

beforeEach(() => {
  seam.role = { role: 'STRATEGIST', loading: false };
});

describe('the currency exponent comes from the canonical table', () => {
  // KWD is 3 minor digits. 12,000,000 fils is 12,000 dinars — not 120,000.
  it('KWD (3 digits): renders dinars, not the tenfold overstatement', () => {
    const text = renderAt('KWD', {
      projectedSpendMinor: 12_000_000,
      budgetMinor: 20_000_000,
      runRateMinor: 400_000,
    });
    expect(text).toContain(formatCurrencyWhole(12_000, 'KWD'));
    expect(text).toContain(formatCurrencyWhole(20_000, 'KWD'));
    expect(text).toContain(formatCurrencyWhole(400, 'KWD'));
  });

  it('KWD (3 digits): the 2-exponent figures appear nowhere', () => {
    const text = renderAt('KWD', {
      projectedSpendMinor: 12_000_000,
      budgetMinor: 20_000_000,
      runRateMinor: 400_000,
    });
    expect(text).not.toContain(formatCurrencyWhole(120_000, 'KWD'));
    expect(text).not.toContain(formatCurrencyWhole(200_000, 'KWD'));
    expect(text).not.toContain(formatCurrencyWhole(4_000, 'KWD'));
  });

  // The other three Gulf dinars share KWD's exponent and must share its answer.
  it.each(['BHD', 'OMR', 'JOD'])('%s (3 digits): same table, same answer', (code) => {
    const text = renderAt(code, {
      projectedSpendMinor: 12_000_000,
      budgetMinor: 20_000_000,
      runRateMinor: 400_000,
    });
    expect(text).toContain(formatCurrencyWhole(12_000, code));
    expect(text).not.toContain(formatCurrencyWhole(120_000, code));
  });

  // JPY is 0 minor digits: the minor unit IS the yen. Dividing understates 100x.
  it('JPY (0 digits): renders yen, not the hundredfold understatement', () => {
    const text = renderAt('JPY', {
      projectedSpendMinor: 500_000,
      budgetMinor: 900_000,
      runRateMinor: 30_000,
    });
    expect(text).toContain(formatCurrencyWhole(500_000, 'JPY'));
    expect(text).toContain(formatCurrencyWhole(900_000, 'JPY'));
    expect(text).toContain(formatCurrencyWhole(30_000, 'JPY'));
    expect(text).not.toContain(formatCurrencyWhole(5_000, 'JPY'));
  });

  // The 2-digit majority must be untouched — this fix may not move USD or EGP.
  it.each(['USD', 'EGP', 'SAR', 'AED'])('%s (2 digits): unchanged', (code) => {
    const text = renderAt(code, {
      projectedSpendMinor: 250_000,
      budgetMinor: 400_000,
      runRateMinor: 8_000,
    });
    expect(text).toContain(formatCurrencyWhole(2_500, code));
    expect(text).toContain(formatCurrencyWhole(4_000, code));
    expect(text).toContain(formatCurrencyWhole(80, code));
  });

  it('an unknown currency code withholds pacing money', () => {
    const text = renderAt('XYZ', {
      projectedSpendMinor: 250_000,
      budgetMinor: 400_000,
      runRateMinor: 8_000,
    });
    expect(text).toMatch(/currency basis is unverified/);
    expect(text).not.toMatch(/Projected|Run rate|Over budget/);
  });

  it('a missing workspace currency withholds pacing money', () => {
    seam.portfolio = portfolio({ projectedSpendMinor: 250_000, budgetMinor: 400_000, runRateMinor: 8_000 });
    seam.workspace = { workspace: null };
    const { container } = render(<MemoryRouter><PacingWidget /></MemoryRouter>);
    expect(container.textContent).toMatch(/currency basis is unverified/);
    expect(container.textContent).not.toContain(formatCurrencyWhole(2_500, 'USD'));
  });

  it('a failed workspace read is an error, never an empty budget or USD', () => {
    seam.portfolio = portfolio({ projectedSpendMinor: 250_000, budgetMinor: 400_000, runRateMinor: 8_000 });
    seam.workspace = { workspace: null, error: 'Failed to load workspace', status: 'NOT_REACHABLE' };
    const { container } = render(<MemoryRouter><PacingWidget /></MemoryRouter>);
    expect(container.textContent).toMatch(/Couldn't read workspace currency/);
    expect(container.textContent).not.toMatch(/Set a monthly budget|Projected/);
  });

  it('a valid workspace cannot relabel a different budget currency', () => {
    seam.portfolio = portfolio({ projectedSpendMinor: 250_000, budgetMinor: 400_000, runRateMinor: 8_000 }, 'USD');
    seam.workspace = { workspace: { currency: 'EGP' } };
    const { container } = render(<MemoryRouter><PacingWidget /></MemoryRouter>);
    expect(container.textContent).toMatch(/currency basis is unverified/);
    expect(container.textContent).not.toMatch(/Projected|Over budget/);
  });

  it('a backend monetary refusal withholds pacing money', () => {
    seam.portfolio = portfolio({ projectedSpendMinor: 250_000, budgetMinor: 400_000, runRateMinor: 8_000 });
    seam.portfolio.data.pacingMonetaryStatus = 'MONETARY_UNAVAILABLE_MIXED';
    seam.workspace = { workspace: { currency: 'USD' } };
    const { container } = render(<MemoryRouter><PacingWidget /></MemoryRouter>);
    expect(container.textContent).toMatch(/currency basis is unverified/);
    expect(container.textContent).not.toMatch(/Projected|Over budget/);
  });
});

// A test that asserts "X is present and Y is absent" proves nothing if X and Y
// are the same string. They are not, at either exponent.
describe('control — the assertions can fail', () => {
  it('the 3-digit and 2-digit answers are different strings', () => {
    expect(formatCurrencyWhole(12_000, 'KWD')).not.toBe(formatCurrencyWhole(120_000, 'KWD'));
    expect(formatCurrencyWhole(500_000, 'JPY')).not.toBe(formatCurrencyWhole(5_000, 'JPY'));
  });
});

// The honest gates are the reason these numbers are trustworthy at all; a
// currency fix that quietly opened one would be a worse defect than the one it
// closed.
describe('the honest gates are untouched', () => {
  it('a CLIENT still sees no budget figures', () => {
    seam.role = { role: 'CLIENT', loading: false };
    seam.portfolio = portfolio({ projectedSpendMinor: 12_000_000, budgetMinor: 20_000_000, runRateMinor: 400_000 });
    seam.workspace = { workspace: { currency: 'KWD' } };
    const { container } = render(<MemoryRouter><PacingWidget /></MemoryRouter>);
    expect(container.textContent).toBe('');
  });

  it('one channel still refuses to show a burn rate', () => {
    seam.portfolio = {
      data: { channels: [{ channel: 'meta' }], monthlyBudgetMinor: 20_000_000, pacing: { projectedSpendMinor: 1, runRateMinor: 1, status: 'OVER' } },
      loading: false,
      error: null,
    };
    seam.workspace = { workspace: { currency: 'KWD' } };
    const { container } = render(<MemoryRouter><PacingWidget /></MemoryRouter>);
    expect(container.textContent).toMatch(/Connect a second channel/);
  });

  it('no committed budget still points at Reallocate Capital', () => {
    seam.portfolio = {
      data: { channels: [{ channel: 'meta' }, { channel: 'google' }], monthlyBudgetMinor: null, pacing: null },
      loading: false,
      error: null,
    };
    seam.workspace = { workspace: { currency: 'KWD' } };
    const { container } = render(<MemoryRouter><PacingWidget /></MemoryRouter>);
    expect(container.textContent).toMatch(/Set a monthly budget/);
  });

  it('no pacing still says so rather than projecting zero', () => {
    seam.portfolio = {
      data: { channels: [{ channel: 'meta' }, { channel: 'google' }], monthlyBudgetMinor: 20_000_000, pacing: null },
      loading: false,
      error: null,
    };
    seam.workspace = { workspace: { currency: 'KWD' } };
    const { container } = render(<MemoryRouter><PacingWidget /></MemoryRouter>);
    expect(container.textContent).toMatch(/Not enough data to project pacing yet/);
  });
});
