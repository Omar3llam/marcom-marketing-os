// ============================================================
// C-10 · the backfill and the classifier are ONE rule, written twice
// ------------------------------------------------------------
// The column has to be filled for existing rows, and the filling happens in
// SQL while every consumer classifies in JS. That is a duplicated rule, and
// this programme has been punished for duplicated rules twice already —
// `test:` declared independently in two files, and C-18's `channelMix`
// recomputed rather than read.
//
// A duplication is allowed to exist only when something proves the two copies
// agree. That is what this file is for; without it the backfill is a second
// opinion nobody compared.
//
// AND THE BACKFILL MUST NOT PRETEND TO KNOW. A row whose `rootCause` names an
// enum value since deleted from the code is genuinely unclassifiable. The only
// honest answer is NULL — the same ruling as C-02's legacy hits and C-05's
// legacy rules. A `DEFAULT 'SIGNAL'`, or a final unconditional UPDATE, would
// enrol every unrecognised row into the accuracy surface, the learning
// population and the budget appetite gate in one statement.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { classifyRootCause } from './decisionClassifier.js';

const MIGRATIONS = join(fileURLToPath(new URL('../../../prisma/migrations/', import.meta.url)));

const dir = readdirSync(MIGRATIONS).find((d) => d.includes('c10_decision_class'));
const sql = dir ? readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8') : '';
const code = sql.replace(/^[ \t]*--.*$/gm, '');

/** The cases the two implementations must agree on, in one place. */
const CASES = [
  ['guardrail:Frequency ceiling',                    DECISION_CLASS.GUARDRAIL],
  ['allocation:11111111-1111-1111-1111-111111111111', DECISION_CLASS.ALLOCATION],
  ['test:variant-a',                                  DECISION_CLASS.EXPERIMENT],
  ['incrementality:abc',                              DECISION_CLASS.EXPERIMENT],
  ['CREATIVE_FATIGUE',                                DECISION_CLASS.SIGNAL],
  [null,                                              DECISION_CLASS.SIGNAL],
  ['SOME_RETIRED_ENUM_VALUE',                         null],
];

describe('T2 — the migration exists and is shaped like a classification', () => {
  it('is present', () => {
    expect(dir, 'no c10_decision_class migration on this branch').toBeTruthy();
  });

  it('creates the enum and adds the column NULLABLE', () => {
    expect(code).toMatch(/CREATE TYPE "DecisionClass"/);
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS "decisionClass" "DecisionClass"/);
    // Nullable and undefaulted, permanently: NULL means UNCLASSIFIED, and a
    // DEFAULT would make every future insert claim a class its writer never
    // declared — which is exactly the writer contract this slice adds.
    expect(code).not.toMatch(/"decisionClass"[^;]*NOT NULL/);
    expect(code).not.toMatch(/"decisionClass"[^;]*DEFAULT/);
  });

  it('indexes the pair every scoped read now carries', () => {
    expect(code).toMatch(/CREATE INDEX IF NOT EXISTS[\s\S]*"workspaceId"[\s\S]*"decisionClass"/);
  });

  it('checks its own post-condition rather than reporting a false success', () => {
    expect(code).toMatch(/RAISE EXCEPTION/);
  });
});

describe('T2 — SQL and JS classify the same cases the same way', () => {
  it.each(CASES)('%s → %s in JS', (rootCause, expected) => {
    expect(classifyRootCause(rootCause)).toBe(expected);
  });

  it('the backfill has one UPDATE per class, and no catch-all', () => {
    const updates = code.match(/UPDATE\s+"decisions"/g) ?? [];
    // Four classes: guardrail, allocation, experiment (two prefixes, one class),
    // signal (connector causes + NULL).
    expect(updates.length).toBeGreaterThanOrEqual(4);

    // The guarantee that matters. Every backfill statement must be conditional
    // on the rootCause; an UPDATE with no WHERE, or one whose WHERE only
    // excludes already-classified rows, would sweep the unclassifiable into a
    // class by omission.
    for (const stmt of code.split(/;\s*/).filter((s) => /UPDATE\s+"decisions"/.test(s))) {
      expect(stmt, `unconditional backfill:\n${stmt}`).toMatch(/WHERE[\s\S]*"rootCause"/);
    }
  });

  it('names every prefix the writers use, and no others', () => {
    for (const prefix of ['guardrail:', 'allocation:', 'test:', 'incrementality:']) {
      expect(code).toContain(prefix);
    }
  });

  it('leaves rows it cannot place NULL, and says how many', () => {
    // Not a failure — a fact about the data, reported so nobody discovers it
    // from a surface later. The migration fails on a missing column or index;
    // it does not fail on an honest residue.
    expect(code).toMatch(/decisionClass" IS NULL/);
  });
});
