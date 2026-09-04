// ============================================================
// C-10 · readers declare which classes they accept
// ------------------------------------------------------------
// Discovery counted 31 reads of the Decision table:
//
//    8  by id                → class-safe by construction (an id names one row)
//   12  class-scoped         → they say what they accept
//   11  { workspaceId, … }   → they say NOTHING
//
// The eleven are not eleven bugs. They are one missing contract, and its absence
// is what makes them unreadable: `where: { workspaceId }` could mean the reader
// accepts every class, or forgot a filter, or predates a class that did not
// exist when it was written. Nothing in the code distinguishes those.
//
//   Absence of a class filter is not evidence that the reader accepts every
//   class. If the reader is general, it says so. If it is scoped, it says what
//   it accepts.
//
// So a general read stays behaviourally identical — an empty fragment — but it
// becomes a CALL: greppable, countable, and ratcheted.
// ============================================================
import { describe, it, expect } from 'vitest';
import { DECISION_CLASS, DECISION_CLASS_VALUES } from '@marcom/runtime-contracts';
import {
  DECISION_READERS,
  ALL_CLASSES,
  scopeFor,
  UndeclaredReaderError,
} from './decisionClassScope.js';
import { JURISDICTION_SUFFIXES } from '../vocabulary/epistemicInventory.js';

describe('T4 — a scoped reader cannot see a class outside its scope', () => {
  it('publishes the accepted classes as an explicit `in` list', () => {
    const where = scopeFor('allocation/appetite');
    expect(where).toEqual({ decisionClass: { in: [DECISION_CLASS.SIGNAL] } });
  });

  it.each([
    'allocation/appetite',
    'allocation/appetite-incremental',
    'collaboration/inbox',
    'test-generator/latest-verdict',
    'learning/patterns',
    'learning/track-record',
    'accuracy/population',
    'accuracy/pending-outcomes',
  ])('%s admits SIGNAL and nothing else', (readerId) => {
    const admitted = scopeFor(readerId).decisionClass.in;
    expect(admitted).toEqual([DECISION_CLASS.SIGNAL]);
    for (const other of [DECISION_CLASS.GUARDRAIL, DECISION_CLASS.ALLOCATION, DECISION_CLASS.EXPERIMENT]) {
      expect(admitted).not.toContain(other);
    }
  });

  it('refuses a reader that never declared', () => {
    // The point of the seam. A new population read cannot reach the table
    // without appearing in the ledger, so "I forgot a filter" stops being
    // indistinguishable from "I accept everything".
    expect(() => scopeFor('some/new/read')).toThrow(UndeclaredReaderError);
  });

  it('refuses a declaration naming something that is not a class', () => {
    // A renamed or mistyped class must fail loudly. Silently matching nothing is
    // how a scoped read becomes an empty surface that looks like an empty account.
    for (const entry of Object.values(DECISION_READERS)) {
      if (entry === ALL_CLASSES) continue;
      for (const c of entry) expect(DECISION_CLASS_VALUES).toContain(c);
    }
  });
});

describe('T5 — a general reader declares ALL, explicitly and with a reason', () => {
  it.each([
    'narrative/report',
    'narrative/activity',
    'loop/platform-executions',
  ])('%s declares ALL', (readerId) => {
    expect(DECISION_READERS[readerId]).toBe(ALL_CLASSES);
    // Behaviourally identical to today: no class predicate at all.
    expect(scopeFor(readerId)).toEqual({});
  });

  it('the ALL census is exactly three, and each carries its reason', () => {
    // A RATCHET, in the same spirit as migrationCompatibility's count and C-06's
    // inventory: a fourth general reader is not forbidden, it is required to be
    // argued for in the diff. Silence is what this slice removed.
    const general = Object.entries(DECISION_READERS).filter(([, v]) => v === ALL_CLASSES);
    expect(general).toHaveLength(3);
  });

  it('a general reader is never merely an empty array', () => {
    // `[]` would produce `{ decisionClass: { in: [] } }` — a read that matches
    // nothing — and would be indistinguishable from a declaration someone
    // emptied by accident. ALL is its own token.
    for (const [, entry] of Object.entries(DECISION_READERS)) {
      if (entry === ALL_CLASSES) continue;
      expect(entry.length).toBeGreaterThan(0);
    }
  });
});

describe('T9 — EXPERIMENT enters no reader that did not declare it', () => {
  it('no registered reader admits EXPERIMENT today', () => {
    // Not an oversight — a ruling. An Experiment decision has no `resolution`
    // (nothing outside VerdictService writes one), so it has no outcome to
    // learn from and no track record to compare against. Admitting it into the
    // learning or accuracy population would count a conclusion nobody scored.
    //
    // Admitting it later needs a producer that owns that outcome — the same
    // shape as C-18's Ruling D. This test is what makes that a decision rather
    // than a drift.
    for (const [readerId, entry] of Object.entries(DECISION_READERS)) {
      if (entry === ALL_CLASSES) continue;
      expect(entry, `${readerId} admits EXPERIMENT`).not.toContain(DECISION_CLASS.EXPERIMENT);
    }
  });
});

describe('T12 — a new class reveals its readers instead of widening silently', () => {
  it('a class nobody named is admitted by no scoped reader', () => {
    const invented = 'ANOMALY';
    expect(DECISION_CLASS_VALUES).not.toContain(invented);
    for (const [, entry] of Object.entries(DECISION_READERS)) {
      if (entry === ALL_CLASSES) continue;
      expect(entry).not.toContain(invented);
    }
  });

  it('records which classes no scoped reader admits at all', () => {
    // The other direction, and the one that surfaces a finding rather than a
    // defect: a class only the three general readers can see is a class with no
    // destination of its own.
    //
    // ALLOCATION and EXPERIMENT are in exactly that position. Allocation moves
    // reach the leadership narrative and nothing else; experiment conclusions
    // reach nothing at all — they are minted PROPOSED and never read as a class
    // anywhere, which discovery measured and C-10 does not fix. Pinned here so
    // the day one of them gains a destination, it is a decision somebody made.
    const scopedUnion = new Set(
      Object.values(DECISION_READERS).filter((v) => v !== ALL_CLASSES).flat(),
    );
    expect([...scopedUnion].sort()).toEqual([DECISION_CLASS.GUARDRAIL, DECISION_CLASS.SIGNAL]);
  });
});

describe('Ruling 1 — the registry is not a C-06 vocabulary', () => {
  it('DECISION_CLASS sits outside the epistemic jurisdiction by structure', () => {
    // A decision class answers "what kind of decision is this?"; C-06 answers
    // "what does Lumi know?". Asserted against the jurisdiction's OWN suffix
    // list, not a copy — so if `_CLASS` is ever added there this fails and
    // someone rules deliberately, which is what that ratchet exists for.
    for (const suffix of JURISDICTION_SUFFIXES) {
      expect('DECISION_CLASS'.endsWith(suffix)).toBe(false);
    }
  });
});
