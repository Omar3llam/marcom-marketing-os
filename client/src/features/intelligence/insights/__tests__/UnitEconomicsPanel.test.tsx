// ============================================================
// Phase 4-D — Unit Economics: honest states + the CAC naming seam
// ------------------------------------------------------------
// Pure-component assertions (no network): nothing is shown as a measurement
// until the user has ASSERTED their economics; the verdict labels its CAC as
// the CURRENT realized one (never a plan projection); the form converts inputs
// to the contract shape. The contract seam safeParses a representative row.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnitEconomicsPanel } from '../UnitEconomicsPanel.jsx';
import { EconomicsAssessmentSchema } from '@/contracts/schemas/unitEconomics.schema';

const defaultEcon = { workspaceId: 'ws', currency: 'USD', aovMinor: 5000, grossMarginPct: 0.5, repeatRate: 0, avgOrdersPerCustomer: 1, targetLtvToCac: 3 };
const assertedEcon = { ...defaultEcon, aovMinor: 10000, grossMarginPct: 0.6, avgOrdersPerCustomer: 2 };
const cac = { currentBlendedCacMinor: 2000, totalSpendMinor: 100000, totalConversions: 50, currency: 'USD' };

const NOT_CONFIGURED = { workspaceId: 'ws', economics: defaultEcon, isDefault: true, currentCac: cac, assessment: null, reason: 'NOT_CONFIGURED' };
const NO_CONVERSIONS = { workspaceId: 'ws', economics: assertedEcon, isDefault: false, currentCac: { ...cac, currentBlendedCacMinor: null, totalConversions: 0 }, assessment: null, reason: 'NO_CONVERSIONS' };
const HEALTHY = {
  workspaceId: 'ws', economics: assertedEcon, isDefault: false, currentCac: cac, reason: null,
  assessment: {
    contributionPerOrderMinor: 6000, ltvMinor: 12000, paybackOrders: 1,
    ltvToCac: { low: 5, expected: 6, high: 7 },
    sustainabilityBand: { low: 'HEALTHY', expected: 'HEALTHY', high: 'HEALTHY' },
    sustainable: true,
    assumptions: ['contribution margin = AOV × 60% gross margin', 'target LTV:CAC = 3'],
    currency: 'USD',
  },
};

describe('UnitEconomicsPanel — honest states', () => {
  it('NOT_CONFIGURED shows the assertion form, not a verdict', () => {
    render(<UnitEconomicsPanel data={NOT_CONFIGURED} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: /save economics/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/average order value/i)).toBeInTheDocument();
    expect(screen.queryByText(/realized CAC, not a plan projection/i)).not.toBeInTheDocument();
  });

  it('NO_CONVERSIONS is honest-empty (economics set, no realized CAC yet)', () => {
    render(<UnitEconomicsPanel data={NO_CONVERSIONS} onSave={vi.fn()} />);
    expect(screen.getByText(/No realized CAC yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/^LTV:CAC/)).not.toBeInTheDocument();
  });

  it('renders the verdict with the CAC labelled as current/realized (not a projection)', () => {
    render(<UnitEconomicsPanel data={HEALTHY} onSave={vi.fn()} />);
    expect(screen.getByText(/6×/)).toBeInTheDocument();
    expect(screen.getByText('HEALTHY')).toBeInTheDocument();
    expect(screen.getByText(/realized CAC, not a plan projection/i)).toBeInTheDocument();
    expect(screen.getByText(/contribution margin = AOV × 60%/i)).toBeInTheDocument();
    expect(screen.getByText(/1 order/)).toBeInTheDocument();
  });

  it('loading and error states are honest', () => {
    const { rerender } = render(<UnitEconomicsPanel loading />);
    expect(screen.getByText(/Loading unit economics/i)).toBeInTheDocument();
    rerender(<UnitEconomicsPanel error={new Error('x')} />);
    expect(screen.getByText(/Couldn’t load unit economics/i)).toBeInTheDocument();
  });
});

describe('UnitEconomicsPanel — the form asserts real inputs in the contract shape', () => {
  it('converts AOV (major→minor) and margin (%→ratio) on save', () => {
    const onSave = vi.fn();
    render(<UnitEconomicsPanel data={NOT_CONFIGURED} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/average order value/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/gross margin percent/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /save economics/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aovMinor: 10000, grossMarginPct: 0.6 }));
  });
});

describe('contract seam — EconomicsAssessmentSchema safeParses the fixtures', () => {
  it('validates the configured/healthy assessment', () => {
    expect(EconomicsAssessmentSchema.safeParse(HEALTHY).success).toBe(true);
  });
  it('validates the not-configured row', () => {
    expect(EconomicsAssessmentSchema.safeParse(NOT_CONFIGURED).success).toBe(true);
  });
});
