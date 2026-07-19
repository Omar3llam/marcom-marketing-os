// ============================================================
// ScenarioService.withEconomicsStatus — honest empty state when
// unit economics is unconfigured
// ------------------------------------------------------------
// GOVERNING LAW: a projection derived from the seeded DEFAULT AOV/margin is
// never dressed as a measurement. When economics is unconfigured (isDefault),
// the volume-derived projections (volume, blendedCacMinor, grossProfitMinor)
// are blanked to honest null ranges (→ "—") + an explicit assumption, while the
// spend/ROAS-based projections (revenueMinor, merAfter) are always preserved.
// Pure helper → tested without a DB (mirrors buildScenarioInputs).
// ============================================================
import { describe, it, expect } from 'vitest';
import { withEconomicsStatus } from './ScenarioService.js';

const NULL_RANGE = { low: null, expected: null, high: null };

// A representative projectScenario() output (all ranges finite).
const baseScenario = () => ({
  scenarioType: 'BUDGET_EXPANSION',
  change: { type: 'BUDGET_EXPANSION', deltaPct: 0.2 },
  currency: 'USD',
  projections: {
    blendedCacMinor:  { low: 1800,   expected: 2000,   high: 2200 },
    volume:           { low: 90,     expected: 100,    high: 110 },
    revenueMinor:     { low: 450000, expected: 500000, high: 550000 },
    grossProfitMinor: { low: 225000, expected: 250000, high: 275000 },
    merAfter:         { low: 2.1,    expected: 2.5,    high: 2.9 },
  },
  assumptions: ['expected: added budget retains 85% of marginal efficiency'],
  confidence: 0.6,
  basis: 'BUDGET_EXPANSION: projected as a range under 3 retention assumptions',
});

describe('withEconomicsStatus — economics NOT configured (isDefault=true)', () => {
  it('blanks the AOV/margin-derived projections to null ranges', () => {
    const out = withEconomicsStatus(baseScenario(), true);
    expect(out.projections.volume).toEqual(NULL_RANGE);
    expect(out.projections.blendedCacMinor).toEqual(NULL_RANGE);
    expect(out.projections.grossProfitMinor).toEqual(NULL_RANGE);
  });

  it('preserves the spend/ROAS-based projections (revenue, MER)', () => {
    const out = withEconomicsStatus(baseScenario(), true);
    expect(out.projections.revenueMinor).toEqual({ low: 450000, expected: 500000, high: 550000 });
    expect(out.projections.merAfter).toEqual({ low: 2.1, expected: 2.5, high: 2.9 });
  });

  it('stamps economicsStatus = NOT_CONFIGURED', () => {
    expect(withEconomicsStatus(baseScenario(), true).economicsStatus).toBe('NOT_CONFIGURED');
  });

  it('appends an assumption explaining the default AOV was intentionally not used', () => {
    const out = withEconomicsStatus(baseScenario(), true);
    expect(out.assumptions).toContain('expected: added budget retains 85% of marginal efficiency'); // original kept
    expect(out.assumptions.some((a) => /intentionally not used/i.test(a))).toBe(true);
  });

  it('does not mutate the input scenario (pure)', () => {
    const input = baseScenario();
    withEconomicsStatus(input, true);
    expect(input.projections.volume).toEqual({ low: 90, expected: 100, high: 110 });
    expect(input.assumptions).toHaveLength(1);
    expect('economicsStatus' in input).toBe(false);
  });
});

describe('withEconomicsStatus — economics configured (isDefault=false)', () => {
  it('leaves every projection untouched', () => {
    const out = withEconomicsStatus(baseScenario(), false);
    expect(out.projections).toEqual(baseScenario().projections);
  });

  it('stamps economicsStatus = CONFIGURED and adds no assumption', () => {
    const out = withEconomicsStatus(baseScenario(), false);
    expect(out.economicsStatus).toBe('CONFIGURED');
    expect(out.assumptions).toHaveLength(1);
  });
});
