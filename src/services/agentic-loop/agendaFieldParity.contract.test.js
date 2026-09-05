// ============================================================
// C-13 · F-6 — a field on the wire is not a field the client has  (RED)
// ------------------------------------------------------------
// Measured on `ea07e13`:
//
//   agendaItem()      returns 11 fields, `decisionClass` among them
//   AgendaItemSchema  declares 10, WITHOUT `decisionClass`
//   useHome.js:44     setHome(parsed.data)
//
// `z.object()` strips unknown keys. So C-10's class — the whole point of that
// contract, shipped and content-verified — is deleted at the client boundary,
// and `decisionClassLabel` has zero consumers because the field it reads
// cannot arrive. The backend was right, the client was right, and the contract
// between them ate the value.
//
// This is C-04's defect exactly ("COMPLETENESS was eaten by a client zod schema,
// not a component"), recurring one contract later on a different field. Twice is
// a class, and a class gets a ratchet rather than a second point fix.
//
// ── WHY THIS TEST IS TEXT AND NOT AN IMPORT ─────────────────────────────────
//
// The schema is TypeScript and lives in the client package; the factory is
// backend JavaScript. Nothing in either suite naturally sees both, which is
// precisely how the two halves drifted. This test's whole reason to exist is to
// stand in the gap, so it reads the one it cannot import as text — deliberately,
// not for want of a better tool.
//
// The runtime half of the claim (a parse actually PRESERVES the fields) is
// asserted in the client suite, where the schema can be executed.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { agendaItem, AGENDA_BAND, AGENDA_TYPE } from './agenticTypes.js';

const SCHEMA_PATH = new URL(
  '../../../client/src/contracts/schemas/agenda.schema.ts',
  import.meta.url,
);

/** Every key the factory actually publishes — derived from the code, not a list. */
function publishedFields() {
  return Object.keys(agendaItem({
    id: 'x', band: AGENDA_BAND.BUYER, type: AGENDA_TYPE.VERDICT,
    title: 't', rationale: 'r',
  }));
}

/** The keys declared inside `AgendaItemSchema = z.object({ … })`. */
function declaredFields() {
  const src = readFileSync(SCHEMA_PATH, 'utf8');
  const block = src.match(/AgendaItemSchema\s*=\s*z\.object\(\{([\s\S]*?)\n\}\)/);
  if (!block) throw new Error('AgendaItemSchema z.object({…}) block not found — the ratchet cannot read its subject');
  // Key lines only: `name: …`. Comment lines are skipped rather than matched,
  // because this file documents its fields and a comment mentioning a field
  // must never be able to satisfy the assertion.
  return block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//'))
    .map((l) => l.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/)?.[1])
    .filter(Boolean);
}

describe('C-13 · F-6 — the agenda contract does not lose fields in transit', () => {
  it('T20 · every field the planner publishes is declared by the client schema', () => {
    const published = publishedFields();
    const declared  = new Set(declaredFields());
    const stripped  = published.filter((f) => !declared.has(f));
    expect(
      stripped,
      `these fields are published by agendaItem() and STRIPPED by AgendaItemSchema: ${stripped.join(', ')}`,
    ).toEqual([]);
  });

  it('T21 · the two fields this contract adds are declared', () => {
    // Named explicitly as well as covered by T20. T20 fails the day someone
    // adds a twelfth field; this fails if C-13's own two are ever removed from
    // the schema while remaining on the wire — the exact regression F-6 was.
    const declared = new Set(declaredFields());
    expect(declared.has('decisionClass')).toBe(true);
    expect(declared.has('subjectRef')).toBe(true);
  });

  it('T22 · the ratchet is non-vacuous — it can see a field that is missing', () => {
    // A parity test that cannot fail is a comment. This proves the reader works
    // by asking it about a field neither side has.
    const declared = new Set(declaredFields());
    expect(declared.has('aFieldNobodyDeclared')).toBe(false);
    expect(declaredFields().length).toBeGreaterThan(5);
  });
});
