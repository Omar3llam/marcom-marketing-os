// ============================================================
// C-14 — the briefing contract fails in the OPPOSITE direction  (RED)
// ------------------------------------------------------------
// C-13 measured its own surface and found the backend publishing a field the
// client schema silently stripped (`decisionClass`, eaten by `z.object()`).
// Its ratchet therefore asserts: everything PUBLISHED is DECLARED.
//
// This surface was measured too, and it fails the other way round:
//
//     supersededById   a real column, DECLARED by the client, never SELECTED
//     supersededByKey  DECLARED by the client, and not a column at all —
//                      an in-memory field of the extraction pass, consumed at
//                      PatternService:262 and incapable of ever being sent
//
// So the ratchet here asserts the inverse: **everything DECLARED is SENT**.
//
// ── WHY A FIELD DECLARED-BUT-NEVER-SENT IS A DEFECT, NOT SLACK ──────────────
//
// A zod declaration is what a component may rely on. Declaring a field the
// server never sends is a promise that resolves to `undefined` forever — and it
// reads, to anyone opening the schema, as a field that exists. That is exactly
// how `supersededById` came to look available while B8-05's "what it replaced"
// had no way to reach a person, and how `supersededByKey` came to describe an
// extraction internal as part of the public shape.
//
// ── TWO RATCHETS, OPPOSITE DIRECTIONS, NOT YET AN ABSTRACTION ───────────────
//
// C-13's and this one were each derived from a measured failure on their own
// surface. Two instances pointing opposite ways is two instances. Generalising
// them into one bidirectional rule is C-16's call, with a third measurement —
// not something to invent here from a sample of two.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRIEFING_SELECT } from './PatternService.js';

const SCHEMA_PATH = new URL(
  '../../../packages/api-contracts/schemas/accountPattern.schema.ts',
  import.meta.url,
);

/**
 * Fields the briefing adds AFTER the select, so they are legitimately declared
 * without being selected. Each one is named here on purpose: an unexplained
 * allow-list entry is how a ratchet quietly stops ratcheting.
 */
const DERIVED = Object.freeze([
  'promotable',  // readBriefing computes it from the row (isActionablePattern)
  'checks',      // C-14 · A — counted from PatternObservation at read time
  'replacedBy',  // C-14 · B — supersededById, resolved to the replacement's statement
]);

/**
 * The TOP-LEVEL keys declared inside `AccountPatternSchema = z.object({ … })`.
 *
 * Brace depth is tracked because a nested shape — `checks: z.object({ made,
 * held, knowledge })` — otherwise contributes its own inner keys as if they
 * were fields of the pattern, and the ratchet then reports phantoms that are
 * simply one level down. The first version of this parser did exactly that.
 * Same failure as C-13's content check splitting a file at a function name:
 * **a parser is only as good as the region it actually cuts.**
 */
function declaredFields() {
  const src = readFileSync(SCHEMA_PATH, 'utf8');
  const block = src.match(/AccountPatternSchema\s*=\s*z\.object\(\{([\s\S]*?)\n\}\)/);
  if (!block) throw new Error('AccountPatternSchema z.object({…}) not found — the ratchet cannot read its subject');

  const out = [];
  let depth = 0;
  for (const raw of block[1].split('\n')) {
    const line = raw.trim();
    // A comment naming a field must never satisfy the check.
    if (line.startsWith('//')) continue;
    if (depth === 0) {
      const key = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/)?.[1];
      if (key) out.push(key);
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return out;
}

describe('C-14 — the briefing declares nothing it cannot send', () => {
  it('T19 · every field the client schema declares is selected or derived', () => {
    const sent = new Set([...Object.keys(BRIEFING_SELECT), ...DERIVED]);
    const phantom = declaredFields().filter((f) => !sent.has(f));
    expect(
      phantom,
      `declared by accountPattern.schema.ts and NEVER sent: ${phantom.join(', ')}`,
    ).toEqual([]);
  });

  it('T20 · the two facts C-14 makes crossable are selected', () => {
    // `supersededById` is the pointer B is built on. It has been a column all
    // along and was never in the projection.
    expect(Object.keys(BRIEFING_SELECT)).toContain('supersededById');
  });

  it('T21 · the two facts that ALREADY crossed are still selected', () => {
    // C-14 must not "fix" what was never broken. `firstObservedAt`,
    // `lastObservedAt` and `effectiveSupport` reach the client today and are
    // simply unrendered; B8-05 reads them. Removing one here would turn a
    // rendering gap into a truth gap.
    for (const f of ['firstObservedAt', 'lastObservedAt', 'support', 'effectiveSupport', 'accuracy']) {
      expect(Object.keys(BRIEFING_SELECT)).toContain(f);
    }
  });

  it('T22 · the ratchet is non-vacuous — it can see a field nobody sends', () => {
    const sent = new Set([...Object.keys(BRIEFING_SELECT), ...DERIVED]);
    expect(sent.has('aFieldNobodySends')).toBe(false);
    expect(declaredFields().length).toBeGreaterThan(10);
  });

  it('T23 · the parser reads TOP-LEVEL keys only, not the inside of a shape', () => {
    // `made`, `held`, `knowledge` and `value` live inside `checks` and
    // `replacedBy`. Counting them as pattern fields is what the first version
    // of this parser did, and it produced four phantoms that were really one
    // level down. Pinned so the fix cannot silently regress.
    const declared = declaredFields();
    for (const inner of ['made', 'held', 'knowledge', 'value']) {
      expect(declared, `${inner} is nested and must not be read as a top-level field`)
        .not.toContain(inner);
    }
    expect(declared).toContain('checks');
    expect(declared).toContain('replacedBy');
  });

  it('T24 · a field that can NEVER be sent is not declared', () => {
    // `supersededByKey` is an in-memory field of the extraction pass, consumed
    // at PatternService:262 and not a database column at all. It was declared
    // here for as long as the schema has existed.
    expect(declaredFields()).not.toContain('supersededByKey');
  });
});
