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

  it('the orchestrator no longer reads ANY decision history — S1-B', () => {
    // This used to assert `getRecentDecisions(workspaceId, 3)` inside
    // runOrchestration: R7's proof that the canonical spine had replaced the
    // DecisionMemory read, rather than the read simply vanishing.
    //
    // S1-B removed runOrchestration entirely. It loaded a CampaignState row as
    // the SUBJECT of its analysis, and that table has had no writer since R7
    // deleted temporalObserver — so the function threw for every campaign in
    // every workspace, and the route above it 404'd before reaching it anyway.
    //
    // The R7 guarantee is unaffected and is asserted by the two tests around
    // this one: the canonical read still has exactly one definition, and the
    // sidebar route still calls it. What is gone is a second caller, not the
    // spine — so the assertion inverts rather than being deleted. Reinstating a
    // history read here would mean the orchestration came back with it.
    const src = codeOf(path.join(SRC, 'agents/orchestrator.js'));
    expect(src).not.toMatch(/getRecentDecisions/);
    expect(src).not.toMatch(/runOrchestration/);
    expect(src).not.toMatch(/campaignState/);
  });

  it('exactly ONE workspace-scoped recent-decision read exists', () => {
    // Two near-identical reads is how a second source of decision truth starts.
    // Every caller must share this one — after S1-B that is the sidebar route
    // and decisionHistory's own consumers, the orchestrator having dropped out.
    const defs = walk(SRC).filter((f) => /export (async )?function getRecentDecisions/.test(codeOf(f)));
    expect(defs.map((f) => path.relative(SRC, f).split(path.sep).join('/')))
      .toEqual(['services/decision-memory/decisionHistory.js']);
  });
});

describe('R7 — retained on purpose', () => {
  it('SC-3 · the DecisionMemory MODEL is gone — the decision someone made', () => {
    // This gate used to assert the opposite, on purpose: retire the code, keep
    // the table, and make any later cleanup a decision someone MAKES rather
    // than something that happens. SC-3 is that decision, and the evidence R7
    // said it lacked arrived as a direct production measurement — 0 rows, 0
    // workspaces, no earliest and no latest.
    //
    // The old comment here also carried a factual error worth correcting,
    // because it is what made this model look harder to remove than it was:
    // it said Workspace and ExecutionRequest "still declare FK relations to
    // it". Neither did. Both were Prisma BACK-relations, which have no
    // database column. Both physical foreign keys lived on decision_memory
    // itself — workspaceId -> workspaces and executionId -> execution_requests
    // — so dropping the table took them with it and execution_requests, a live
    // model, needed no DDL at all.
    const schema = readFileSync(fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url)), 'utf8');
    expect(schema).not.toMatch(/^model DecisionMemory \{/m);
    expect(schema).not.toMatch(/@@map\("decision_memory"\)/);

    // …and neither back-relation came back with it.
    const workspace = schema.match(/^model Workspace \{([\s\S]*?)^\}/m);
    const execution = schema.match(/^model ExecutionRequest \{([\s\S]*?)^\}/m);
    expect(workspace[1]).not.toMatch(/\bDecisionMemory\[\]/);
    expect(execution[1]).not.toMatch(/\bDecisionMemory\[\]/);
  });

  it('DecisionMemoryEntry survives — it has a real consumer', () => {
    // The naming-collision guard, and the reason SC-3 could not be a bare
    // grep. `DecisionMemory` and `DecisionMemoryEntry` differ by one word and
    // map to `decision_memory` and `decision_memory_entries`; only the first
    // was dead.
    const schema = readFileSync(fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url)), 'utf8');
    expect(schema).toMatch(/model DecisionMemoryEntry \{/);
    expect(schema).toMatch(/@@map\("decision_memory_entries"\)/);
    // The tested-dimension loop still reads it. See testMemoryContract.test.js.
    expect(offenders(SRC, /prisma\.decisionMemoryEntry\.findMany/).length).toBeGreaterThan(0);
  });
});
