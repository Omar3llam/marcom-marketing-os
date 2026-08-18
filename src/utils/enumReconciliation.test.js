// ============================================================
// Enum reconciliation controls (R12-1e)
// ============================================================
// R12-1c proved that this repository's migration history and its production
// database had stopped agreeing. schema.prisma declares seven enums; the init
// migration created their columns as TEXT and no migration ever created the
// types. Production acquired both out-of-band, so a database built from the
// history had TEXT columns where production had real enums.
//
// That is not cosmetic. The generated Prisma client casts enum parameters
// ($1::"CampaignStage"), so on a migration-built database — CI, and every fresh
// developer database — writes to those seven tables failed with 42704 "type
// does not exist". CI and production were not running the same physical schema.
//
// 20260818040000_r12_1e_enum_reconciliation closes that gap by reconciling the
// history UP TO production: guarded type creation, exact-label validation, a
// value preflight, and a conditional TEXT -> enum conversion that is a no-op
// wherever production's shape already exists.
//
// These controls run against whatever database CI provides, which is built from
// the migration history alone. That is the whole point — a suite that skips
// because no database is reachable proves nothing about the database path.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAvailable } from '../tests/dbProbe.js';
import { prisma } from '../lib/prisma.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = path.join(ROOT, 'prisma', 'migrations',
  '20260818040000_r12_1e_enum_reconciliation', 'migration.sql');

// The canonical contract, taken from schema.prisma. Order is significant:
// PostgreSQL enum labels are ordered, and Prisma generates them in declaration
// order, so a reordering is a real difference and not a cosmetic one.
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

// column -> enum, and the default production carries (null = no default).
const ENUM_COLUMNS = [
  ['actions', 'status', 'ActionStatus', 'PENDING'],
  ['audit_logs', 'actionType', 'ActionType', null],
  ['audit_logs', 'status', 'ExecutionStatus', 'PENDING'],
  ['campaign_states', 'stage', 'CampaignStage', null],
  ['users', 'role', 'UserRole', 'VIEWER'],
  ['webhook_events', 'provider', 'WebhookProvider', null],
  ['webhook_events', 'status', 'WebhookStatus', 'RECEIVED'],
];

// ============================================================
// Source-level safety (NC5) — no database required
// ============================================================
describe('R12-1e migration is non-destructive by construction (NC5)', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const executable = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n');

  it('never drops or re-adds a column', () => {
    // Prisma's own generated reconciliation was exactly this — DROP COLUMN
    // "stage", ADD COLUMN "stage" "CampaignStage" — which destroys a live column
    // to rebuild it identically. It is the single form this slice exists to
    // avoid, so it is asserted rather than trusted.
    expect(executable).not.toMatch(/DROP\s+COLUMN/i);
    expect(executable).not.toMatch(/ADD\s+COLUMN/i);
  });

  it('never drops or alters an existing type', () => {
    expect(executable).not.toMatch(/DROP\s+TYPE/i);
    expect(executable).not.toMatch(/ALTER\s+TYPE/i);   // incl. ADD VALUE
  });

  it('creates types only inside a guard that checks existence first', () => {
    // An unguarded CREATE TYPE raises 42710 against production and fails the
    // Render deploy on the spot.
    expect(executable).toMatch(/DO \$\$/);
    const bareCreate = /^\s*CREATE TYPE/mi.test(executable);
    expect(bareCreate, 'a top-level CREATE TYPE is present').toBe(false);
  });

  it('refuses rather than coerces when reality disagrees', () => {
    // Both failure modes must stop the migration: a type whose labels differ,
    // and a column holding a value outside the contract. Silently accepting
    // either is how the original drift stayed invisible.
    expect(executable).toMatch(/RAISE EXCEPTION/);
    expect(executable).toMatch(/Refusing to alter, drop or extend it/);
    expect(executable).toMatch(/Refusing to coerce or discard them/);
  });

  it('converts in place, preserving the column and its data', () => {
    expect(executable).toMatch(/ALTER COLUMN %I TYPE %I USING %I::text::%I/);
  });
});

const DB_OK = await dbAvailable();

// ============================================================
// A + B — the seven types exist with exactly the canonical labels
// ============================================================
describe.skipIf(!DB_OK)('R12-1e deployed — enum types (NC1 · NC2 · NC3)', () => {
  it('all seven types exist', async () => {
    const rows = await prisma.$queryRaw`
      SELECT t.typname::text AS type
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype = 'e'`;
    const present = rows.map((r) => r.type);
    for (const type of Object.keys(CANONICAL_ENUMS)) {
      expect(present, `enum ${type} was not created by the migration history`).toContain(type);
    }
  });

  it('every type carries exactly its canonical labels, in order', async () => {
    const rows = await prisma.$queryRaw`
      SELECT t.typname::text AS type, e.enumlabel::text AS label
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e      ON e.enumtypid = t.oid
       WHERE n.nspname = 'public'
       ORDER BY t.typname, e.enumsortorder`;

    for (const [type, labels] of Object.entries(CANONICAL_ENUMS)) {
      expect(rows.filter((r) => r.type === type).map((r) => r.label), `${type} labels`).toEqual(labels);
    }
  });
});

// ============================================================
// C + D + E — the columns, their defaults, and what must not have moved
// ============================================================
describe.skipIf(!DB_OK)('R12-1e deployed — enum-backed columns (NC4)', () => {
  it('all seven columns use their enum type, not text', async () => {
    const rows = await prisma.$queryRaw`
      SELECT table_name::text AS tbl, column_name::text AS col,
             udt_name::text AS udt, is_nullable::text AS nullable,
             coalesce(column_default, '') AS col_default
        FROM information_schema.columns
       WHERE table_schema = 'public'`;

    for (const [tbl, col, type] of ENUM_COLUMNS) {
      const found = rows.find((r) => r.tbl === tbl && r.col === col);
      expect(found, `${tbl}.${col} is missing`).toBeDefined();
      expect(found.udt, `${tbl}.${col} was not converted`).toBe(type);
    }
  });

  it('nullability and defaults survived the conversion', async () => {
    // The conversion drops and restores each default so a text default cannot
    // block ALTER COLUMN TYPE. The restored value must be the same literal, now
    // enum-typed — which is exactly what production carries.
    const rows = await prisma.$queryRaw`
      SELECT table_name::text AS tbl, column_name::text AS col,
             is_nullable::text AS nullable, coalesce(column_default, '') AS col_default
        FROM information_schema.columns
       WHERE table_schema = 'public'`;

    for (const [tbl, col, type, def] of ENUM_COLUMNS) {
      const found = rows.find((r) => r.tbl === tbl && r.col === col);
      expect(found.nullable, `${tbl}.${col} nullability changed`).toBe('NO');
      if (def === null) {
        expect(found.col_default, `${tbl}.${col} gained a default`).toBe('');
      } else {
        expect(found.col_default, `${tbl}.${col} default drifted`).toBe(`'${def}'::"${type}"`);
      }
    }
  });

  it('leaves the R11 and R9 keys the conversion sits next to untouched', async () => {
    // ALTER COLUMN TYPE rebuilds dependent indexes. These two are the frozen
    // guarantees nearest the blast radius, so they are re-proved afterwards
    // rather than assumed.
    const rows = await prisma.$queryRaw`
      SELECT indexname::text AS name, indexdef::text AS def
        FROM pg_indexes WHERE schemaname = 'public'`;

    const idem = rows.find((r) => r.name === 'execution_requests_workspaceId_idempotencyKey_key');
    expect(idem, 'R11 workspace-scoped idempotency key is missing').toBeDefined();
    expect(idem.def).toMatch(/UNIQUE/);

    const snap = rows.find((r) => r.name === 'metric_snapshots_identity_key');
    expect(snap, 'R9 snapshot identity key is missing').toBeDefined();
    expect(snap.def).not.toContain('workspaceId');
  });
});

// ============================================================
// F — the point of the whole slice: Prisma can actually write
// ============================================================
const WS = '00000000-0000-4000-8000-0000000e1e00';

describe.skipIf(!DB_OK)('R12-1e deployed — the generated client can write enums', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({
      where: { id: WS }, update: {}, create: { id: WS, name: 'R12-1e enum fixture' },
    });
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { externalEventId: { startsWith: 'r12-1e-' } } });
    await prisma.workspace.deleteMany({ where: { id: WS } });   // cascades users + campaign_states
  });

  it('CampaignState.stage — the write that broke the resilience suite', async () => {
    // This is the exact operation that failed with 42704 on CI: the client
    // issues $1::"CampaignStage", and the type did not exist there.
    const row = await prisma.campaignState.create({
      data: {
        campaignId: 'r12-1e-stage', campaignName: 'R12-1e', workspaceId: WS,
        stage: 'STABLE', healthScore: 71, lastAnalysis: new Date(),
      },
    });
    expect(row.stage).toBe('STABLE');

    const read = await prisma.campaignState.findFirst({
      where: { campaignId: 'r12-1e-stage', workspaceId: WS }, select: { stage: true },
    });
    expect(read.stage).toBe('STABLE');
  });

  it('WebhookEvent.provider and .status — two enums on one row', async () => {
    const row = await prisma.webhookEvent.create({
      data: {
        provider: 'META', status: 'RECEIVED',
        externalEventId: `r12-1e-${Date.now()}`, payload: {},
      },
    });
    expect(row.provider).toBe('META');
    expect(row.status).toBe('RECEIVED');
  });

  it('User.role — the authorization axis, and its default', async () => {
    const explicit = await prisma.user.create({
      data: { workspaceId: WS, email: `r12-1e-admin-${Date.now()}@example.test`, role: 'ADMIN' },
    });
    expect(explicit.role).toBe('ADMIN');

    // The restored default must still apply, and still be VIEWER — an enum
    // conversion that silently changed who is an ADMIN would be the worst
    // possible outcome of this slice.
    const defaulted = await prisma.user.create({
      data: { workspaceId: WS, email: `r12-1e-default-${Date.now()}@example.test` },
    });
    expect(defaulted.role).toBe('VIEWER');
  });

  it('rejects a value outside the contract instead of storing it', async () => {
    await expect(
      prisma.campaignState.create({
        data: {
          campaignId: 'r12-1e-bogus', campaignName: 'R12-1e', workspaceId: WS,
          stage: 'NOT_A_STAGE', healthScore: 1, lastAnalysis: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
