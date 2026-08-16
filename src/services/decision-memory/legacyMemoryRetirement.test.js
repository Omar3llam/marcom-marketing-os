// ============================================================
// R7 — the retirement sweep: no legacy memory path can reach a user
// ------------------------------------------------------------
// The behavioural tests prove each migrated consumer reads the canonical spine.
// This one proves the RETIRED paths are actually gone — a distinction that
// matters, because every defect R7 removed was invisible to behavioural tests:
//
//   • temporalObserver's write was covered by a test that mocked the whole
//     Prisma client, so it asserted "3 correct DecisionMemory rows" against a
//     mock that accepts any field. The columns had not existed for months.
//   • feed.js consumed `mem.campaignId` on a table with no campaignId. The
//     QUERY was valid, so nothing threw and no test noticed; the field access
//     was wrong and every campaign silently carried an empty memory array.
//   • the sidebar's fabricated verdicts passed their own unit test, which
//     asserted the fabrication was correct.
//
// A grep is the only kind of test that would have caught any of them.
//
// SCOPE: `decision_memory` (the retired table). NOT `DecisionMemoryEntry`,
// which is a different table with a real, load-bearing consumer — the
// tested-dimension loop pinned in testMemoryContract.test.js.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = fileURLToPath(new URL('../..', import.meta.url));          // src/
const CLIENT = fileURLToPath(new URL('../../../client/src', import.meta.url));

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
  return /\.(js|jsx)$/.test(e.name) && !e.name.includes('.test.') ? [full] : [];
});

// Comments are stripped first. This file's own retirement notes name the very
// paths it forbids — as do the explanatory comments left at each removal site,
// which are the record of WHY the code went. A scanner that cannot tell prose
// from a call would force us to delete the explanation to satisfy the guard.
const codeOf = (f) => readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const offenders = (root, pattern) => walk(root)
  .filter((f) => pattern.test(codeOf(f)))
  .map((f) => path.relative(root, f).split(path.sep).join('/'));

describe('R7 — the retired DecisionMemory table has no live code path', () => {
  it('no backend file queries prisma.decisionMemory', () => {
    // `\b` after the model name so decisionMemoryEntry — a DIFFERENT, retained
    // table — is not swept up with it.
    expect(offenders(SRC, /prisma\.decisionMemory\b(?!Entry)/)).toEqual([]);
  });

  it('no backend file imports the retired service or serializer', () => {
    expect(offenders(SRC, /DecisionMemoryService|memorySerializer|serializeMemoryPayload|recordDecisionMemory|getRecentMemories/))
      .toEqual([]);
  });

  it('no backend file mounts or references the retired endpoints', () => {
    expect(offenders(SRC, /['"`]\/api\/(memory|decision-memory)\b/)).toEqual([]);
  });

  it('no client file calls the retired endpoints', () => {
    expect(offenders(CLIENT, /['"`]\/api\/(memory|decision-memory)\b/)).toEqual([]);
  });

  it('no file reads the Shape-B columns that never existed', () => {
    // campaignId / decisionRationale / deltaCtr / deltaRoas / resultStatus on a
    // decision-memory row. These are the field accesses that failed silently:
    // valid queries, wrong columns, empty results nobody attributed to a bug.
    const shapeB = /\bmem\.(campaignId|decisionRationale|deltaCtr|deltaRoas|resultStatus|impactDurationHrs|isSustainable)\b/;
    expect(offenders(SRC, shapeB)).toEqual([]);
    expect(offenders(CLIENT, shapeB)).toEqual([]);
  });

  it('the temporal observer is gone, and nothing tries to start it', () => {
    expect(offenders(SRC, /temporalObserver|startObserverWorker|runObserverSweep/)).toEqual([]);
  });
});

describe('R7 — the canonical spine is what replaced it', () => {
  it('the sidebar surface exists on the decisions router', () => {
    const src = readFileSync(path.join(SRC, 'routes/lumi/decisions.js'), 'utf8');
    expect(src).toMatch(/decisionsRouter\.get\('\/decisions\/recent'/);
    expect(src).toMatch(/getRecentDecisions/);
  });

  it('the orchestrator reads canonical decisions', () => {
    const src = codeOf(path.join(SRC, 'agents/orchestrator.js'));
    expect(src).toMatch(/getRecentDecisions\(workspaceId, 3\)/);
    // …and not with an entity predicate bolted on: CampaignState.campaignId is
    // a legacy String and Decision.entityId is a uuid, so scoping this read by
    // campaign returns nothing, quietly.
    expect(src).not.toMatch(/getRecentDecisions\([^)]*campaignId/);
  });

  it('exactly ONE workspace-scoped recent-decision read exists', () => {
    // Two near-identical reads is how a second source of decision truth starts.
    // The route and the orchestrator must share this one.
    const defs = walk(SRC).filter((f) => /export (async )?function getRecentDecisions/.test(codeOf(f)));
    expect(defs.map((f) => path.relative(SRC, f).split(path.sep).join('/')))
      .toEqual(['services/decision-memory/decisionHistory.js']);
  });
});

describe('R7 — retained on purpose', () => {
  it('the DecisionMemory MODEL stays in the schema — residue, not a code path', () => {
    // Ruled explicitly: retire the code, keep the table. Workspace and
    // ExecutionRequest still declare FK relations to it, and dropping it is a
    // migration R7 has no evidence it needs. Asserted so a later cleanup is a
    // decision someone makes, not something that happens.
    const schema = readFileSync(fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url)), 'utf8');
    expect(schema).toMatch(/model DecisionMemory \{/);
    expect(schema).toMatch(/@@map\("decision_memory"\)/);
  });

  it('DecisionMemoryEntry survives — it has a real consumer', () => {
    const schema = readFileSync(fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url)), 'utf8');
    expect(schema).toMatch(/model DecisionMemoryEntry \{/);
    // The tested-dimension loop still reads it. See testMemoryContract.test.js.
    expect(offenders(SRC, /prisma\.decisionMemoryEntry\.findMany/).length).toBeGreaterThan(0);
  });
});
