// ============================================================
// C-12 · T1 — who executed it, in a language both sides speak (RED)
// ------------------------------------------------------------
// `EXECUTION_PROVENANCE` has existed since B4-A, on the backend, with a
// docstring promising "a value a reader can branch on without comparing
// timestamps or guessing" — and ZERO callers. Meanwhile the campaign timeline
// compares timestamps and guesses, and labels a mutation Lumi performed as
// something a human did.
//
// C-07's rule decides where it belongs: a vocabulary belongs in the shared
// package when the CLIENT must branch on its values. This one's only remaining
// reader is a client.
// ============================================================
import { describe, it, expect } from 'vitest';
import { EXECUTION_PROVENANCE, EXECUTION_PROVENANCE_VALUES, isExecutionProvenance } from './executionProvenance.js';

describe('C-12 · T1 — the provenance vocabulary is shared', () => {
  it('names the four answers B4-A split apart', () => {
    expect(EXECUTION_PROVENANCE).toEqual({
      NONE: 'NONE', HUMAN: 'HUMAN', PLATFORM: 'PLATFORM', BOTH: 'BOTH',
    });
  });

  it('keeps NONE as a real answer, not an absence', () => {
    // "nobody acted" is what an un-acted decision honestly reports, and it is
    // not the same as "we did not look". A vocabulary that dropped it would
    // push every reader back to a null check with two meanings.
    expect(EXECUTION_PROVENANCE_VALUES).toContain('NONE');
    expect(EXECUTION_PROVENANCE_VALUES).toHaveLength(4);
  });

  it('is frozen, and rejects anything outside it', () => {
    expect(Object.isFrozen(EXECUTION_PROVENANCE)).toBe(true);
    expect(isExecutionProvenance('HUMAN')).toBe(true);
    expect(isExecutionProvenance('EXECUTED')).toBe(false);
    expect(isExecutionProvenance(null)).toBe(false);
  });

  it('re-exports from the package root, which is what the client imports', async () => {
    const pkg = await import('./index.js');
    expect(pkg.EXECUTION_PROVENANCE).toBe(EXECUTION_PROVENANCE);
  });

  it('carries no C-06 jurisdiction suffix, so the ratchet does not claim it', () => {
    // `_PROVENANCE` sits outside `_STATUS|_STATE|_REASON|_RUN`, like `_CLASS`
    // (C-10) and `_OUTCOME` (C-18). The suffix is not the argument — this
    // vocabulary reports the SUBJECT (who acted), not our position on knowing.
    expect(Object.keys(EXECUTION_PROVENANCE).join(' ')).not.toMatch(/_STATUS|_STATE|_REASON|_RUN/);
  });
});
