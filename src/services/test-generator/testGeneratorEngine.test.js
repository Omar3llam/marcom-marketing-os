// ============================================================
// TestGeneratorEngine — unit tests
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateAgenda }   from './testGeneratorEngine.js';
import { TEST_DIMENSION }    from './testGeneratorTypes.js';

// A weak-hook entity: low CTR, modest spend.
function weakHook(id, { spendMinor = 5_000_00, ctr = 0.6 } = {}) {
  return {
    entityId: id, name: id, level: 'CAMPAIGN', currency: 'USD',
    metrics: { ctr, roas: 1.2, frequency: 1.5, cpa: 40, conversions: 20, spendMinor },
  };
}

describe('generateAgenda — dimension gating', () => {
  it('puts HOOK at the top for a weak-CTR entity', () => {
    const agenda = generateAgenda({ entities: [weakHook('camp-1')] });
    expect(agenda.length).toBeGreaterThan(0);
    expect(agenda[0].dimension).toBe(TEST_DIMENSION.HOOK);
    expect(agenda[0].metric).toBe('CTR');
  });

  it('every suggestion carries a hypothesis and an expected signal', () => {
    const agenda = generateAgenda({ entities: [weakHook('camp-1')] });
    for (const s of agenda) {
      expect(s.hypothesis).toBeTruthy();
      expect(s.expectedSignal).toBeTruthy();
      expect(Array.isArray(s.variants)).toBe(true);
      expect(s.variants.some((v) => v.isControl)).toBe(true);
    }
  });

  it('returns an empty agenda for a healthy entity (no triggers)', () => {
    const healthy = {
      entityId: 'good', name: 'good', level: 'CAMPAIGN', currency: 'USD',
      metrics: { ctr: 3.0, roas: 4.5, frequency: 1.2, cpa: 12, conversions: 80, spendMinor: 9_000_00 },
    };
    expect(generateAgenda({ entities: [healthy] })).toEqual([]);
  });

  it('suggests OFFER when CTR is healthy but ROAS is weak (traffic, no return)', () => {
    const ent = {
      entityId: 'offer-1', name: 'offer-1', level: 'CAMPAIGN', currency: 'USD',
      metrics: { ctr: 2.2, roas: 1.0, frequency: 1.6, cpa: 55, conversions: 10, spendMinor: 4_000_00 },
    };
    const agenda = generateAgenda({ entities: [ent] });
    expect(agenda.some((s) => s.dimension === TEST_DIMENSION.OFFER)).toBe(true);
  });

  it('suggests AUDIENCE when frequency is saturated', () => {
    const ent = {
      entityId: 'sat-1', name: 'sat-1', level: 'ADSET', currency: 'USD',
      metrics: { ctr: 1.8, roas: 2.5, frequency: 4.5, cpa: 30, conversions: 25, spendMinor: 6_000_00 },
    };
    const agenda = generateAgenda({ entities: [ent] });
    expect(agenda.some((s) => s.dimension === TEST_DIMENSION.AUDIENCE)).toBe(true);
  });
});

describe('generateAgenda — spend weighting', () => {
  it('ranks the higher-spend entity above an identical low-spend one', () => {
    const big   = weakHook('big',   { spendMinor: 50_000_00 });
    const small = weakHook('small', { spendMinor: 1_000_00 });
    const agenda = generateAgenda({ entities: [small, big] });
    const bigHook   = agenda.find((s) => s.entityId === 'big'   && s.dimension === TEST_DIMENSION.HOOK);
    const smallHook = agenda.find((s) => s.entityId === 'small' && s.dimension === TEST_DIMENSION.HOOK);
    expect(bigHook.priority).toBeGreaterThan(smallHook.priority);
  });
});

describe('generateAgenda — memory feedback (loop closure)', () => {
  it('demotes a HOOK suggestion when a prior HOOK test on that entity was unsustainable', () => {
    const ent = weakHook('camp-1');

    const before = generateAgenda({ entities: [ent] });
    const beforeHook = before.find((s) => s.dimension === TEST_DIMENSION.HOOK);

    const after = generateAgenda({
      entities: [ent],
      memory: [{ entityId: 'camp-1', dimension: TEST_DIMENSION.HOOK, outcome: 'no_change', isSustainable: false }],
    });
    const afterHook = after.find((s) => s.dimension === TEST_DIMENSION.HOOK);

    expect(afterHook.priority).toBeLessThan(beforeHook.priority);
  });

  it('is deterministic — same input yields identical output', () => {
    const ents = [weakHook('a'), weakHook('b', { spendMinor: 8_000_00 })];
    expect(generateAgenda({ entities: ents })).toEqual(generateAgenda({ entities: ents }));
  });
});
