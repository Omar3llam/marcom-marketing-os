// ============================================================
// Backend Closure SC-2 — the Action substrate has no storage left
// ============================================================
// R13-D retired the worker. B3-C retired the two routes that fed it. S1-B
// removed the feed and intelligence reads. Each of those slices ended with the
// same sentence: the MODEL stays, because removing it is a schema change this
// slice does not authorise. This is that change.
//
// WHAT MADE IT SAFE, and it is one measurement rather than an argument:
//
//     actions   0 rows · 0 workspaces · earliest null · latest null
//
// measured against production. Nothing to back up, migrate or archive. The
// migration says so in its own header so a future reader does not have to
// reconstruct why a table vanished with no data step.
//
// TWO READERS, NOT ONE
//   Every prior slice recorded that ONE reference survived — the `legacyActions`
//   row count on GET /api/lumi/_health. That was incomplete. The admin
//   workspace-delete route also counted the table, through
//   `_count: { select: DELETE_COUNTS } }` on the Workspace relation rather than
//   through `prisma.action`, so a delegate-level search never saw it. T4 below
//   scans for BOTH shapes, because the one that hid is the one that matters.
//
// ABSENT, NOT ZERO
//   Neither field was replaced. A count of a table that does not exist is not a
//   measurement, and `legacyActions: 0` would have been a fabricated one — the
//   more dangerous kind, because it looks like an answer. T5 asserts absence
//   specifically, and would fail on 0, on null and on an empty array alike.
//
// ActionType IS NOT ActionStatus
//   `ActionStatus` was the lifecycle of an Action row: PENDING → QUEUED →
//   EXECUTED_SUCCESS. It went with the model. `ActionType` names WHAT an
//   execution does — PAUSE_CAMPAIGN, SCALE_CAMPAIGN — is owned by
//   AuditLog.actionType, and is written on every execution request that reaches
//   routes/execution/meta.js. T6 exists because the two share a prefix and a
//   careless closure takes both.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The health route imports the execution queue. Redis is not the subject here,
// and the route already has a no-Redis branch, so it is pinned to that branch
// rather than left to depend on the environment the suite happens to run in.
vi.mock('../../queues/index.js', () => ({ executionQueue: null }));

const { healthRouter } = await import('./health.js');
const { prisma }       = await import('../../lib/prisma.js');

const ROOT   = process.cwd();
const SCHEMA = readFileSync(resolve(ROOT, 'prisma/schema.prisma'), 'utf8');
const MIGRATIONS = resolve(ROOT, 'prisma/migrations');
const SC2 = '20260823090000_sc2_action_closure';

// ── comment-stripped production source ──────────────────────────────────────
// Every assertion below is about what the code DOES. This file, the schema and
// the routes all explain the retirement by naming the things they forbid, and a
// scanner that could not tell prose from a call would score the explanation as
// the defect.
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

// ── T1 · T2 · T3 — the schema ───────────────────────────────────────────────
describe('SC-2 · the schema declares no Action substrate', () => {
  it('T1 · schema.prisma declares no Action model', () => {
    expect(SCHEMA).not.toMatch(/^model Action \{/m);
  });

  it('T2 · schema.prisma declares no ActionStatus enum', () => {
    expect(SCHEMA).not.toMatch(/^enum ActionStatus \{/m);
  });

  it('T3 · Workspace no longer owns the relation', () => {
    // Scoped to the Workspace block on purpose, and asserted separately from
    // T1. A repo-wide grep would also pass if the field had merely moved to
    // another model, which is not the guarantee — the relation is removed, not
    // relocated — and a model-only removal must not be able to satisfy this.
    const workspace = SCHEMA.match(/^model Workspace \{([\s\S]*?)^\}/m);
    expect(workspace, 'model Workspace not found').not.toBeNull();
    expect(workspace[1]).not.toMatch(/\bactions\b/);
    expect(workspace[1]).not.toMatch(/\bAction\[\]/);
  });

  it('the generated client exposes no action delegate', () => {
    // The schema and the client can disagree. A stale `prisma generate` is
    // exactly how a removed model keeps working locally for another week.
    expect(prisma.action).toBeUndefined();
  });

  it('AuditLog keeps its actionId column, and loses only the relation', () => {
    // The one dependency the closure could not avoid, and the line where it
    // stopped. `audit_logs.actionId` was the FK to Action; production was
    // measured for `actions`, NOT for how many audit rows carry a non-null
    // actionId, so the COLUMN stays and only the constraint goes. Nothing has
    // ever written it — all three auditLog.create calls in execution/meta.js
    // omit it — but "nothing writes it" is not the same evidence as "no row
    // holds one", and this slice does not have the second.
    const audit = SCHEMA.match(/^model AuditLog \{([\s\S]*?)^\}/m);
    expect(audit, 'model AuditLog not found').not.toBeNull();
    expect(audit[1]).toMatch(/actionId\s+String\?/);
    expect(audit[1]).not.toMatch(/action\s+Action\?/);
  });
});

// ── T4 — the runtime ────────────────────────────────────────────────────────
describe('SC-2 · no production code reads or writes Action', () => {
  it('T4a · no production file touches the prisma.action delegate', () => {
    expect(
      filesMatching(/(?:prisma|tx|db)\.action\./),
      'A production Action delegate access came back. The model no longer exists, '
      + 'so this cannot be a read of real rows — remove it rather than adding a '
      + 'fallback, and do not replace the value with 0.',
    ).toEqual([]);
  });

  it('T4b · and no production file counts it through the Workspace relation', () => {
    // The shape that hid from every previous census. `_count: { actions: true }`
    // reads the same table without ever naming `prisma.action`, which is why the
    // admin delete route survived three retirement slices unnoticed.
    expect(filesMatching(/\bactions:\s*true\b/)).toEqual([]);
    expect(filesMatching(/_count[\s\S]{0,200}?\bactions\b\s*:/)).toEqual([]);
  });

  it('T4c · the health route neither counts nor publishes it', () => {
    const health = code.get('src/routes/lumi/health.js');
    expect(health, 'health.js not found in the production scan').toBeDefined();
    expect(health).not.toMatch(/prisma/);
    expect(health).not.toMatch(/legacyActions/);
  });

  it('T4d · no production file names the retired ActionStatus enum', () => {
    // ActionType is deliberately not matched here: `\b` on both sides so the
    // longer, live enum name is not swept up with the dead one.
    expect(filesMatching(/\bActionStatus\b/)).toEqual([]);
  });
});

// ── T5 — the live response ──────────────────────────────────────────────────
describe('SC-2 · GET /api/lumi/_health answers without the field', () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/lumi', healthRouter);
    return a;
  };

  it('T5 · the Action-derived field is ABSENT — not 0, not null, not empty', () => {
    // Four separate failures, because three of them would look like a fix.
    return request(app()).get('/api/lumi/_health').then(({ status, body }) => {
      expect(status).toBe(200);
      expect(Object.keys(body)).not.toContain('legacyActions');
      expect('legacyActions' in body).toBe(false);
      expect(body.legacyActions).toBeUndefined();
      // …and no differently-named stand-in appeared in its place.
      const actionish = Object.keys(body).filter((k) => /action/i.test(k));
      expect(actionish, `a replacement field appeared: ${actionish}`).toEqual([]);
    });
  });

  it('the rest of the endpoint is untouched — this removed a field, not a route', () => {
    return request(app()).get('/api/lumi/_health').then(({ status, body }) => {
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.queue).toEqual({ disabled: true, reason: 'REDIS_URL not configured' });
      expect(typeof body.timestamp).toBe('string');
    });
  });
});

// ── T6 — the survivor ───────────────────────────────────────────────────────
describe('SC-2 · ActionType survives, with its live owner', () => {
  it('T6 · the enum is still declared, with all ten labels in order', () => {
    const block = SCHEMA.match(/^enum ActionType \{([\s\S]*?)^\}/m);
    expect(block, 'enum ActionType was removed with ActionStatus').not.toBeNull();
    const labels = block[1].split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//'));
    expect(labels).toEqual([
      'PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'INCREASE_BUDGET', 'DECREASE_BUDGET',
      'PAUSE_ADSET', 'RESUME_ADSET', 'SCALE_CAMPAIGN', 'OPTIMIZE_CAMPAIGN',
      'REALLOCATE_BUDGET', 'REFRESH_CREATIVE',
    ]);
  });

  it('T6b · and it is still owned by a model something writes', () => {
    // Surviving in the schema is not enough — a retained enum with no live
    // owner is the next slice's corpse. AuditLog.actionType is written on every
    // execution request, including both failure paths.
    const audit = SCHEMA.match(/^model AuditLog \{([\s\S]*?)^\}/m);
    expect(audit[1]).toMatch(/actionType\s+ActionType/);
    expect(filesMatching(/prisma\.auditLog\.create/))
      .toContain('src/routes/execution/meta.js');
  });
});

// ── T7 — the migration ──────────────────────────────────────────────────────
describe('SC-2 · the migration is scoped to the closure', () => {
  const sql = () => {
    const p = join(MIGRATIONS, SC2, 'migration.sql');
    expect(existsSync(p), `${SC2} is missing`).toBe(true);
    return readFileSync(p, 'utf8')
      .split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');
  };

  it('T7 · it drops the table, the enum, and the constraint that blocked them', () => {
    const s = sql();
    expect(s).toMatch(/DROP TABLE IF EXISTS "actions"/);
    expect(s).toMatch(/DROP TYPE IF EXISTS "ActionStatus"/);
    // The FK is dropped because Postgres refuses DROP TABLE while a constraint
    // depends on it — not because audit_logs is changing shape.
    expect(s).toMatch(/ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actionId_fkey"/);
  });

  it('T7b · and it does nothing else', () => {
    // The control that matters. `prisma migrate dev --create-only` generated
    // EIGHTEEN statements for this change: five FK drops, three dropped column
    // defaults, four indexes on `decisions`, three FK re-adds and an index
    // rename. Regenerating from unmodified master produced sixteen of them and
    // none of the Action lines, which is how they were identified as
    // pre-existing history-vs-schema drift rather than part of this slice.
    //
    // One of those eighteen would have done real damage: a plain CREATE INDEX
    // for decisions_similarity_idx, which 20260820100000 deploys WITH a partial
    // predicate that @@index cannot express. Accepting it would have silently
    // replaced C1's learning-eligibility index with a full-table one.
    const statements = sql().split(';').map((x) => x.trim()).filter(Boolean);
    expect(statements).toHaveLength(3);

    for (const forbidden of [
      /"oauth_tokens"/, /"users"/, /"decisions"/, /"execution_requests"/,
      /"workspaces"/, /"provider_performance_metrics"/,
      /CREATE INDEX/i, /RENAME/i, /DROP DEFAULT/i, /ADD CONSTRAINT/i,
    ]) {
      expect(sql(), `SC-2 migration touches ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('T7c · and it never edits the history that created the table', () => {
    const creators = readdirSync(MIGRATIONS)
      .filter((d) => existsSync(join(MIGRATIONS, d, 'migration.sql')))
      .filter((d) => /CREATE TABLE[^;]*"actions"/i.test(readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8')));
    expect(creators.length, 'history stopped creating `actions` — it was edited').toBeGreaterThan(0);
  });
});
