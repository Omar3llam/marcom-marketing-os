// ============================================================
// Account health · ONE published vocabulary, zero client reclassification
// ------------------------------------------------------------
// RULING (Omar): "One engine fact → one published vocabulary → zero client
// reclassification."
//
// Measured on trunk before this slice, from the SAME `health.score`:
//
//     engine   ≥80 HEALTHY · ≥60 GOOD · ≥40 FAIR · ≥20 NEEDS ATTENTION · CRITICAL
//     Attention  ≥75 Healthy · ≥50 "Fair — review soon" · else "Needs attention"
//
// Five bands against three. SUBJECT/Campaigns rendered the engine's label and
// NOW/Attention rendered its own, so the two axes printed different verdicts
// about one account on 50 of the 101 integer scores — and CRITICAL could not be
// expressed on Attention at all.
//
// `AccountHealthService.test.js` already pins `healthLabel(70) === 'GOOD'`.
// Attention printed "Fair — review soon" for that very score: a server test
// naming the exact value the client contradicted.
//
// ── WHY THE VOCABULARY IS EVALUATED, NOT LISTED ─────────────────────────────
// The bands below are produced by CALLING the engine across the score range. A
// hand-written list here would be a third declaration of the same vocabulary,
// which is the defect this test exists to end.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { healthLabel } from '../services/analysis/AccountHealthService.js';
import { stripComments } from '../../scripts/contractConsumption.js';

const read = (...p) => readFileSync(join(process.cwd(), ...p), 'utf8');
// CODE only. The derivation's header QUOTES the vocabulary it replaced — that
// record is the point of the header, and an assertion that cannot tell a quoted
// defect from a live one would force the history to be deleted to stay green.
const DERIVE = stripComments(read('client', 'src', 'features', 'overview', 'overviewDerive.js'));
const DERIVE_RAW = read('client', 'src', 'features', 'overview', 'overviewDerive.js');
const ROUTE = read('src', 'routes', 'lumi', 'entities.js');

/** Every distinct band the engine can publish, by asking it. */
const ENGINE_LABELS = [...new Set(
  Array.from({ length: 101 }, (_, score) => healthLabel(score)),
)];

describe('the engine vocabulary is measured, not assumed', () => {
  it('evaluating the ladder yields the five published bands', () => {
    expect(ENGINE_LABELS.sort()).toEqual(
      ['CRITICAL', 'FAIR', 'GOOD', 'HEALTHY', 'NEEDS ATTENTION'].sort(),
    );
  });

  it('the instrument can fail — a fiction is not among them', () => {
    expect(ENGINE_LABELS).not.toContain('Fair — review soon');
    expect(ENGINE_LABELS).not.toContain('ZZZ_NOT_A_BAND');
    expect(DERIVE.length).toBeGreaterThan(500);
  });

  it('the comment stripper works, and does not eat the code', () => {
    // The control for the assertion below: the retired band must still be
    // readable in the file's PROSE, and absent from its CODE.
    expect(DERIVE_RAW).toContain('Fair — review soon');
    expect(DERIVE).toContain('healthPresentation');
    expect(stripComments("const a = 1; // 'Fair — review soon'\nconst b = 2;")).toContain('const b');
    expect(stripComments("const a = 1; // 'Fair — review soon'\nconst b = 2;")).not.toContain('review soon');
  });

  it('and the route publishes the label beside the score', () => {
    // The client can only consume what the wire carries. `...health` spreads
    // both; the no-data branch sends both as null, together.
    expect(ROUTE).toMatch(/score: null, label: null/);
    expect(ROUTE).toMatch(/\.\.\.health,/);
  });
});

describe('the client declares no competing health vocabulary', () => {
  it('the invented band is gone from the derivation', () => {
    // "Fair — review soon" is the signature of the client's own ladder: it is
    // not a band the engine can emit, so its presence anywhere in the
    // derivation means a second vocabulary is still being produced.
    expect(DERIVE).not.toContain('Fair — review soon');
  });

  it('no client-side label ladder re-thresholds the score', () => {
    // The tone ladder stays (visual severity is a separate, parked question).
    // What may not come back is a SCORE threshold that decides a LABEL.
    const labelLadder = /score\s*>=\s*\d+\s*\?\s*'(Healthy|Fair|Needs)/;
    expect(labelLadder.test(DERIVE)).toBe(false);
  });

  it('the derivation consumes a published label instead', () => {
    expect(DERIVE).toMatch(/label/);
    expect(DERIVE).toMatch(/healthPresentation\(\{[^}]*label/s);
  });
});
