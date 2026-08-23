// ============================================================
// Backend Closure SC-3 — the DecisionMemory model has no storage left
// ============================================================
// R7 retired the code: DecisionMemoryService, memorySerializer, the two
// endpoints, and temporalObserver — the writer. It kept the table, explicitly,
// so that removing it would be a decision someone MADE rather than something
// that happened. This is that decision, and the evidence R7 said it lacked
// arrived as a direct production measurement:
//
//     decision_memory   0 rows · 0 workspaces · earliest null · latest null
//
// TWO MODELS, ONE WORD APART
//   `DecisionMemory`      -> decision_memory          DEAD, removed here
//   `DecisionMemoryEntry` -> decision_memory_entries  LIVE, read by the
//                                                     tested-dimension loop
//   Every pattern in this file carries an explicit guard so the second is never
//   swept up with the first. T6 asserts the survivor directly, in the schema
//   AND in the database, because a closure that took both would look identical
//   in a diff that only checked the dead one was gone.
//
// THE RELATION RAN THE OTHER WAY, AND IT MATTERED
//   The plan for this slice expected `ExecutionRequest.decisionMemory` to be a
//   nullable FK on a LIVE table, which would have made this a schema-shape
//   change to execution_requests and required a production count of that
//   column's non-null values before anything could be dropped.
//
//   It is not. Both models declared BACK-relations, which have no database
//   column, and both physical foreign keys lived on decision_memory itself:
//
//       decision_memory.workspaceId  -> workspaces(id)        ON DELETE CASCADE
//       decision_memory.executionId  -> execution_requests(id) ON DELETE CASCADE
//
//   Nothing in the database referenced decision_memory — `pg_constraint` where
//   `confrelid` is that table returns nothing — so DROP TABLE takes both keys,
//   the primary key and three indexes with it, and execution_requests needs no
//   DDL at all. T5 asserts that absence against the real database rather than
//   against schema text, because "there is no column" is exactly the kind of
//   claim that must be measured rather than reasoned about.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const { dbAvailable } = await import('../../tests/dbProbe.js');
const { prisma }      = await import('../../lib/prisma.js');

const DB_OK  = await dbAvailable();
const ROOT   = process.cwd();
const SCHEMA = readFileSync(resolve(ROOT, 'prisma/schema.prisma'), 'utf8');
const MIGRATIONS = resolve(ROOT, 'prisma/migrations');
const SC3 = '20260823100000_sc3_decisionmemory_closure';

// ── comment-stripped production source ──────────────────────────────────────
// This file, the schema and the removal sites all explain the retirement by
// naming what they forbid. A scanner that could not tell prose from a call
// would score the explanation as the defect.
const strip = (s) => s
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

function productionFiles(dir = resolve(ROOT, 'src'), out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { productionFiles(full, out); continue; }
    if (!entry.endsWith('.js') || entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

const code = new Map(productionFiles().map((f) => [
  f.split(/[\\/]/).join('/').replace(/^.*\/src\//, 'src/'),
  strip(readFileSync(f, 'utf8')),
]));
const filesMatching = (re) => [...code.entries()]
  .filter(([, c]) => re.test(c)).map(([f]) => f).sort();

const modelBlock = (name) => {
  const m = SCHEMA.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm'));
  return m ? m[1] : null;
};

// ── T1 · T2 · T3 — the schema ───────────────────────────────────────────────
describe('SC-3 · the schema declares no DecisionMemory', () => {
  it('T1 · the model is gone', () => {
    // `\b(?!Entry)` throughout: DecisionMemoryEntry must not satisfy this.
    expect(SCHEMA).not.toMatch(/^model DecisionMemory \{/m);
    expect(SCHEMA).not.toMatch(/@@map\("decision_memory"\)/);
  });

  it('T2 · Workspace no longer declares the back-relation', () => {
    const workspace = modelBlock('Workspace');
    expect(workspace, 'model Workspace not found').not.toBeNull();
    expect(workspace).not.toMatch(/\bDecisionMemory\[\]/);
    // …and the LIVE sibling relation is still there, in the same block, so a
    // careless removal of both cannot pass this test.
    expect(workspace).toMatch(/decisionMemoryEntries\s+DecisionMemoryEntry\[\]/);
  });

  it('T3 · ExecutionRequest no longer declares the virtual back-relation', () => {
    // Asserted separately from T1 on purpose. This is a Prisma-level relation
    // with NO backing column, so nothing in the database can prove it gone —
    // only the schema can, and a model-only removal must not satisfy it.
    const execution = modelBlock('ExecutionRequest');
    expect(execution, 'model ExecutionRequest not found').not.toBeNull();
    expect(execution).not.toMatch(/\bdecisionMemory\b/);
    expect(execution).not.toMatch(/\bDecisionMemory\[\]/);
    // The live model itself is untouched: its own relations still stand.
    expect(execution).toMatch(/transitions\s+ExecutionTransition\[\]/);
    expect(execution).toMatch(/metrics\s+ExecutionMetric\[\]/);
  });

  it('the generated client exposes no decisionMemory delegate', () => {
    // Schema and client can disagree. A stale `prisma generate` is how a
    // removed model keeps working locally for another week.
    expect(prisma.decisionMemory).toBeUndefined();
    // …and the live delegate one word away is still there.
    expect(typeof prisma.decisionMemoryEntry?.findMany).toBe('function');
  });
});

// ── T7 — the runtime ────────────────────────────────────────────────────────
describe('SC-3 · no production code reads or writes DecisionMemory', () => {
  it('T7a · no production file touches the prisma.decisionMemory delegate', () => {
    expect(
      filesMatching(/(?:prisma|tx|db)\.decisionMemory\b(?!Entry)/),
      'A production DecisionMemory delegate access came back. The model no longer '
      + 'exists, so this cannot be a read of real rows — remove it rather than '
      + 'adding a fallback.',
    ).toEqual([]);
  });

  it('T7b · and none traverses it as a relation', () => {
    // The shape that hid an Action reader through three slices: a `_count` or
    // include/select on the Workspace/ExecutionRequest side, which never names
    // `prisma.decisionMemory` at all.
    expect(filesMatching(/\bdecisionMemory\b(?!Entry)\s*:/)).toEqual([]);
    expect(filesMatching(/\.\s*decisionMemory\b(?!Entry)/)).toEqual([]);
  });

  it('T7c · no production file names the model or its table', () => {
    expect(filesMatching(/\bDecisionMemory\b(?!Entry)/)).toEqual([]);
    expect(filesMatching(/\bdecision_memory\b(?!_entries)/)).toEqual([]);
  });

  it('T7d · and the phantom FK column is still a phantom', () => {
    // `decisionMemoryId` never existed — not in the schema, not in migration
    // history, not in a migration-built database. Pinned so a future slice does
    // not reintroduce the shape this one proved absent.
    expect(filesMatching(/\bdecisionMemoryId\b/)).toEqual([]);
    expect(SCHEMA).not.toMatch(/\bdecisionMemoryId\b/);
  });

  it('the decision-memory directory is the decision SPINE, not this model', () => {
    // The directory name is historical and is the reason a name-based census
    // would misclassify it. Everything in it reads `decisions`.
    for (const f of ['src/services/decision-memory/decisionHistory.js',
      'src/services/decision-memory/humanJudgment.js']) {
      expect(code.get(f), `${f} missing`).toBeDefined();
      expect(code.get(f)).toMatch(/prisma\.decision\.(findMany|findFirst|update|groupBy)/);
      expect(code.get(f)).not.toMatch(/prisma\.decisionMemory\b(?!Entry)/);
    }
  });
});

// ── T4 · T5 · T6 — the real database ────────────────────────────────────────
describe.skipIf(!DB_OK)('SC-3 · and the database agrees', () => {
  it('T4 · decision_memory does not exist', async () => {
    const rows = await prisma.$queryRaw`
      SELECT table_name::text AS t FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'decision_memory'`;
    expect(rows).toEqual([]);
  });

  it('T5 · execution_requests carries no decisionMemory column, and never did', async () => {
    // The central claim of this slice, measured rather than reasoned about.
    // Its fifteen columns are asserted whole: a DROP COLUMN that "tidied up"
    // the live table would fail here even if it removed something else.
    const cols = await prisma.$queryRaw`
      SELECT column_name::text AS c FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'execution_requests'
       ORDER BY ordinal_position`;
    const names = cols.map((r) => r.c);
    expect(names.filter((c) => /decisionmemory/i.test(c))).toEqual([]);
    expect(names).toEqual([
      'id', 'workspaceId', 'idempotencyKey', 'actionType', 'targetId', 'status',
      'payload', 'response', 'createdAt', 'updatedAt', 'version', 'correlationId',
      'activeStep', 'retryMetadata', 'decisionId',
    ]);
  });

  it('T6 · decision_memory_entries survives, with its columns intact', async () => {
    // The naming-collision guard at the storage layer. One word apart, and only
    // one of them was dead.
    const rows = await prisma.$queryRaw`
      SELECT table_name::text AS t FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'decision_memory_entries'`;
    expect(rows).toHaveLength(1);

    const cols = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'decision_memory_entries'`;
    expect(cols[0].n).toBeGreaterThan(0);
  });

  it('the drop took nothing with it — the live neighbours are all still there', async () => {
    const rows = await prisma.$queryRaw`
      SELECT table_name::text AS t FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('workspaces','execution_requests','decisions',
                            'audit_logs','oauth_tokens','decision_memory_entries')`;
    expect(rows.map((r) => r.t).sort()).toEqual([
      'audit_logs', 'decision_memory_entries', 'decisions',
      'execution_requests', 'oauth_tokens', 'workspaces',
    ]);
  });

  it('and the partial similarity index survived the migration untouched', async () => {
    // The specific casualty of accepting a Prisma-generated migration here:
    // 20260820100000 deploys this index WITH a predicate `@@index` cannot
    // express, so every generated migration proposes recreating it full-table.
    const rows = await prisma.$queryRaw`
      SELECT indexdef::text AS def FROM pg_indexes
       WHERE indexname = 'decisions_similarity_idx'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/WHERE/);
    expect(rows[0].def).toMatch(/resolution IS NOT NULL/);
  });
});

// ── T8 — the migration ──────────────────────────────────────────────────────
describe('SC-3 · the migration is scoped to the closure', () => {
  const sql = () => {
    const p = join(MIGRATIONS, SC3, 'migration.sql');
    expect(existsSync(p), `${SC3} is missing`).toBe(true);
    return readFileSync(p, 'utf8')
      .split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
  };

  it('T8 · it is exactly one statement, and that statement is the table drop', () => {
    const statements = sql().split(';').map((x) => x.trim()).filter(Boolean);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^DROP TABLE IF EXISTS "decision_memory"$/);
  });

  it('T8b · and it touches nothing else — least of all execution_requests', () => {
    // `prisma migrate dev --create-only` generated EIGHTEEN statements for this
    // change. Regenerating from unmodified master produced FOURTEEN of them and
    // none of the DecisionMemory lines, which is how they were identified as
    // pre-existing history-vs-schema drift rather than part of this slice.
    //
    // The three that were mine were a DROP TABLE and two DROP CONSTRAINTs — and
    // those two constraints belong to the table being dropped, so they are
    // redundant. One statement is the whole slice.
    for (const forbidden of [
      /"execution_requests"/, /"workspaces"/, /"users"/, /"oauth_tokens"/,
      /"audit_logs"/, /"decisions"/, /"provider_performance_metrics"/,
      /decision_memory_entries/,
      /ALTER TABLE/i, /DROP COLUMN/i, /CREATE INDEX/i, /RENAME/i,
      /DROP DEFAULT/i, /ADD CONSTRAINT/i, /DROP CONSTRAINT/i, /CASCADE/i,
    ]) {
      expect(sql(), `SC-3 migration matches ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('T8c · and it never edits the history that created the table', () => {
    const creators = readdirSync(MIGRATIONS)
      .filter((d) => existsSync(join(MIGRATIONS, d, 'migration.sql')))
      .filter((d) => /CREATE TABLE[^;]*"decision_memory"[^_]/i
        .test(readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8')));
    expect(creators.length, 'history stopped creating decision_memory — it was edited')
      .toBeGreaterThan(0);
  });
});
