// ============================================================
// Cohort assignment — the server decides, the workspace does not (R11 · F12)
// ============================================================
import { describe, it, expect } from 'vitest';
import { COHORT_DIMENSIONS, assignCohort, cohortWhere, CohortUnavailableError } from './cohort.js';

describe('assignCohort — derived from a controlled attribute', () => {
  it('derives the cohort from the workspace currency', () => {
    expect(assignCohort({ currency: 'EGP' })).toBe('CUR-EGP');
    expect(assignCohort({ currency: 'USD' })).toBe('CUR-USD');
  });

  it('normalizes case and surrounding space — one currency, one cohort', () => {
    // Two spellings of the same currency must not become two populations:
    // each would sit below K on its own and suppress an insight that is
    // actually supported. Silent cohort fragmentation reads as "not enough
    // data" and is indistinguishable from a genuinely thin cohort.
    expect(assignCohort({ currency: 'egp' })).toBe('CUR-EGP');
    expect(assignCohort({ currency: ' EGP ' })).toBe('CUR-EGP');
  });

  it('returns null — never a default — outside the controlled vocabulary', () => {
    // Null means "no population can honestly be named", and callers refuse on
    // it. A fallback cohort here would place an account into an aggregate it
    // has no claim to, which is the whole failure this module exists to stop.
    for (const currency of [null, undefined, '', 'E', 'EGYPT', 'EG-apparel', '123', 42, {}]) {
      expect(assignCohort({ currency })).toBeNull();
    }
    expect(assignCohort(null)).toBeNull();
    expect(assignCohort(undefined)).toBeNull();
  });

  it('ignores any caller-supplied cohortTag on the workspace object', () => {
    // The stored column is a label this service writes. If it ever disagrees
    // with the controlled attribute, the attribute wins.
    expect(assignCohort({ currency: 'USD', cohortTag: 'EG-apparel' })).toBe('CUR-USD');
  });
});

describe('cohortWhere — peer selection cannot drift from cohort derivation', () => {
  it('selects peers on the same attribute the cohort is derived from', () => {
    expect(cohortWhere({ currency: 'EGP' })).toEqual({ currency: 'EGP' });
  });

  it('returns null wherever assignCohort returns null', () => {
    // The two must agree on who has no cohort. If cohortWhere answered with a
    // where-fragment while assignCohort answered null, the read would select a
    // peer population it could not name.
    for (const currency of [null, '', 'EGYPT', 'EG-apparel']) {
      expect(assignCohort({ currency })).toBeNull();
      expect(cohortWhere({ currency })).toBeNull();
    }
  });

  it('queries only approved dimensions — the where-fragment adds no other key', () => {
    // This is the structural guard: if a second dimension is ever added to
    // assignCohort but not to COHORT_DIMENSIONS (or vice versa), one of these
    // two assertions fails rather than the aggregate silently widening.
    expect(COHORT_DIMENSIONS).toEqual(['currency']);
    expect(Object.keys(cohortWhere({ currency: 'USD' }))).toEqual([...COHORT_DIMENSIONS]);
  });
});

describe('CohortUnavailableError', () => {
  it('carries a stable code the route maps to 409', () => {
    const err = new CohortUnavailableError();
    expect(err.code).toBe('COHORT_UNAVAILABLE');
    expect(err).toBeInstanceOf(Error);
  });
});
