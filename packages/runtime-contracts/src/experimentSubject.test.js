// ============================================================
// C-13 — EXPERIMENT_SUBJECT: which live object, not which class
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  EXPERIMENT_SUBJECT, EXPERIMENT_SUBJECT_VALUES, isExperimentSubject,
  DECISION_CLASS,
} from './index.js';

describe('C-13 · EXPERIMENT_SUBJECT', () => {
  it('T44 · names exactly the two live objects R-3 unified, and no third', () => {
    // A third value would mean R-3's class had grown, which is a constitutional
    // change rather than a vocabulary edit.
    expect(EXPERIMENT_SUBJECT_VALUES).toEqual(['AB_TEST', 'HOLDOUT']);
  });

  it('T45 · the tokens are their own names — no numeric or aliased values', () => {
    for (const [key, value] of Object.entries(EXPERIMENT_SUBJECT)) expect(value).toBe(key);
  });

  it('T46 · it is frozen, so no consumer can add a kind at runtime', () => {
    expect(Object.isFrozen(EXPERIMENT_SUBJECT)).toBe(true);
  });

  it('T47 · the guard admits both and refuses everything else', () => {
    expect(isExperimentSubject('AB_TEST')).toBe(true);
    expect(isExperimentSubject('HOLDOUT')).toBe(true);
    expect(isExperimentSubject('EXPERIMENT')).toBe(false);
    expect(isExperimentSubject(null)).toBe(false);
    expect(isExperimentSubject(undefined)).toBe(false);
  });

  it('T48 · a subject is NOT a class — the two vocabularies never overlap', () => {
    // The bug this prevents is a reader treating one as the other, which is
    // easy while both are bare strings on the same object. EXPERIMENT is the
    // class of BOTH subjects; neither subject is ever a class.
    for (const s of EXPERIMENT_SUBJECT_VALUES) {
      expect(Object.values(DECISION_CLASS)).not.toContain(s);
    }
    expect(isExperimentSubject(DECISION_CLASS.EXPERIMENT)).toBe(false);
  });

  it('T49 · it claims no C-06 suffix, so the 32-symbol census is untouched', () => {
    // C-06's jurisdiction is _STATUS | _STATE | _REASON | _RUN. This vocabulary
    // reports which row an item is about, not what Lumi knows about it.
    expect('EXPERIMENT_SUBJECT').not.toMatch(/_(STATUS|STATE|REASON|RUN)$/);
  });
});
