// ============================================================
// C-11 — the detail read is a THEN surface, enforced at the SOURCE (RED)
// ------------------------------------------------------------
// The behavioural file next door pins what one response contains. It cannot pin
// what the module is ALLOWED TO DO — a live recompute that happens to produce
// the same shape passes every assertion there and still breaks the law:
//
//     ATTENTION is led by now. DECISION / OUTCOME / LEARNING are led by then.
//     (R-1, constitutional)
//
// So this file reads the module's own source. It is the same instrument C-10's
// jurisdiction test used, and it carries the same obligation: a scan that stops
// finding call sites reports a clean jurisdiction, so the scan must check
// ITSELF before it is allowed to report anything.
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { DECISION_DESTINATION_CLASSES, hasDestination } from './decisionClassScope.js';

const SRC = resolve('src');
const DETAIL = resolve(SRC, 'services/decisions/decisionDetail.js');

/** Source with comments stripped: this slice quotes its own prohibitions. */
const code = (p) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

describe('C-11 · Ruling B — three destinations, four storage classes', () => {
  it('names exactly SIGNAL, GUARDRAIL and EXPERIMENT', () => {
    expect([...DECISION_DESTINATION_CLASSES].sort()).toEqual(
      [DECISION_CLASS.EXPERIMENT, DECISION_CLASS.GUARDRAIL, DECISION_CLASS.SIGNAL].sort(),
    );
  });

  it('excludes ALLOCATION — R-3: a plan artifact, not a Decision', () => {
    expect(hasDestination(DECISION_CLASS.ALLOCATION)).toBe(false);
  });

  it('and excludes NULL, which is UNCLASSIFIED and not a fifth class', () => {
    expect(hasDestination(null)).toBe(false);
    expect(hasDestination(undefined)).toBe(false);
  });

  it('is a SEPARATE declaration from the reader ledger — a different question', () => {
    // DECISION_READERS answers "what may this read MIX?" and is about population
    // safety; a by-id read is class-safe there by construction. This set answers
    // "what may a person OPEN?", which is a product ruling. Folding one into the
    // other would make a destination look like a query scope.
    const src = code(resolve(SRC, 'services/decisions/decisionClassScope.js'));
    expect(src).toMatch(/export const DECISION_DESTINATION_CLASSES/);
    expect(src).not.toMatch(/DECISION_READERS[\s\S]{0,400}DECISION_DESTINATION_CLASSES\s*[,\]}]/);
  });
});

describe('C-11 · Ruling A — the module cannot recompute, by construction', () => {
  it('the detail module exists', () => {
    expect(existsSync(DETAIL)).toBe(true);
  });

  it('imports no live-truth producer', () => {
    // Each of these answers "what is true NOW". Reaching any of them here is how
    // a then-surface silently becomes a diff.
    const src = code(DETAIL);
    for (const forbidden of [
      'verdict-engine/verdictEngine', 'verdictEngine.js', 'metricSnapshot',
      'evidence/index.js', 'confidenceEngine', 'connectorVerdictService',
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it('touches no model but `decision`', () => {
    // Ruling E as a source fact: DecisionMemoryEntry, AccountPattern and
    // PatternObservation wait for R-6 / C-16, and TestExperiment is not this
    // slice's traversal either. A detail read that grew a join would be IA
    // decided inside a contract slice.
    const src = code(DETAIL);
    const models = [...src.matchAll(/prisma\.([a-zA-Z]+)\./g)].map((m) => m[1]);
    expect([...new Set(models)]).toEqual(['decision']);
  });

  it('names no clock — a stored decision is not re-dated on read', () => {
    const src = code(DETAIL);
    expect(src).not.toMatch(/new Date\(\s*\)|Date\.now\(/);
  });
});

describe('C-11 · the instrument checks itself before it reports', () => {
  const files = [
    'routes/execution/detail.js', 'routes/lumi/decisionSignalStamps.js',
    'routes/lumi/executions.js', 'services/decision-accuracy/DecisionAccuracyService.js',
    'services/decision-accuracy/outcomeEvidenceComparison.js',
    'services/decision-memory/humanJudgment.js', 'services/execution/decisionAttribution.js',
    'services/execution/decisionEligibility.js',
  ];

  it('every by-id site this slice reasoned about still exists', () => {
    // C-10 was measured twice with different numbers because two scans asked
    // different questions. The lesson recorded from it is that a repository scan
    // must prove its own reach before its count means anything.
    for (const f of files) expect(existsSync(resolve(SRC, f))).toBe(true);
  });

  it('the eight existing by-id reads stay class-BLIND, and that is correct', () => {
    // They resolve a row to AUTHORISE OR DECORATE AN ACTION. Ruling B governs
    // destinations, not actions: a guardrail episode must still be executable,
    // and an ALLOCATION row must still be attributable to its execution. Adding
    // a destination predicate to them would break behaviour this slice never
    // ruled on. Pinned so a later reader does not "finish the job".
    const withDestination = files.filter((f) => code(resolve(SRC, f)).includes('DECISION_DESTINATION_CLASSES'));
    expect(withDestination).toEqual([]);
  });
});
