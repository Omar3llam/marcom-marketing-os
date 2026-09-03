// ============================================================
// C-05 · promotionSnapshot — the belief is frozen BY VALUE
// ------------------------------------------------------------
// R-6 established that `AccountPattern` is upserted IN PLACE: the row that a
// promotion was authorized on is the same row a later extraction rewrites. So a
// provenance record that stores `patternId` and reads the pattern back does not
// answer "what did we believe when we granted this" — it answers "what do we
// believe now", wearing the first question's label.
//
// Every assertion here is that refusal, made mechanical.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  beliefSnapshot, grantedAutonomy, promotionSnapshot,
  PROMOTION_SUBJECT_TYPE, AUTONOMY_EVENT, GRANTED_AUTHORITY,
} from './promotionSnapshot.js';

const pattern = (over = {}) => ({
  id: 'pat-1', patternKey: 'freq-ceiling:cold:ADSET', kind: 'FATIGUE_THRESHOLD',
  statement: 'On cold adsets, KILL once frequency passes ~3.5', basis: '14 confirmed outcomes',
  status: 'ESTABLISHED', support: 14, effectiveSupport: 9.2, accuracy: 0.85, confidence: 0.81,
  metric: 'frequency', scopeLevel: 'ADSET', audienceTag: 'cold', comparator: 'GTE',
  threshold: 3.5, unit: 'RATIO', emitVerdict: 'KILL', sustainedDays: 1, promotedRuleId: null,
  firstObservedAt: new Date('2026-06-01T00:00:00Z'),
  lastObservedAt:  new Date('2026-08-30T00:00:00Z'),
  ...over,
});

const rule = (over = {}) => ({
  id: 'rule-1', name: 'Learned: On cold adsets, KILL once frequency passes ~3.5',
  metric: 'frequency', comparator: 'GTE', threshold: 3.5, unit: 'RATIO',
  scopeLevel: 'ADSET', audienceTag: 'cold', sustainedDays: 1, emitVerdict: 'KILL',
  ...over,
});

const gate = (over = {}) => ({
  minAccuracyApplied: 0.6, requestId: 'req-1', requestedById: 'user-a', approvedById: 'user-a',
  selfApproved: true, requestedAt: new Date('2026-09-03T10:00:00Z'),
  decidedAt: new Date('2026-09-03T10:05:00Z'), ...over,
});

describe('beliefSnapshot — by value, never by pointer', () => {
  // THE test of this module. A pointer would pass every other assertion here.
  it('does not change when the pattern row is later rewritten in place', () => {
    const row = pattern();
    const frozen = beliefSnapshot(row);

    // What a re-extraction does to the same row (R-6: upsert, not insert).
    row.statement = 'On cold adsets, KILL once frequency passes ~2.0';
    row.accuracy  = 0.41;
    row.status    = 'CONFLICTED';
    row.support   = 31;

    expect(frozen.statement).toMatch(/~3\.5/);
    expect(frozen.accuracy).toBe(0.85);
    expect(frozen.status).toBe('ESTABLISHED');
    expect(frozen.support).toBe(14);
  });

  it('carries the measured evidence, not just an id', () => {
    const b = beliefSnapshot(pattern());
    for (const k of ['patternKey', 'kind', 'statement', 'basis', 'status',
                     'support', 'effectiveSupport', 'accuracy', 'confidence',
                     'firstObservedAt', 'lastObservedAt']) {
      expect(b[k], `belief is missing ${k}`).not.toBeUndefined();
    }
  });

  it('serialises instants as ISO strings so a Json column round-trips them', () => {
    const b = beliefSnapshot(pattern());
    expect(b.firstObservedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(b.lastObservedAt).toBe('2026-08-30T00:00:00.000Z');
  });

  it('keeps a null accuracy null — never a 0 or an invented prior', () => {
    const b = beliefSnapshot(pattern({ accuracy: null, confidence: null }));
    expect(b.accuracy).toBeNull();
    expect(b.confidence).toBeNull();
  });

  it('refuses to build from nothing', () => {
    expect(() => beliefSnapshot(null)).toThrow(/pattern/i);
  });
});

describe('grantedAutonomy — what Lumi may now do, stated exactly', () => {
  // The promotion grants durable authority to JUDGE and RAISE. The rule writes
  // `status: 'PROPOSED'` and the row still rides confirm→execute, so a record
  // that implied autonomous action would overstate what was authorized.
  it('states the authority as raising a proposal, never as acting', () => {
    expect(grantedAutonomy(rule()).authority).toBe(GRANTED_AUTHORITY.RAISE_PROPOSED_DECISION);
  });

  it('copies the whole enforceable spec by value', () => {
    const a = grantedAutonomy(rule());
    expect(a).toMatchObject({
      ruleId: 'rule-1', metric: 'frequency', comparator: 'GTE', threshold: 3.5,
      unit: 'RATIO', scopeLevel: 'ADSET', audienceTag: 'cold', sustainedDays: 1,
      emitVerdict: 'KILL',
    });
  });
});

describe('promotionSnapshot — the whole authorization record', () => {
  it('records the accuracy floor that was APPLIED, not the one in force today', () => {
    // PATTERN_PROMOTE_MIN_ACCURACY is env-driven and read at module load. A rule
    // promoted under 0.75 and one promoted under 0.6 are not the same claim, and
    // reading today's floor would relabel yesterday's grant.
    const snap = promotionSnapshot({ pattern: pattern(), rule: rule(), gate: gate({ minAccuracyApplied: 0.75 }) });
    expect(snap.gate.minAccuracyApplied).toBe(0.75);
  });

  it('names the approver AND whether they approved their own request', () => {
    const snap = promotionSnapshot({ pattern: pattern(), rule: rule(), gate: gate() });
    expect(snap.gate.requestedById).toBe('user-a');
    expect(snap.gate.approvedById).toBe('user-a');
    // Self-approval is visible, never dressed up as four eyes.
    expect(snap.gate.selfApproved).toBe(true);
  });

  it('is deep-frozen — a provenance record nothing can edit afterwards', () => {
    const snap = promotionSnapshot({ pattern: pattern(), rule: rule(), gate: gate() });
    expect(() => { snap.belief.accuracy = 0.1; }).toThrow();
    expect(() => { snap.autonomy.threshold = 99; }).toThrow();
    expect(() => { snap.gate.selfApproved = false; }).toThrow();
  });

  it('refuses an incomplete authorization', () => {
    expect(() => promotionSnapshot({ pattern: pattern(), rule: rule() })).toThrow(/gate/i);
    expect(() => promotionSnapshot({ pattern: pattern(), gate: gate() })).toThrow(/rule/i);
  });
});

describe('vocabulary', () => {
  it('reuses ApprovalRequest with its own subject type, never the plan gate', () => {
    expect(PROMOTION_SUBJECT_TYPE).toBe('PATTERN_PROMOTION');
  });

  it('names the grant and the revocation as their own events', () => {
    expect(AUTONOMY_EVENT.GRANTED).toBe('AUTONOMY_GRANTED');
    expect(AUTONOMY_EVENT.REVOKED).toBe('AUTONOMY_REVOKED');
  });
});
