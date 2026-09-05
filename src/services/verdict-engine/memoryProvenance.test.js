// ============================================================
// C-16 — what a Decision records about the memory that shaped it  (RED)
// ============================================================
// R-6, Article VI: a Decision records the memory that shaped it as a
// MEASUREMENT TAKEN AT THE MOMENT OF COMMITMENT, never as a reference to a
// pattern that can still change.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────
//
// `runSweep` computes ONE evaluation and hands it to both sides:
//
//   persistConnectorVerdicts → stores    verdictConfidence            (BASE)
//   getConnectorVerdicts     → publishes base × memoryFactor          (ADJUSTED)
//
// The same sweep publishes one confidence to the operator and stores a
// different one, and nothing records that they differ or why. This is NOT
// R-1's then/now split: the row's own comment claims to freeze "what the engine
// BELIEVED, frozen at the moment of the call", but what Lumi PUBLISHED was the
// adjusted number. The freeze captured the engine's belief, not Lumi's.
// MEMORY_WEIGHT is 0.10, so they diverge by up to ±10%, and the stored figure
// is user-reachable through C-11's detail read and the campaign timeline.
//
// ── WHY VALUES AND NEVER POINTERS ───────────────────────────────────────────
//
// `AccountPattern` is upserted in place (`@@unique([workspaceId, patternKey])`)
// and `dynamicFields` rewrites NINE fields every sweep — including `statement`,
// the sentence itself. A stored `patternId` dereferenced six months later
// yields today's wording and today's accuracy: an audit trail that looks
// correct and lies. `ctrAtDecision` / `roasAtDecision` exist because
// `MetricSnapshot` is re-stamped per sync; this is the same argument, one
// object over.
// ============================================================
import { describe, it, expect } from 'vitest';
import { KNOWLEDGE } from '@marcom/runtime-contracts';
import { MEMORY_STATUS, MEMORY_KNOWLEDGE } from '../pattern-engine/institutionalMemory.js';
import { memoryDecisionFacts } from './memoryProvenance.js';

const pattern = (over = {}) => ({
  patternId: 'p-1', statement: 'KILL calls hold on fatigued creative',
  verdict: 'KILL', scopeLevel: null, accuracy: 0.9, effectiveSupport: 12, ...over,
});

const ok = (records) => ({ status: MEMORY_STATUS.OK, records });
const facts = (memory, over = {}) => memoryDecisionFacts(memory, {
  verdict: 'KILL', entityLevel: 'CAMPAIGN', baseConfidence: 0.8, ...over,
});

describe('C-16 · NOT_CONSULTED — the state the write path has always been in', () => {
  it('T1 · no memory carried is NOT_CONSULTED, never "the account learned nothing"', () => {
    // R-6's sentence: "A Decision naming no memory means memory was not
    // consulted — never that the account learned nothing." Those are a fact
    // about US and a fact about the ACCOUNT, and MEMORY_STATUS exists precisely
    // so they cannot wear one spelling.
    const f = facts(undefined);
    expect(f.memoryStatus).toBe(MEMORY_STATUS.NOT_CONSULTED);
    expect(f.memoryProvenance).toBeNull();
  });

  it('T2 · and it changes nothing about the number', () => {
    const f = facts(undefined);
    expect(f.confidence).toBe(0.8);
    expect(f.baseConfidence).toBe(0.8);
  });

  it('T3 · null is treated the same as absent — both mean nobody asked', () => {
    expect(facts(null).memoryStatus).toBe(MEMORY_STATUS.NOT_CONSULTED);
  });

  it('T4 · NOT_CONSULTED carries COULD_NOT_LOOK, and C-06 knows it', () => {
    // Its definition already reads "the read failed, OR NO RECORD OF IT EXISTS"
    // — which is exactly a pre-C-16 row. Not NOTHING_THERE (we did not look, so
    // we found nothing about the account) and not CANNOT_ASK (memory does apply
    // to a Signal verdict; it simply was never wired).
    //
    // `knowledgeOf`, not a bare index: declareStatusVocabulary returns
    // { name, values, mapping, knowledgeOf } and the function is the contract —
    // it answers `null` for an unrecognised value rather than `undefined`, so a
    // caller publishes an absent field instead of a fabricated token.
    expect(MEMORY_KNOWLEDGE.knowledgeOf(MEMORY_STATUS.NOT_CONSULTED)).toBe(KNOWLEDGE.COULD_NOT_LOOK);
  });

  it('T5 · the vocabulary is exhaustively declared — C-06 throws at load if not', () => {
    // This assertion is nearly free, because the import above already proved it:
    // declareStatusVocabulary throws a VocabularyDeclarationError at MODULE LOAD
    // for any value with no token. Stating it makes the fourth value's arrival
    // visible in the census rather than only in a stack trace.
    expect(MEMORY_KNOWLEDGE.values).toHaveLength(4);
    expect(MEMORY_KNOWLEDGE.values).toContain(MEMORY_STATUS.NOT_CONSULTED);
    expect(MEMORY_KNOWLEDGE.knowledgeOf('SOMETHING_ELSE')).toBeNull();
  });
});

describe('C-16 · the three states that already existed keep their meanings', () => {
  it('T5 · MEMORY_UNAVAILABLE is recorded, and leaves the number untouched', () => {
    // Our outage must never penalise the account: the factor is exactly 1.0, so
    // the published and base figures are bit-identical — and the row says WHY
    // they are identical rather than leaving it to be inferred.
    const f = facts({ status: MEMORY_STATUS.MEMORY_UNAVAILABLE, records: [] });
    expect(f.memoryStatus).toBe(MEMORY_STATUS.MEMORY_UNAVAILABLE);
    expect(f.confidence).toBe(f.baseConfidence);
    expect(f.memoryProvenance.applied).toBe(false);
  });

  it('T6 · NO_VALIDATED_MEMORY is a finding about the account, and is recorded', () => {
    const f = facts({ status: MEMORY_STATUS.NO_VALIDATED_MEMORY, records: [] });
    expect(f.memoryStatus).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
    expect(f.memoryProvenance.patterns).toEqual([]);
  });

  it('T7 · the three pre-existing states are never collapsed into one another', () => {
    const seen = [
      facts(undefined).memoryStatus,
      facts({ status: MEMORY_STATUS.MEMORY_UNAVAILABLE, records: [] }).memoryStatus,
      facts({ status: MEMORY_STATUS.NO_VALIDATED_MEMORY, records: [] }).memoryStatus,
      facts(ok([pattern()])).memoryStatus,
    ];
    expect(new Set(seen).size).toBe(4);
  });
});

describe('C-16 · the measurement freezes by VALUE', () => {
  it('T8 · the provenance carries the statement and the numbers, not a pointer', () => {
    const f = facts(ok([pattern()]));
    expect(f.memoryProvenance.patterns[0]).toEqual({
      patternId: 'p-1',
      statement: 'KILL calls hold on fatigued creative',
      accuracy: 0.9,
      effectiveSupport: 12,
    });
  });

  it('T9 · a bare id list would not satisfy this contract', () => {
    // The assertion that actually protects the ruling: `dynamicFields` rewrites
    // `statement` and `accuracy` on every sweep, so a row holding only ids is
    // an audit trail that silently re-reads itself.
    const [p] = facts(ok([pattern()])).memoryProvenance.patterns;
    expect(typeof p.statement).toBe('string');
    expect(typeof p.accuracy).toBe('number');
  });

  it('T10 · ALL relevant patterns are frozen — never the read’s slice of three', () => {
    // `memoryConfidenceFactor` is a support-weighted mean over EVERY relevant
    // record. The read publishes three. A record persisted from that slice
    // would be permanently unable to explain its own number.
    const records = Array.from({ length: 7 }, (_, i) => pattern({ patternId: `p-${i}` }));
    const f = facts(ok(records));
    expect(f.memoryProvenance.patterns).toHaveLength(7);
  });

  it('T11 · only patterns RELEVANT to this verdict and scope are frozen', () => {
    const records = [pattern(), pattern({ patternId: 'p-2', verdict: 'SCALE' })];
    const f = facts(ok(records));
    expect(f.memoryProvenance.patterns.map((p) => p.patternId)).toEqual(['p-1']);
  });

  it('T12 · the factor that moved the number is frozen beside the patterns', () => {
    const f = facts(ok([pattern()]));
    expect(typeof f.memoryProvenance.factor).toBe('number');
    expect(f.memoryProvenance.applied).toBe(f.memoryProvenance.factor !== 1);
  });
});

describe('C-16 · read and write finally publish the same number', () => {
  it('T13 · confidence is the PUBLISHED figure — base × factor', () => {
    const f = facts(ok([pattern()]));
    expect(f.confidence).not.toBe(f.baseConfidence);
    expect(f.confidence).toBeCloseTo(0.8 * f.memoryProvenance.factor, 2);
  });

  it('T14 · baseConfidence preserves the engine’s own, exactly', () => {
    // A reader who distrusts the history must be able to recover the untouched
    // deterministic number — the same guarantee the read payload already gives.
    expect(facts(ok([pattern()])).baseConfidence).toBe(0.8);
  });

  it('T15 · a null base stays null — memory never invents a confidence', () => {
    const f = facts(ok([pattern()]), { baseConfidence: null });
    expect(f.baseConfidence).toBeNull();
    expect(f.confidence).toBeNull();
  });

  it('T16 · there is no `?? 0.5` anywhere in this path', () => {
    // I54 removed one fabricated prior from the pattern engine. This is the
    // same fabrication on the row R-6 exists to make auditable.
    const f = facts(undefined, { baseConfidence: null });
    expect(f.confidence).not.toBe(0.5);
    expect(f.baseConfidence).not.toBe(0.5);
  });

  it('T17 · the ceiling the confidence engine enforces is not bypassed', () => {
    const strong = Array.from({ length: 5 }, (_, i) => pattern({ patternId: `p-${i}`, accuracy: 1 }));
    const f = facts(ok(strong), { baseConfidence: 0.97 });
    expect(f.confidence).toBeLessThanOrEqual(0.97);
  });
});
