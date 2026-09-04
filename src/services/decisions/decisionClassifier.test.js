// ============================================================
// C-10 · the ONE classifier (Ruling 2)
// ------------------------------------------------------------
// Three modules derived a class from a rootCause string independently before
// this: NarrativeService's regex, feed.js's startsWith, and
// guardrailHitIdentity's pre-C-02 fallback. Three parsers, and nothing checking
// they agreed.
//
// This module replaces all three, and exists in the steady state only for the
// backfill and for the test that proves the migration's SQL says the same thing.
// ============================================================
import { describe, it, expect } from 'vitest';
import { DECISION_CLASS, isDecisionClass } from '@marcom/runtime-contracts';
import { classifyRootCause, CLASS_PREFIXES } from './decisionClassifier.js';
import { CONNECTOR_ROOT_CAUSES } from '../verdict-engine/decisionIdentity.js';

describe('classifyRootCause', () => {
  it('classifies a guardrail episode', () => {
    expect(classifyRootCause('guardrail:Frequency ceiling')).toBe(DECISION_CLASS.GUARDRAIL);
  });

  it('classifies an allocation move', () => {
    expect(classifyRootCause('allocation:11111111-1111-1111-1111-111111111111'))
      .toBe(DECISION_CLASS.ALLOCATION);
  });

  it('classifies BOTH experiment producers as ONE class (Ruling 4)', () => {
    // `test:` and `incrementality:` are subtypes, not sibling classes. They
    // produce a Decision, cross a similar lifecycle, and are none of the other
    // three — so they share population semantics. Splitting them would double
    // the vocabulary with no consumer asking for the distinction; `rootCause`
    // keeps the difference where it has always been.
    expect(classifyRootCause('test:variant-a')).toBe(DECISION_CLASS.EXPERIMENT);
    expect(classifyRootCause('incrementality:abc-123')).toBe(DECISION_CLASS.EXPERIMENT);
  });

  it('classifies a NULL cause as SIGNAL — absence is the evidence here', () => {
    // `rootCause: null` is IN the connector set, not an oversight: the engine
    // leaves it null on verdicts reached without a diagnosis, especially the
    // early gates. A classifier treating null as "unknown" would strand exactly
    // the campaigns that never got one — the population connectorDecisionScope
    // was written to keep.
    expect(classifyRootCause(null)).toBe(DECISION_CLASS.SIGNAL);
  });

  it('classifies every cause the engine can actually emit as SIGNAL', () => {
    // Against the REAL set, not a sample. `CONNECTOR_ROOT_CAUSES` is the union
    // of three enum families, and an earlier local copy of one of them went
    // stale the day FUNNEL_SIGNAL joined the taxonomy. Reading the canonical
    // list means a fourth family cannot slip past this either.
    expect(CONNECTOR_ROOT_CAUSES.length).toBeGreaterThan(0);
    for (const cause of CONNECTOR_ROOT_CAUSES) {
      expect(classifyRootCause(cause), cause).toBe(DECISION_CLASS.SIGNAL);
    }
  });

  it('answers NULL for a cause it cannot place — never an invented class', () => {
    // T3. A row whose rootCause names an enum value since deleted from the code
    // is genuinely unclassifiable, and saying so is the only honest answer —
    // the same ruling as C-02's legacy hits and C-05's legacy rules.
    //
    // The trap: a `?? SIGNAL` tail would look harmless and would enrol every
    // unrecognised row into the accuracy surface, the learning population and
    // the budget appetite gate at once.
    expect(classifyRootCause('SOME_RETIRED_ENUM_VALUE')).toBeNull();
    expect(classifyRootCause('mystery:whatever')).toBeNull();
    expect(classifyRootCause('')).toBeNull();
    expect(classifyRootCause(42)).toBeNull();
    expect(classifyRootCause(undefined)).toBeNull();
  });

  it('never returns anything but a class or null', () => {
    const samples = [null, undefined, '', 0, 42, {}, [], 'guardrail:x', 'allocation:x',
      'test:x', 'incrementality:x', 'nonsense', 'lower_snake', ...CONNECTOR_ROOT_CAUSES];
    for (const s of samples) {
      const out = classifyRootCause(s);
      expect(out === null || isDecisionClass(out)).toBe(true);
    }
  });

  it('no connector cause collides with a class prefix', () => {
    // The assumption the whole encoding rests on, asserted rather than trusted:
    // a connector cause is a bare enum member and a foreign class is
    // `<prefix>:<id>`. If a future SIGNAL_TYPE were ever named `test:something`
    // the prefix branch would win and the row would classify EXPERIMENT.
    for (const cause of CONNECTOR_ROOT_CAUSES) {
      for (const [prefix] of CLASS_PREFIXES) {
        expect(String(cause).startsWith(prefix), `${cause} collides with ${prefix}`).toBe(false);
      }
    }
  });
});
