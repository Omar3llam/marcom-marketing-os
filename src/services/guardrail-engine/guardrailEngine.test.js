// ============================================================
// GuardrailEngine — unit tests
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { evaluateGuardrails } from './guardrailEngine.js';

// "flag any cold ad set above CPA target +50% for 2 days"
const COLD_CPA_RULE = {
  id: 'rule-1', name: 'Cold CPA breach', enabled: true,
  scopeLevel: 'ADSET', audienceTag: 'cold',
  metric: 'cpaOverTargetPct', comparator: 'GTE', threshold: 50, unit: 'PCT',
  sustainedDays: 2, emitVerdict: 'KILL',
};

function entity(id, { level = 'ADSET', audienceTag = 'cold', values }) {
  // values: array of daily cpaOverTargetPct
  return {
    entityId: id, entityLevel: level, audienceTag,
    series: values.map((v, i) => ({ date: `2026-05-0${i + 1}`, values: { cpaOverTargetPct: v } })),
  };
}

describe('evaluateGuardrails — validation', () => {
  it('throws when rules is not an array', () => {
    expect(() => evaluateGuardrails({ rules: {}, entities: [] })).toThrow('rules must be an array');
  });
  it('throws on bad comparator', () => {
    expect(() => evaluateGuardrails({ rules: [{ metric: 'x', comparator: 'EQ', threshold: 1 }], entities: [] }))
      .toThrow('comparator invalid');
  });
});

describe('evaluateGuardrails — sustained-window semantics', () => {
  it('fires only after the condition holds for sustainedDays', () => {
    const breaching = entity('adset-A', { values: [60, 70] });   // both days ≥50 → hit
    const { hits } = evaluateGuardrails({ rules: [COLD_CPA_RULE], entities: [breaching] });
    expect(hits).toHaveLength(1);
    expect(hits[0].verdict).toBe('KILL');
    expect(hits[0].entityId).toBe('adset-A');
    expect(hits[0].rationale).toContain('cpaOverTargetPct');
  });

  it('does NOT fire when only the latest day breaches (not sustained)', () => {
    const oneDay = entity('adset-B', { values: [10, 70] }); // only last day ≥50
    const { hits } = evaluateGuardrails({ rules: [COLD_CPA_RULE], entities: [oneDay] });
    expect(hits).toHaveLength(0);
  });

  it('does NOT fire with insufficient history', () => {
    const short = entity('adset-C', { values: [80] }); // only 1 day, need 2
    const { hits } = evaluateGuardrails({ rules: [COLD_CPA_RULE], entities: [short] });
    expect(hits).toHaveLength(0);
  });

  it('respects audienceTag scope (warm ad set ignored)', () => {
    const warm = entity('adset-D', { audienceTag: 'warm', values: [90, 90] });
    const { hits } = evaluateGuardrails({ rules: [COLD_CPA_RULE], entities: [warm] });
    expect(hits).toHaveLength(0);
  });

  it('respects scopeLevel (campaign ignored for an ADSET rule)', () => {
    const camp = entity('camp-1', { level: 'CAMPAIGN', values: [90, 90] });
    const { hits } = evaluateGuardrails({ rules: [COLD_CPA_RULE], entities: [camp] });
    expect(hits).toHaveLength(0);
  });

  it('skips disabled rules', () => {
    const breaching = entity('adset-A', { values: [60, 70] });
    const { hits } = evaluateGuardrails({ rules: [{ ...COLD_CPA_RULE, enabled: false }], entities: [breaching] });
    expect(hits).toHaveLength(0);
  });

  it('supports LT comparator (e.g. ROAS below floor)', () => {
    const rule = { id: 'r2', name: 'ROAS floor', scopeLevel: 'ADSET', metric: 'roas', comparator: 'LT', threshold: 1, unit: 'RATIO', sustainedDays: 1, emitVerdict: 'WATCH' };
    const ent = { entityId: 'adset-E', entityLevel: 'ADSET', series: [{ date: '2026-05-01', values: { roas: 0.6 } }] };
    const { hits } = evaluateGuardrails({ rules: [rule], entities: [ent] });
    expect(hits).toHaveLength(1);
    expect(hits[0].verdict).toBe('WATCH');
  });
});

// ============================================================
// C-02 — what the pass ACTUALLY JUDGED
// ============================================================
// A guardrail hit is a breach episode, and only a pass that looked may end one.
// These tests pin the boundary between "we looked and it was clean" (CLEAR, which
// closes an episode) and "we did not look" (absent, which must not). Every case
// below that expects absence is a case where treating silence as an all-clear
// would close a real breach the sweep never re-examined.
describe('evaluateGuardrails — the evaluated set', () => {
  const pair = (e) => ({ ruleId: e.ruleId, entityId: e.entityId, outcome: e.outcome });

  it('reports a breach as BREACH, keyed by the STABLE rule id', () => {
    const { hits, evaluated } = evaluateGuardrails({
      rules: [COLD_CPA_RULE], entities: [entity('adset-A', { values: [60, 70] })],
    });
    expect(hits).toHaveLength(1);
    expect(evaluated.map(pair)).toEqual([
      { ruleId: 'rule-1', entityId: 'adset-A', outcome: 'BREACH' },
    ]);
  });

  it('reports an in-scope entity that declined as CLEAR — this is what closes an episode', () => {
    const { hits, evaluated } = evaluateGuardrails({
      rules: [COLD_CPA_RULE], entities: [entity('adset-B', { values: [10, 12] })],
    });
    expect(hits).toHaveLength(0);
    expect(evaluated.map(pair)).toEqual([
      { ruleId: 'rule-1', entityId: 'adset-B', outcome: 'CLEAR' },
    ]);
  });

  it('a DISABLED rule judges nothing — turning a rule off must not close its breaches', () => {
    const { evaluated } = evaluateGuardrails({
      rules: [{ ...COLD_CPA_RULE, enabled: false }],
      entities: [entity('adset-A', { values: [60, 70] })],
    });
    expect(evaluated).toEqual([]);
  });

  it('too little history judges nothing — insufficient data is not an all-clear', () => {
    // One day against sustainedDays: 2. The breach may well be continuing; we
    // simply stopped receiving enough of the series to say either way.
    const { hits, evaluated } = evaluateGuardrails({
      rules: [COLD_CPA_RULE], entities: [entity('adset-C', { values: [80] })],
    });
    expect(hits).toHaveLength(0);
    expect(evaluated).toEqual([]);
  });

  it('an entity absent from the window judges nothing', () => {
    const { evaluated } = evaluateGuardrails({ rules: [COLD_CPA_RULE], entities: [] });
    expect(evaluated).toEqual([]);
  });

  it('out-of-scope entities judge nothing (level and audience alike)', () => {
    const { evaluated } = evaluateGuardrails({
      rules: [COLD_CPA_RULE],
      entities: [
        entity('camp-1',  { level: 'CAMPAIGN', values: [90, 90] }),
        entity('adset-D', { audienceTag: 'warm', values: [90, 90] }),
      ],
    });
    expect(evaluated).toEqual([]);
  });

  it('two rules over one entity judge it independently', () => {
    const roasFloor = {
      id: 'rule-2', name: 'ROAS floor', enabled: true, scopeLevel: 'ADSET', audienceTag: 'cold',
      metric: 'cpaOverTargetPct', comparator: 'LT', threshold: 5, unit: 'PCT',
      sustainedDays: 2, emitVerdict: 'WATCH',
    };
    const { evaluated } = evaluateGuardrails({
      rules: [COLD_CPA_RULE, roasFloor], entities: [entity('adset-A', { values: [60, 70] })],
    });
    // Same entity, one breach and one all-clear — two episodes, not one.
    expect(evaluated.map(pair)).toEqual([
      { ruleId: 'rule-1', entityId: 'adset-A', outcome: 'BREACH' },
      { ruleId: 'rule-2', entityId: 'adset-A', outcome: 'CLEAR' },
    ]);
  });
});
