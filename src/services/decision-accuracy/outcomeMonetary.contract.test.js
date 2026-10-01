import { describe, it, expect } from 'vitest';
import { toOutcomeSection } from '../../routes/lumi/executions.js';
import { buildNarrativeInputs } from '../narrative-engine/NarrativeService.js';
import { composeNarrative } from '../narrative-engine/narrativeEngine.js';
import { validateOutcomeBody, buildAccuracyInputs } from './DecisionAccuracyService.js';
import { projectOutcomeSnapshot } from './outcomeProjection.js';
import { calculateDecisionAccuracy } from './decisionAccuracyEngine.js';
import { buildPatternInputs } from '../pattern-engine/PatternService.js';

const monetary = {
  status: 'INSUFFICIENT_EVIDENCE', reason: 'OUTCOME_MONETARY_BASIS_UNPROVEN',
  knowledge: 'NOT_ENOUGH', spendDeltaMinor: null, revenueDeltaMinor: null, currency: null,
};
const row = {
  id: 'outcome-1', createdAt: new Date('2026-08-12'), measuredAt: new Date('2026-08-10'),
  windowStart: new Date('2026-08-01'), windowEnd: new Date('2026-08-08'),
  spendDeltaMinor: -987654, revenueDeltaMinor: 1234567, roasDelta: 0.4, sustained: true,
};

describe('SC-11 public Outcome monetary authority', () => {
  it.each([
    ['nonzero', -987654, 1234567], ['zero', 0, 0], ['unmeasured', null, null],
  ])('%s historical money is insufficient evidence, never an authoritative amount', (_label, spend, revenue) => {
    const section = toOutcomeSection({ ...row, spendDeltaMinor: spend, revenueDeltaMinor: revenue });
    expect(section.available).toBe(true);
    expect(section.monetary).toEqual(monetary);
    expect(section.deltas).toEqual({ spendMinor: null, revenueMinor: null, roas: 0.4 });
    expect(section).not.toHaveProperty('spendDeltaMinor');
    expect(section).not.toHaveProperty('revenueDeltaMinor');
  });

  it.each(['EGP', 'JPY', 'USD', null])('a contextual %s currency or adjacent evidence cannot authorize the same Outcome', (currency) => {
    const contextual = {
      ...row, currency, workspace: { currency }, campaign: { currency },
      evidenceReference: { currency, sources: ['META'] },
      monetary: { status: 'AVAILABLE', currency, spendDeltaMinor: row.spendDeltaMinor },
    };
    const section = toOutcomeSection(contextual);
    expect(section.monetary).toEqual(monetary);
    expect(section.deltas.spendMinor).toBeNull();
    expect(section.deltas.revenueMinor).toBeNull();
  });

  it.each([true, false, null])('withholding preserves sustained=%s and independently recorded facts', (sustained) => {
    const source = { ...row, sustained };
    const before = structuredClone(source);
    const section = toOutcomeSection(source);
    expect(section.sustained).toBe(sustained);
    expect(section.outcomeId).toBe(row.id);
    expect(section.measuredAt).toEqual(row.measuredAt);
    expect(section.recordedAt).toEqual(row.createdAt);
    expect(section.window).toEqual({ start: row.windowStart, end: row.windowEnd });
    expect(section.deltas.roas).toBe(row.roasDelta);
    expect(source).toEqual(before);
  });

  it('absent Outcome remains distinct from present Outcome with insufficient money', () => {
    expect(toOutcomeSection(null)).toEqual({ available: false });
    expect(toOutcomeSection(row).monetary).toEqual(monetary);
  });

  it('POST projection cannot expose extra raw fields or contextual currency and does not alter the row', () => {
    const source = {
      ...row, workspaceId: 'ws1', decisionId: 'd1', entityId: 'entity-1', entityLevel: 'CAMPAIGN',
      currency: 'USD', raw: { spendDeltaMinor: row.spendDeltaMinor },
      monetary: { status: 'AVAILABLE', currency: 'USD' },
    };
    const before = structuredClone(source);
    const projected = projectOutcomeSnapshot(source);
    expect(projected.monetary).toEqual(monetary);
    expect(projected.spendDeltaMinor).toBeNull();
    expect(projected.revenueDeltaMinor).toBeNull();
    expect(projected.currency).toBeNull();
    expect(projected.roasDelta).toBe(row.roasDelta);
    expect(projected).not.toHaveProperty('raw');
    expect(source).toEqual(before);
    expect(projectOutcomeSnapshot(null)).toBeNull();
  });

  it('the unitless human-reported ROAS input is validated independently of the monetary deltas', () => {
    const body = { ...row, windowStart: row.windowStart.toISOString(),
      windowEnd: row.windowEnd.toISOString(), measuredAt: row.measuredAt.toISOString() };
    expect(validateOutcomeBody(body)).toBeNull();
    expect(validateOutcomeBody({ ...body, spendDeltaMinor: 0, revenueDeltaMinor: 0 })).toBeNull();
    expect(toOutcomeSection({ ...row, spendDeltaMinor: 0, revenueDeltaMinor: 0 }).deltas.roas).toBe(0.4);
    expect(validateOutcomeBody({ ...body, roasDelta: Infinity })).toMatch(/roasDelta/);
    expect(toOutcomeSection({ ...row, roasDelta: null }).deltas.roas).toBeNull();
  });

  it('direct and narrative paths agree; composed claims cannot recover stored money', () => {
    const inputs = buildNarrativeInputs({
      decisions: [{ id: 'd1', verdict: 'KILL', entityId: 'entity-1', outcomes: [row] }],
      currency: 'USD',
    });
    const direct = toOutcomeSection(row).monetary;
    expect(direct).toEqual(monetary);
    expect(inputs.decisions[0]).toMatchObject({
      spendDeltaMinor: direct.spendDeltaMinor, revenueDeltaMinor: direct.revenueDeltaMinor,
      currency: direct.currency, monetaryReason: direct.reason,
      monetaryStatus: 'MONETARY_UNAVAILABLE_UNTRUSTED', outcomeId: row.id,
    });
    const narrative = composeNarrative({
      period: 'WEEKLY', audience: 'LEADERSHIP', periodStart: row.windowStart,
      periodEnd: row.windowEnd, ...inputs, currency: 'USD', now: row.createdAt,
    });
    expect(JSON.stringify(narrative)).not.toContain('987654');
    expect(JSON.stringify(narrative)).not.toContain('1234567');
    expect(narrative.sections.flatMap((s) => s.claims ?? []).flatMap((c) => c.figures ?? [])).toEqual([]);
  });

  it('Proof and learning use the reported direction internally without publishing monetary magnitudes', () => {
    const decision = {
      id: 'd1', entityId: 'entity-1', entityLevel: 'CAMPAIGN', verdict: 'KILL',
      confidence: 0.8, createdAt: new Date('2026-08-01'),
      humanExecutedAt: new Date('2026-08-01'), platformExecutedAt: null, dismissedAt: null,
      outcomes: [row],
    };
    const now = new Date('2026-09-01');
    const proof = calculateDecisionAccuracy({ decisions: buildAccuracyInputs([decision]), now });
    expect(proof.coverage.scored).toBe(1);
    const patternInputs = buildPatternInputs({
      decisions: [decision], outcomes: [{ ...row, decisionId: decision.id }], now,
    });
    expect(patternInputs.outcomes[0].success).toBe('SUCCESS');
    for (const publicInput of [proof, patternInputs]) {
      expect(JSON.stringify(publicInput)).not.toContain('987654');
      expect(JSON.stringify(publicInput)).not.toContain('1234567');
      expect(JSON.stringify(publicInput)).not.toContain('spendDeltaMinor');
      expect(JSON.stringify(publicInput)).not.toContain('revenueDeltaMinor');
    }
    // Changing positive unit scale preserves the sign predicate and public score.
    const scaled = { ...row, spendDeltaMinor: row.spendDeltaMinor * 100,
      revenueDeltaMinor: row.revenueDeltaMinor * 100 };
    expect(calculateDecisionAccuracy({
      decisions: buildAccuracyInputs([{ ...decision, outcomes: [scaled] }]), now,
    })).toEqual(proof);
  });
});
