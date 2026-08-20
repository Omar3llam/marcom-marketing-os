// ============================================================
// Schema / migration contract controls (R12-1c)
// ============================================================
// Why this file lives in src/utils and not src/tests:
//
// The backend CI job runs `vitest run src/services src/routes src/utils
// packages/runtime-contracts`. src/tests is excluded, so a control placed
// there would never execute and would prove nothing. It sits here for the
// same reason the CI-coverage guard does — a guard CI does not run is not a
// guard.
//
// What it protects, and why each control exists:
//
// R12-1c established that production had drifted AHEAD of its own migration
// history — seven enums created, seven columns converted TEXT -> enum, six
// FKs given ON UPDATE CASCADE, and one FK silently removed — none of which
// any migration performs. The most consistent explanation is a `prisma db
// push` against production, which reconciles the database to schema.prisma
// and leaves no trace in _prisma_migrations.
//
// The danger that follows is specific: `prisma migrate diff` compares
// migration history to schema and therefore proposes re-creating structures
// production already has. Applying that generated SQL would be destructive
// (DROP COLUMN on populated enum columns) and would fail on the first
// unguarded CREATE TYPE. These controls make that class of mistake fail in
// CI rather than on a Render deploy.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAvailable } from '../tests/dbProbe.js';
import { prisma } from '../lib/prisma.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations');

/** The body of one `model X { ... }` block, comments stripped. */
function model(name) {
  const m = SCHEMA.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm'));
  if (!m) throw new Error(`model ${name} not found in schema.prisma`);
  return m[1].split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
}

/** Every migration.sql in the repository, comments stripped. */
function migrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((d) => fs.existsSync(path.join(MIGRATIONS_DIR, d, 'migration.sql')))
    .map((d) => ({
      name: d,
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8')
        .split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n'),
    }));
}

const NEW_MIGRATION = '20260818030000_r12_1c_execution_request_workspace_fk';

// The seven enums, in the exact order schema.prisma declares them. Production
// was audited read-only and carries precisely these labels in this order.
const CANONICAL_ENUMS = {
  UserRole: ['ADMIN', 'VIEWER'],
  ActionStatus: ['PENDING', 'QUEUED', 'EXECUTED_SUCCESS', 'FAILED', 'ROLLED_BACK'],
  ExecutionStatus: ['SUCCESS', 'FAILED', 'PENDING', 'PAUSED_FOR_APPROVAL', 'RESUMING', 'RESUMED'],
  ActionType: ['PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'INCREASE_BUDGET', 'DECREASE_BUDGET',
    'PAUSE_ADSET', 'RESUME_ADSET', 'SCALE_CAMPAIGN', 'OPTIMIZE_CAMPAIGN',
    'REALLOCATE_BUDGET', 'REFRESH_CREATIVE'],
  CampaignStage: ['TESTING', 'SCALING', 'STABLE', 'FATIGUED', 'DYING'],
  WebhookProvider: ['META', 'GOOGLE'],
  WebhookStatus: ['RECEIVED', 'PROCESSED', 'DUPLICATE', 'FAILED'],
};

// ============================================================
// Schema declarations — the contract as written
// ============================================================
describe('schema contract — ExecutionRequest owns its workspace', () => {
  it('declares the Workspace relation on the existing workspaceId column (M1)', () => {
    const body = model('ExecutionRequest');
    expect(body).toMatch(/workspace\s+Workspace\s+@relation\(/);
    expect(body).toMatch(/fields:\s*\[workspaceId\]/);
    expect(body).toMatch(/references:\s*\[id\]/);
    // Cascade on delete matches every sibling workspace-owned table; cascade on
    // update is what the deployed FKs already carry, stated rather than implied.
    expect(body).toMatch(/onDelete:\s*Cascade/);
    expect(body).toMatch(/onUpdate:\s*Cascade/);
  });

  it('keeps the R11 workspace-scoped idempotency key (NC-R12C-4)', () => {
    // The reason the missing FK mattered: workspaceId carries a tenant-isolation
    // guarantee, so it must stay part of the uniqueness tuple.
    expect(model('ExecutionRequest')).toMatch(/@@unique\(\[workspaceId,\s*idempotencyKey\]\)/);
  });

  it('gives Workspace the back-reference the relation requires', () => {
    expect(model('Workspace')).toMatch(/executionRequests\s+ExecutionRequest\[\]/);
  });
});

describe('schema contract — indexes name the objects that are actually deployed', () => {
  it('maps the decisions similarity index to its deployed name (M5)', () => {
    // Deployed by 20260731000000 as decisions_similarity_idx WITH a partial
    // predicate Prisma cannot express. Without the map, `migrate diff` proposes
    // a second, plain, full-table index under a generated name — a redundant
    // duplicate of one that already serves the query.
    expect(model('Decision')).toMatch(
      /@@index\(\[workspaceId,\s*verdict,\s*rootCause,\s*channel\],\s*map:\s*"decisions_similarity_idx"\)/,
    );
  });

  it('maps the metric snapshot identity key to its deployed name (M6)', () => {
    expect(model('MetricSnapshot')).toMatch(/map:\s*"metric_snapshots_identity_key"/);
  });

  it('leaves R9 canonical snapshot uniqueness exactly as it was (NC-R12C-5)', () => {
    // Name-only reconciliation. The columns, their order, and the absence of
    // workspaceId are the R9 contract and must not move.
    const uniq = model('MetricSnapshot').match(/@@unique\(\[([^\]]+)\]/);
    expect(uniq).not.toBeNull();
    expect(uniq[1].split(',').map((s) => s.trim())).toEqual([
      'entityId', 'entityLevel', 'date', 'granularity', 'source', 'measurementWindow',
    ]);
  });
});

// ============================================================
// Migration safety — what may never be generated into history
// ============================================================
describe('migration safety — production is canonical, history catches up to it', () => {
  it('ships the ExecutionRequest FK repair as an additive migration (M2)', () => {
    const m = migrations().find((x) => x.name === NEW_MIGRATION);
    expect(m, `${NEW_MIGRATION} is missing`).toBeDefined();
    expect(m.sql).toMatch(/ADD CONSTRAINT\s+"execution_requests_workspaceId_fkey"/);
    expect(m.sql).toMatch(/REFERENCES\s+"workspaces"\("id"\)/);
    // Idempotent: a no-op on every fresh database, where the 2026-05 migrations
    // already created it. Only production is actually missing it.
    expect(m.sql).toMatch(/IF NOT EXISTS/);
  });

  it('adds nothing destructive in that migration (M4)', () => {
    const { sql } = migrations().find((x) => x.name === NEW_MIGRATION);
    for (const forbidden of [/DROP COLUMN/i, /DROP CONSTRAINT/i, /DROP INDEX/i,
      /CREATE TYPE/i, /ALTER INDEX/i, /NULLS NOT DISTINCT/i, /ALTER COLUMN/i]) {
      expect(sql, `forbidden form ${forbidden} present`).not.toMatch(forbidden);
    }
  });

  it('never recreates one of the seven enums production already holds (NC-R12C-7)', () => {
    // Scoped deliberately to the seven. Those exist in production without any
    // migration having created them, so a CREATE TYPE for one of them raises
    // 42710 and fails the Render deploy outright — precisely what Prisma's
    // generated reconciliation SQL would have done.
    //
    // Other enums (TransitionActor, etc.) are created once by the migration
    // that introduces them, which is ordinary and correct; an earlier draft of
    // this control flagged those too and was simply wrong.
    for (const { name, sql } of migrations()) {
      for (const type of Object.keys(CANONICAL_ENUMS)) {
        expect(sql, `${name} creates canonical enum ${type}`)
          .not.toMatch(new RegExp(`CREATE TYPE\\s+"?${type}"?`, 'i'));
      }
    }
  });

  it('never drops or recreates campaign_states.stage (NC-R12C-8)', () => {
    // The column that opened this investigation. Production holds it as
    // CampaignStage already; a DROP/ADD would destroy the column to rebuild it
    // identically.
    for (const { name, sql } of migrations()) {
      const risky = /ALTER TABLE\s+"?campaign_states"?[\s\S]{0,200}?DROP COLUMN\s+"?stage"?/i;
      expect(sql, `${name} drops campaign_states.stage`).not.toMatch(risky);
    }
  });

  it('never converts a populated enum-backed column with a USING cast', () => {
    for (const { name, sql } of migrations()) {
      for (const type of Object.keys(CANONICAL_ENUMS)) {
        expect(sql, `${name} converts to ${type}`)
          .not.toMatch(new RegExp(`USING[^;]*::\\s*"?${type}"?`, 'i'));
      }
    }
  });
});

// ============================================================
// Real database — the contract as deployed
// ============================================================
const DB_OK = await dbAvailable();

const WS_A = '00000000-0000-4000-8000-00000000c1a0';
const WS_B = '00000000-0000-4000-8000-00000000c1b0';
const GHOST = '00000000-0000-4000-8000-00000000dead';

const request = (workspaceId, idempotencyKey) => ({
  workspaceId, idempotencyKey, actionType: 'PAUSE_CAMPAIGN',
  targetId: 'r12-1c-target', status: 'PENDING',
});

describe.skipIf(!DB_OK)('deployed contract — execution_requests foreign key', () => {
  beforeAll(async () => {
    for (const id of [WS_A, WS_B]) {
      await prisma.workspace.upsert({
        where: { id }, update: {}, create: { id, name: `R12-1c fixture ${id.slice(-4)}` },
      });
    }
  });

  afterAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS_A, WS_B] } } });
  });

  it('exists, targets workspaces(id), and cascades on both edges (M2 · M3)', async () => {
    const [fk] = await prisma.$queryRaw`
      SELECT c.conname::text            AS name,
             c.confrelid::regclass::text AS target,
             c.confupdtype::text         AS on_update,
             c.confdeltype::text         AS on_delete
        FROM pg_constraint c
       WHERE c.conname  = 'execution_requests_workspaceId_fkey'
         AND c.conrelid = 'public.execution_requests'::regclass
         AND c.contype  = 'f'`;

    expect(fk, 'FK execution_requests_workspaceId_fkey is absent').toBeDefined();
    expect(fk.target).toBe('workspaces');
    expect(fk.on_update).toBe('c');   // CASCADE
    expect(fk.on_delete).toBe('c');   // CASCADE
  });

  it('NC-R12C-1 — accepts a request referencing a real workspace', async () => {
    const row = await prisma.executionRequest.create({ data: request(WS_A, 'r12-1c-valid') });
    expect(row.workspaceId).toBe(WS_A);
  });

  it('NC-R12C-2 — rejects a request referencing a workspace that does not exist', async () => {
    // The whole point of the repair. Before it, this row was accepted and the
    // tenant key meant nothing at the database level.
    await expect(
      prisma.executionRequest.create({ data: request(GHOST, 'r12-1c-orphan') }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('NC-R12C-3 — deleting a workspace removes its execution requests', async () => {
    const doomed = '00000000-0000-4000-8000-00000000c1c0';
    await prisma.workspace.create({ data: { id: doomed, name: 'R12-1c cascade fixture' } });
    await prisma.executionRequest.create({ data: request(doomed, 'r12-1c-cascade') });

    await prisma.workspace.delete({ where: { id: doomed } });

    expect(await prisma.executionRequest.count({ where: { workspaceId: doomed } })).toBe(0);
  });

  it('NC-R12C-4 — R11 idempotency is unique PER WORKSPACE, not globally', async () => {
    const key = 'r12-1c-shared-key';
    await prisma.executionRequest.create({ data: request(WS_A, key) });

    // Same key, different tenant: must be allowed. A global namespace here was
    // the R11 cross-tenant leak.
    await expect(prisma.executionRequest.create({ data: request(WS_B, key) })).resolves.toBeTruthy();

    // Same key, same tenant: must still collide.
    await expect(prisma.executionRequest.create({ data: request(WS_A, key) }))
      .rejects.toMatchObject({ code: 'P2002' });
  });
});

describe.skipIf(!DB_OK)('deployed contract — enums and canonical indexes', () => {
  it('NC-R12C-6 — all seven enums exist and carry exactly their labels', async () => {
    // R12-1c had to write this conditionally, and pinned the reason as a KNOWN
    // DIVERGENCE: no migration created any of the seven, so a migration-built
    // database (CI, and every fresh developer database) had TEXT columns while
    // production had real enums. That pinned control has now done its job and
    // failed on purpose — 20260818040000_r12_1e_enum_reconciliation closes the
    // gap, so the assertion is flat rather than conditional.
    //
    // Full verification of the reconciliation lives in enumReconciliation.test.js.
    const rows = await prisma.$queryRaw`
      SELECT t.typname::text AS type, e.enumlabel::text AS label
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e      ON e.enumtypid = t.oid
       WHERE n.nspname = 'public'
       ORDER BY t.typname, e.enumsortorder`;

    for (const [type, labels] of Object.entries(CANONICAL_ENUMS)) {
      const actual = rows.filter((r) => r.type === type).map((r) => r.label);
      expect(actual, `${type} labels drifted`).toEqual(labels);
    }
  });

  it('NC-R12C-5 — the R9 snapshot identity key is intact and unrenamed', async () => {
    const [idx] = await prisma.$queryRaw`
      SELECT indexname::text AS name, indexdef::text AS def
        FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'metric_snapshots_identity_key'`;

    expect(idx, 'metric_snapshots_identity_key was renamed or dropped').toBeDefined();
    expect(idx.def).toMatch(/UNIQUE/);
    for (const col of ['entityId', 'entityLevel', 'date', 'granularity', 'source', 'measurementWindow']) {
      expect(idx.def).toContain(col);
    }
    // R9: the key is deliberately NOT workspace-scoped. Adding workspaceId would
    // let the same entity be snapshotted twice under different tenants.
    expect(idx.def).not.toContain('workspaceId');
  });

  it('keeps the decisions similarity index partial — the predicate is the point', async () => {
    const [idx] = await prisma.$queryRaw`
      SELECT indexdef::text AS def FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'decisions_similarity_idx'`;

    expect(idx, 'decisions_similarity_idx is absent').toBeDefined();
    expect(idx.def).toMatch(/WHERE/i);
    expect(idx.def).toMatch(/resolution IS NOT NULL/i);

    // C1 — the predicate now names the INTERVENTION union. It used to name
    // `intentAt`, which recorded that somebody copied a recommendation; the
    // query it covers stopped asking that question, and an index whose
    // predicate describes a different population from its query is an index
    // the planner will quietly decline to use.
    expect(idx.def).toMatch(/humanExecutedAt/i);
    expect(idx.def).toMatch(/platformExecutedAt/i);
    expect(idx.def).not.toMatch(/intentAt/i);
  });

  it('C1 · the old similarity predicate was REPLACED, not shadowed', async () => {
    // A partial index's predicate cannot be altered in place, so the migration
    // drops and recreates. If it had instead created a second index beside the
    // first, both would exist: dead weight on every write to `decisions`, and a
    // stale object still describing the engagement population.
    const rows = await prisma.$queryRaw`
      SELECT indexname::text AS name, indexdef::text AS def FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'decisions'
         AND indexdef ILIKE '%intentAt%'`;
    expect(rows).toEqual([]);
  });
});

