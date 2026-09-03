// ============================================================
// epistemicInventory — the ratchet (C-06)
// ============================================================
// Test 8 of the C-06 contract, and the reason C-06 is a lock rather than a
// cleanup: a NEW status vocabulary that nobody has ruled on FAILS THE SUITE.
//
// The ratchet is honest about its jurisdiction. It does not try to decide by
// regex whether an enum is epistemic — it enumerates a measurable SHAPE and
// demands that a human have ruled on each member, in writing, in
// epistemicInventory.js. Being excluded is a passing answer; being unmentioned
// is not.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWLEDGE_VALUES } from '@marcom/runtime-contracts';
import {
  DECLARED, EXCLUDED, RULED, keyOf, JURISDICTION_SUFFIXES,
} from './epistemicInventory.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const SEARCH_ROOTS = ['src', 'packages'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

/** Every .js file under the search roots, tests excluded. */
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue; }
    if (!entry.endsWith('.js')) continue;
    if (entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

// Built from the inventory's own suffix list, so the ratchet and the ruling can
// never describe different jurisdictions.
const SUFFIX_ALTERNATION = JURISDICTION_SUFFIXES.join('|');
const VOCAB_RE = new RegExp(
  String.raw`export\s+const\s+([A-Z][A-Z0-9_]*(?:${SUFFIX_ALTERNATION}))\s*=\s*Object\.freeze`,
  'g',
);

/** Everything inside the jurisdiction, as `relativePath::SYMBOL`. */
function scanJurisdiction() {
  const found = [];
  for (const root of SEARCH_ROOTS) {
    for (const file of sourceFiles(join(REPO_ROOT, root))) {
      const src = readFileSync(file, 'utf8');
      const at = relative(REPO_ROOT, file).split(sep).join('/');
      for (const m of src.matchAll(VOCAB_RE)) found.push({ at, symbol: m[1] });
    }
  }
  return found;
}

describe('C-06 · the ratchet guards a declared jurisdiction', () => {
  const found = scanJurisdiction();

  it('finds vocabularies at all — a scanner that matches nothing proves nothing', () => {
    // Guards against the silent failure mode of every source-scanning test: a
    // regex that stops matching turns a ratchet into a no-op that still passes.
    expect(found.length).toBeGreaterThan(25);
  });

  it('every vocabulary in the jurisdiction has been ruled on', () => {
    const unruled = found.filter((v) => !RULED.has(keyOf(v))).map(keyOf);
    // THE FAILURE MESSAGE IS THE POINT. Whoever adds the next status vocabulary
    // reads this and knows what is being asked of them.
    expect(unruled, [
      'A status vocabulary exists that C-06 has not ruled on.',
      'Add it to src/services/vocabulary/epistemicInventory.js — either',
      'DECLARED (with declareStatusVocabulary beside the vocabulary itself) or',
      'EXCLUDED (with a written reason). Being excluded is a fine answer;',
      'being unmentioned is not.',
    ].join('\n')).toEqual([]);
  });

  it('every ruling points at a vocabulary that still exists', () => {
    // The other direction: a ruling left behind after a deletion or a rename
    // would make the inventory look complete while covering nothing.
    const present = new Set(found.map(keyOf));
    const orphaned = [...RULED].filter((k) => !present.has(k));
    expect(orphaned).toEqual([]);
  });

  it('rules on each vocabulary exactly once', () => {
    const keys = [...DECLARED, ...EXCLUDED].map(keyOf);
    expect(keys.length).toBe(new Set(keys).size);
    expect(RULED.size).toBe(keys.length);
  });
});

describe('C-06 · every declaration is exhaustive and well-formed', () => {
  it('maps every value of its vocabulary to exactly one of the five tokens', () => {
    // declareStatusVocabulary enforces this at module load; asserting it here
    // states the invariant where a reader looks for it, and catches a
    // declaration whose vocabulary drifted after it was written.
    for (const { symbol, declaration } of DECLARED) {
      expect(declaration.values.length, `${symbol}: empty vocabulary`).toBeGreaterThan(0);
      for (const value of declaration.values) {
        const token = declaration.knowledgeOf(value);
        expect(KNOWLEDGE_VALUES, `${symbol}.${value} → ${token}`).toContain(token);
      }
    }
  });

  it('registers each declaration under a unique name, qualifying real collisions', () => {
    const names = DECLARED.map((d) => d.declaration.name);
    expect(names.length).toBe(new Set(names).size);
    // EVIDENCE_STATUS is defined twice on trunk with different value sets. C-06
    // does not resolve that collision (out of scope) — it records it, so the
    // registry never implies the two are one vocabulary.
    expect(names).toContain('attribution/EVIDENCE_STATUS');
    expect(names).toContain('outcome-evidence/EVIDENCE_STATUS');
  });

  it('gives every exclusion a written reason', () => {
    for (const entry of EXCLUDED) {
      expect(entry.because, `${entry.symbol} was excluded with no reason`).toBeTruthy();
      expect(entry.because.length).toBeGreaterThan(40);
    }
  });
});

describe('C-06 · the distinctions Wave 0 paid for, stated in one language', () => {
  const decl = (symbol) => DECLARED.find((d) => d.symbol === symbol).declaration;

  it('C-03: a failed history read is COULD_NOT_LOOK, and OK is KNOWN', () => {
    expect(decl('HISTORY_STATUS').knowledgeOf('HISTORY_UNAVAILABLE')).toBe('COULD_NOT_LOOK');
    expect(decl('HISTORY_STATUS').knowledgeOf('OK')).toBe('KNOWN');
  });

  it('an account that has learned nothing is NOTHING_THERE, not COULD_NOT_LOOK', () => {
    expect(decl('MEMORY_STATUS').knowledgeOf('NO_VALIDATED_MEMORY')).toBe('NOTHING_THERE');
    expect(decl('MEMORY_STATUS').knowledgeOf('MEMORY_UNAVAILABLE')).toBe('COULD_NOT_LOOK');
  });

  it('C-04: NOT_RECORDED is COULD_NOT_LOOK — we hold no record to tell us', () => {
    expect(decl('AVAILABILITY_STATE').knowledgeOf('NOT_RECORDED')).toBe('COULD_NOT_LOOK');
    expect(decl('COMPLETENESS_STATE').knowledgeOf('NOT_RECORDED')).toBe('COULD_NOT_LOOK');
  });

  it('C-04: NEVER_SYNCED is NOTHING_THERE — we looked, and we hold nothing', () => {
    expect(decl('READINESS_STATE').knowledgeOf('NEVER_SYNCED')).toBe('NOTHING_THERE');
    // And it is NOT the same answer as NOT_RECORDED, which is the whole reason
    // READINESS needed three states rather than a stale boolean.
    expect(decl('READINESS_STATE').knowledgeOf('NEVER_SYNCED'))
      .not.toBe(decl('AVAILABILITY_STATE').knowledgeOf('NOT_RECORDED'));
  });

  it('a bad answer is still an answer: FAILING, INCOMPLETE and DEGRADING are KNOWN', () => {
    expect(decl('AVAILABILITY_STATE').knowledgeOf('FAILING')).toBe('KNOWN');
    expect(decl('COMPLETENESS_STATE').knowledgeOf('INCOMPLETE')).toBe('KNOWN');
    expect(decl('LIFT_STATUS').knowledgeOf('DEGRADING')).toBe('KNOWN');
  });

  it('the seven outcome-evidence statuses are FIVE kinds of thing, not seven', () => {
    const d = DECLARED.find((x) => x.declaration.name === 'outcome-evidence/EVIDENCE_STATUS').declaration;
    expect(d.values).toHaveLength(7);
    // THE ONLY vocabulary on trunk that exercises all five tokens — which is why
    // B6-01 named its consumer the template for the whole canonical view model.
    expect(new Set(d.values.map((v) => d.knowledgeOf(v)))).toEqual(
      new Set(KNOWLEDGE_VALUES),
    );
    // AMBIGUOUS is NOT a failed read: the rows arrived and disagree.
    expect(d.knowledgeOf('AMBIGUOUS')).toBe('NOT_ENOUGH');
    expect(d.knowledgeOf('UNAVAILABLE')).toBe('COULD_NOT_LOOK');
  });

  it('withheld consent is CANNOT_ASK — neither a failed read nor a thin cohort', () => {
    const d = decl('NETWORK_STATUS');
    expect(d.knowledgeOf('NOT_CONSENTED')).toBe('CANNOT_ASK');
    expect(d.knowledgeOf('INSUFFICIENT_DATA')).toBe('NOT_ENOUGH');
    expect(d.knowledgeOf('UNAVAILABLE')).toBe('COULD_NOT_LOOK');
    // The three the R10 comment insists must never merge, still three.
    expect(new Set([
      d.knowledgeOf('NOT_CONSENTED'), d.knowledgeOf('INSUFFICIENT_DATA'), d.knowledgeOf('UNAVAILABLE'),
    ]).size).toBe(3);
  });

  it('bounds and currency are outside the registry, by ruling', () => {
    const excluded = EXCLUDED.map((e) => e.symbol);
    expect(excluded).toContain('BOUNDS_STATUS');
    expect(excluded).toContain('CURRENCY_STATUS');
    expect(DECLARED.map((d) => d.symbol)).not.toContain('BOUNDS_STATUS');
    expect(DECLARED.map((d) => d.symbol)).not.toContain('CURRENCY_STATUS');
  });
});
