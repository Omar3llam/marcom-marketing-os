// ============================================================
// Migration rollout-compatibility contract (B5-01R⁗)
// ============================================================
// The CI-side half of the Hybrid policy adopted in B5-01R″. The other three
// layers act at deploy time (B5-01Q), at worker start (B5-01R‴) and at the
// provider seam (B5-01R′). This one acts before any of that: it refuses to let
// a migration whose SHAPE is unsafe for a rolling deploy pass verification
// unnoticed.
//
// What it can and cannot say is fixed, and worth repeating because the verdict
// names invite over-reading: it classifies the OPERATION, never the program.
// COMPATIBLE means "this operation does not, by itself, break an instance
// running the other version". It has no opinion about whether the application
// code is correct.
//
// Pure — no database. Runs in fast mode as well as full.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  classifyMigrationSql, scanMigrations, verifyAgainstBaseline, summarise,
  migrationDirs, normalise, isRequiredColumnAddition,
  COMPATIBLE, TRANSITION_REQUIRED, INCOMPATIBLE, UNKNOWN,
} from '../../scripts/migrationCompatibility.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(REPO, 'prisma/migrations');
const fs = { readdirSync, readFileSync, existsSync };

const scan = scanMigrations(fs, nodePath, MIGRATIONS);
const baseline = (() => {
  const b = JSON.parse(readFileSync(resolve(REPO, 'scripts/migrationCompatibility.baseline.json'), 'utf8'));
  delete b.$comment;
  return b;
})();

describe('B5-01R⁗ · migration rollout compatibility', () => {
  // ── T1 · the corpus census, as a ratchet ────────────────────────────────
  it('T1 — the production corpus classifies to the recorded distribution', () => {
    const counts = summarise(scan);
    // 66 → 67 and COMPATIBLE 45 → 46: C-02 adds
    // 20260901120000_c02_guardrail_hit_identity. Every operation in it is
    // additive — one enum value, two nullable columns, two indexes — so an
    // instance running the previous code against the new schema simply never
    // produces the new value and never populates the new columns. No baseline
    // entry follows, because the baseline records only what is NOT compatible.
    //
    // 67 → 68 and COMPATIBLE 46 → 47: C-05 adds
    // 20260903120000_c05_promotion_authorization. Additive on the same terms —
    // two enum values, one new enum type, three nullable columns, one index.
    // The ordering it DOES require runs the other way: the migration must reach
    // an environment before the code that names `decisions.closureReason`,
    // because a new column widens every `select`-less read of that table. That
    // is a deploy-order constraint, not a rollback hazard, so the verdict stays
    // COMPATIBLE and no baseline entry follows.
    //
    // 68 → 69 and COMPATIBLE 47 → 48: C-18 adds
    // 20260904120000_c18_plan_promotion_lifecycle. Three nullable columns on
    // `plans` and one plain index; no enum is created or altered, because
    // PlanStatus.CLOSED already existed and simply had no writer. Additive on
    // exactly the same terms as its two predecessors, so no baseline entry.
    //
    // It carries the SAME deploy-order constraint C-05 documented above, and for
    // the same reason: `plans` is read `select`-less by PlanService.getPlan,
    // AgenticLoopService and lumi/feed, so a new column widens all three. The
    // migration must reach an environment before the code naming
    // `promotedAt` / `closedAt` does. A deploy-order constraint, not a
    // rollback hazard — the verdict stays COMPATIBLE.
    // 69 → 70 and TRANSITION_REQUIRED 9 → 10: C-10 adds
    // 20260905120000_c10_decision_class. The column, the enum type and the index
    // are all additive — but the migration also BACK-FILLS the column from the
    // rootCause prefixes, and a data rewrite races instances still writing the
    // old shape. That is the first non-COMPATIBLE migration this programme has
    // produced, and the classifier is right about it: an old instance writes
    // rows that land NULL after the UPDATEs have run, and NULL means
    // UNCLASSIFIED, which every scoped reader excludes.
    //
    // So this one DOES get a baseline entry, carrying the phased deploy that
    // makes it safe. See scripts/migrationCompatibility.baseline.json.
    expect(scan.length).toBe(70);
    expect(counts).toEqual({
      COMPATIBLE: 48,
      TRANSITION_REQUIRED: 10,
      INCOMPATIBLE: 8,
      UNKNOWN: 4,
    });
    // Changing these numbers is allowed — deliberately, in a diff, alongside a
    // baseline entry explaining the new migration. It is not allowed silently.
  });

  it('T1b — every non-compatible migration is declared, and every declaration is live', () => {
    const result = verifyAgainstBaseline(scan, baseline);
    expect(result.undeclared.map((m) => `${m.name} → ${m.verdict}`)).toEqual([]);
    expect(result.mismatched).toEqual([]);
    expect(result.stale, 'a baseline nobody prunes is where regressions hide').toEqual([]);
    expect(result.unreasoned).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('T1c — the eight INCOMPATIBLE migrations are exactly the ones we know about', () => {
    // Named, not counted. B5-01R″ reached the same eight by a different route;
    // if this list changes, something real happened.
    const incompatible = scan.filter((m) => m.verdict === INCOMPATIBLE).map((m) => m.name);
    expect(incompatible).toEqual([
      '20260524120000_pr20_decision_memory_foundation',
      '20260615000000_drop_integration_model',
      '20260730000000_add_decision_lifecycle',
      '20260818050000_r12_1d_loop_run_ai_insight_rename',
      '20260823000000_sc1_campaignstate_closure',
      '20260823090000_sc2_action_closure',
      '20260823100000_sc3_decisionmemory_closure',
      '20260823110000_sc4_oauthtoken_closure',
    ]);
  });

  // ── T2 · a safe expand ──────────────────────────────────────────────────
  it('T2 — an additive migration is COMPATIBLE', () => {
    // The real shape from 20260714000000_add_reach_to_metric_snapshot.
    const r = classifyMigrationSql(`
      ALTER TABLE "metric_snapshots" ADD COLUMN IF NOT EXISTS "reach" INTEGER;
      CREATE INDEX IF NOT EXISTS "metric_snapshots_reach_idx" ON "metric_snapshots"("reach");
    `);
    expect(r.verdict).toBe(COMPATIBLE);
    expect(r.unknown).toEqual([]);
    expect(r.operations.map((o) => o.id)).toEqual(['add-column', 'create-index']);
  });

  it('T2b — a new table with its own foreign keys is COMPATIBLE', () => {
    // The corpus's most common shape by far, and the one a naive classifier
    // gets wrong: an FK is only restrictive on a table that already existed.
    const r = classifyMigrationSql(`
      CREATE TABLE "widgets" ("id" UUID NOT NULL, "workspaceId" UUID NOT NULL,
        CONSTRAINT "widgets_pkey" PRIMARY KEY ("id"));
      ALTER TABLE "widgets" ADD CONSTRAINT "widgets_ws_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    `);
    expect(r.verdict).toBe(COMPATIBLE);
    expect(r.operations.map((o) => o.id)).toContain('add-constraint-restrictive-on-new-table');
  });

  // ── T3 · transitional ───────────────────────────────────────────────────
  it('T3 — a foreign key on an EXISTING table is TRANSITION_REQUIRED', () => {
    const r = classifyMigrationSql(`
      ALTER TABLE "execution_requests" ADD CONSTRAINT "execution_requests_ws_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE;
    `);
    expect(r.verdict).toBe(TRANSITION_REQUIRED);
    expect(r.verdict).not.toBe(COMPATIBLE);
  });

  it('T3b — NOT NULL without a default is TRANSITION_REQUIRED, with a default it is not', () => {
    // MEASURED in B5-01R″ F4: without a default an old instance INSERT fails
    // with P2011 — the feature is dead until the code catches up. With a
    // default (F2b) the same instance is unaffected.
    const bare = classifyMigrationSql('ALTER TABLE "users" ADD COLUMN "tier" TEXT NOT NULL;');
    expect(bare.verdict).toBe(TRANSITION_REQUIRED);
    expect(bare.operations[0].id).toBe('add-column-not-null-no-default');

    const defaulted = classifyMigrationSql(`ALTER TABLE "users" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'free';`);
    expect(defaulted.verdict).toBe(COMPATIBLE);

    expect(isRequiredColumnAddition('ALTER TABLE "u" ADD COLUMN "x" TEXT NOT NULL')).toBe(true);
    expect(isRequiredColumnAddition(`ALTER TABLE "u" ADD COLUMN "x" TEXT NOT NULL DEFAULT 'a'`)).toBe(false);
    expect(isRequiredColumnAddition('ALTER TABLE "u" ADD COLUMN "x" TEXT')).toBe(false);
  });

  it('T3c — a backfill is TRANSITION_REQUIRED', () => {
    const r = classifyMigrationSql('UPDATE "decisions" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;');
    expect(r.verdict).toBe(TRANSITION_REQUIRED);
  });

  // ── T4 · destructive ────────────────────────────────────────────────────
  it.each([
    ['ALTER TABLE "decisions" DROP COLUMN "rootCause";', 'drop-column'],
    ['ALTER TABLE "loop_runs" RENAME COLUMN "ai_insight" TO "aiInsight";', 'rename-column'],
    ['DROP TABLE "campaign_states";', 'drop-table'],
    ['DROP TYPE "OldEnum";', 'drop-type'],
    ['ALTER TABLE "decisions" ALTER COLUMN "status" TYPE "DecisionStatus" USING "status"::"DecisionStatus";', 'alter-column-type'],
  ])('T4 — %s is INCOMPATIBLE', (sql, id) => {
    const r = classifyMigrationSql(sql);
    expect(r.verdict).toBe(INCOMPATIBLE);
    expect(r.operations.map((o) => o.id)).toContain(id);
  });

  // ── T5 · unknown fails closed ───────────────────────────────────────────
  it('T5 — SQL outside the classifier language is UNKNOWN, never COMPATIBLE', () => {
    const r = classifyMigrationSql('CREATE MATERIALIZED VIEW "spend_rollup" AS SELECT 1;');
    expect(r.verdict).toBe(UNKNOWN);
    expect(r.verdict).not.toBe(COMPATIBLE);
    expect(r.unknown[0]).toMatch(/MATERIALIZED VIEW/i);
  });

  it('T5b — dynamic DDL is UNKNOWN, because its target only exists at runtime', () => {
    const r = classifyMigrationSql(`
      DO $$ BEGIN EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c); END $$;
    `);
    expect(r.verdict).toBe(UNKNOWN);
    expect(r.unknown.join(' ')).toMatch(/dynamic DDL/);
  });

  it('T5c — an UNKNOWN migration cannot be waved through by the contract', () => {
    const result = verifyAgainstBaseline(
      [{ name: '29990101000000_new_thing', verdict: UNKNOWN, operations: [], unknown: ['?'] }],
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.undeclared).toHaveLength(1);
  });

  // ── T6 · most restrictive wins ──────────────────────────────────────────
  it('T6 — one dangerous statement is not diluted by safe ones', () => {
    const r = classifyMigrationSql(`
      CREATE TABLE "a" ("id" UUID NOT NULL);
      CREATE INDEX "a_id_idx" ON "a"("id");
      ALTER TABLE "users" ADD COLUMN "nickname" TEXT;
      ALTER TABLE "users" DROP COLUMN "legacyName";
      COMMENT ON TABLE "a" IS 'x';
    `);
    expect(r.verdict).toBe(INCOMPATIBLE);
    expect(r.operations.length).toBeGreaterThan(4);
  });

  it('T6b — UNKNOWN outranks everything, including INCOMPATIBLE', () => {
    const r = classifyMigrationSql(`
      DROP TABLE "old";
      CREATE MATERIALIZED VIEW "v" AS SELECT 1;
    `);
    expect(r.verdict).toBe(UNKNOWN);
  });

  // ── T7 · corpus boundary ────────────────────────────────────────────────
  it('T7 — the scanner reads production migrations and nothing else', () => {
    const dirs = migrationDirs(fs, MIGRATIONS);
    expect(dirs).toHaveLength(70); // +1 C-02, +1 C-05, +1 C-18, +1 C-10 (see T1)
    expect(dirs.every((d) => /^\d{14}_/.test(d))).toBe(true);
    // Real non-migration entries that sit in this directory today.
    expect(dirs).not.toContain('migration_lock.toml');
    expect(dirs.some((d) => d.endsWith('.sql'))).toBe(false);
    expect(dirs).not.toContain('manual_add_execution_request_idempotency.sql');
  });

  it('normalise removes comments and literal text without eating dollar-quoted DDL', () => {
    const out = normalise(`
      -- DROP TABLE "not_really";
      /* DROP TABLE "also_not"; */
      DO $$ BEGIN RAISE NOTICE 'alter, drop or extend it'; ALTER TABLE "x" ADD COLUMN "y" TEXT; END $$;
    `);
    expect(out).not.toMatch(/not_really|also_not/);
    expect(out).not.toMatch(/alter, drop or extend/);
    expect(out).toMatch(/ALTER TABLE "x" ADD COLUMN/);
  });

  // ── T8 · integration ────────────────────────────────────────────────────
  it('T8 — the normal verification path runs this contract', () => {
    // A classifier nobody invokes is a script, not a contract. This is the
    // ratchet on the wiring itself: MCD removes the call, and this fails.
    const archCheck = readFileSync(resolve(REPO, 'scripts/arch-check.js'), 'utf8');
    expect(archCheck).toMatch(/from '\.\/migrationCompatibility\.js'/);
    expect(archCheck).toMatch(/scanMigrations\s*\(/);
    expect(archCheck).toMatch(/verifyAgainstBaseline\s*\(/);
    // ...and its failures must reach the exit code, not just the log.
    expect(archCheck).toMatch(/for \(const line of \[\.\.\.result\.mismatched[\s\S]{0,80}?fail\(/);
    expect(archCheck).toMatch(/result\.undeclared/);

    // arch-check is in the documented verification path.
    const pkg = JSON.parse(readFileSync(resolve(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts['arch-check']).toBe('node scripts/arch-check.js');
  });
});
