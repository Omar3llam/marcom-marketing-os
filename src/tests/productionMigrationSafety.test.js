// ============================================================
// Production migration safety (B5-01Q)
// ============================================================
// B5-01M proved the MIGRATION SET expresses schema.prisma. This file proves
// something different and, for production, more dangerous if wrong:
//
//     What does the deploy do when the database is NOT in the state it expects?
//
// The subject under test is the real `scripts/prisma-migrate-safe.js` — the
// thing render.yaml runs, via `npm run build`, against production. It is spawned
// as a child process against a disposable clone, exactly as Render invokes it.
// Nothing here reads its source to guess at behaviour except T5, which exists
// only as a backstop for the behavioural tests above it.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
// Measured against the pre-B5-01Q script, with 20260525000000 in a genuinely
// failed state and `approval_decisions` dropped:
//
//     script exit                0        ← the build continued
//     _prisma_migrations         66/66 applied, the new row with 0 steps
//     prisma migrate status      "Database schema is up to date!"
//     approval_decisions         MISSING
//
// Five modules read that table. Green deploy, 500s at runtime, and migration
// history asserting everything was fine. Every test below is aimed at keeping
// that specific outcome impossible.
//
// ── COST ────────────────────────────────────────────────────────────────────
// One `migrate deploy` builds a template in beforeAll; every case clones it
// (~360ms) so no test pays for a migration run. Databases are this file's own
// and are dropped in afterAll, including after a failure.
// ============================================================
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';
import {
  databaseIdentity, databaseName, urlForDatabase, adminUrl,
} from './dbIsolation.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PRISMA = resolve(REPO, 'node_modules/prisma/build/index.js');
const GATE = resolve(REPO, 'scripts/prisma-migrate-safe.js');
const ROOT = process.env.TEST_DATABASE_URL;
const ENABLED = Boolean(ROOT);

const ROOT_NAME = ENABLED ? databaseName(ROOT) : null;
const TMPL = ENABLED ? `${ROOT_NAME}_q_tmpl` : null;

/** The migration whose name the old script had hard-coded into its P3009 branch. */
const HARDCODED = '20260525000000_add_approval_decision_analytics';
const HARDCODED_TABLE = 'approval_decisions';

const sql = (url) => postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });

/** Run the REAL production gate against `db`, the way Render runs it. */
function runGate(db) {
  const url = urlForDatabase(ROOT, db);
  const r = spawnSync(process.execPath, [GATE], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env, DATABASE_URL: url, DIRECT_URL: url, CHECKPOINT_DISABLE: '1',
    },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * Everything about the database a migration could change: its schema down to
 * column type and nullability, and every row of migration history. T7 compares
 * this across an inspection; T2/T4 compare the history half across a failure.
 */
async function fingerprint(db) {
  const c = sql(urlForDatabase(ROOT, db));
  try {
    const cols = await c`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, column_name`;
    const hist = await c`
      SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`;
    const rows = hist[0].present
      ? await c`SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
                FROM _prisma_migrations ORDER BY started_at, migration_name`
      : [];
    return {
      historyPresent: hist[0].present,
      schema: JSON.stringify(cols),
      history: JSON.stringify(rows),
      applied: rows.filter((r) => r.finished_at !== null).length,
      rowsFor: (name) => rows.filter((r) => r.migration_name === name),
    };
  } finally { await c.end({ timeout: 5 }).catch(() => {}); }
}

describe.skipIf(!ENABLED)('B5-01Q · production migration safety', () => {
  let admin;
  const made = new Set();

  /** A fresh, fully-migrated clone of the template. */
  async function clone(suffix) {
    const name = `${ROOT_NAME}_q_${suffix}`;
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${TMPL}"`);
    made.add(name);
    return name;
  }

  async function on(db, statement) {
    const c = sql(urlForDatabase(ROOT, db));
    try { await c.unsafe(statement); } finally { await c.end({ timeout: 5 }).catch(() => {}); }
  }

  beforeAll(async () => {
    // Never the development database, never the workers' root, never a worker
    // database. Compared on PostgreSQL identity, not on the string.
    const ambient = process.env.DATABASE_URL;
    if (ambient) {
      expect(databaseIdentity(urlForDatabase(ROOT, TMPL))).not.toBe(databaseIdentity(ambient));
    }
    expect(TMPL).not.toBe(ROOT_NAME);
    expect(TMPL).not.toMatch(/_w\d+$/);

    admin = sql(adminUrl(ROOT));
    await admin.unsafe(`DROP DATABASE IF EXISTS "${TMPL}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${TMPL}"`);
    made.add(TMPL);

    const url = urlForDatabase(ROOT, TMPL);
    const r = spawnSync(process.execPath, [PRISMA, 'migrate', 'deploy'], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, CHECKPOINT_DISABLE: '1' },
    });
    expect(r.status, `template migration failed:\n${r.stdout ?? ''}${r.stderr ?? ''}`).toBe(0);
  }, 300_000);

  afterAll(async () => {
    if (!admin) return;
    await Promise.all([...made].map(async (name) => {
      const c = sql(adminUrl(ROOT));
      try { await c.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
      catch { /* teardown is best-effort; the next run drops it anyway */ }
      finally { await c.end({ timeout: 5 }).catch(() => {}); }
    }));
    await admin.end({ timeout: 5 }).catch(() => {});
  }, 180_000);

  // ── T1 · the healthy path is untouched ──────────────────────────────────
  it('T1 — a correctly migrated database still deploys', async () => {
    const db = await clone('clean');
    const before = await fingerprint(db);

    const r = runGate(db);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/Migrations deployed successfully/);
    expect(r.out).toMatch(/Deploy target matches prisma\/schema\.prisma/);

    // The five differences Prisma's schema language cannot express are still
    // tolerated by name, not by silence.
    expect(r.out).toMatch(/tolerated:\s+\d+ × decisions-partial-indexes/);

    const after = await fingerprint(db);
    expect(after.applied).toBe(before.applied);
    expect(after.schema).toBe(before.schema);
  }, 180_000);

  it('T1b — an empty database is migrated and then verified', async () => {
    // T1 covers "already up to date", where `migrate deploy` has nothing to do.
    // This is the path that actually applies migrations, and the one a new
    // environment takes. Kept separate because it is the only case here that
    // pays for a real migration run.
    const db = `${ROOT_NAME}_q_empty`;
    await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${db}"`);
    made.add(db);

    const r = runGate(db);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/Deploy target matches prisma\/schema\.prisma/);

    const after = await fingerprint(db);
    expect(after.historyPresent).toBe(true);
    expect(after.applied, 'every migration must be recorded applied').toBeGreaterThan(60);
    expect(after.schema).toMatch(new RegExp(HARDCODED_TABLE));
  }, 300_000);

  // ── T2/T3 · a failed migration is terminal, and nothing is fabricated ────
  it('T3 — P3009 stops the deploy and writes nothing to migration history', async () => {
    const db = await clone('p3009');
    // A REAL failure, not a cosmetic one: the table the migration creates is
    // gone, and history records it as started-and-never-finished.
    await on(db, `DROP TABLE IF EXISTS "${HARDCODED_TABLE}" CASCADE`);
    await on(db, `UPDATE _prisma_migrations SET finished_at = NULL, logs = 'simulated (B5-01Q)'
                  WHERE migration_name = '${HARDCODED}'`);
    const before = await fingerprint(db);

    const r = runGate(db);

    // T2 — fail closed.
    expect(r.status, 'a failed migration must end the deploy').not.toBe(0);
    // ...and say so honestly. No "recovered", no "successful".
    expect(r.out).toMatch(/P3009/);
    expect(r.out).toMatch(/DEPLOYMENT STOPPED/);
    expect(r.out).not.toMatch(/recovery successful/i);

    // The single most important assertion in this file: history is untouched.
    // The old script inserted a second row here, with applied_steps_count = 0,
    // and exited 0.
    const after = await fingerprint(db);
    expect(after.history, 'the gate must not write migration history').toBe(before.history);
    expect(after.rowsFor(HARDCODED)).toHaveLength(1);
    expect(after.rowsFor(HARDCODED)[0].finished_at).toBeNull();

    // And the database is still visibly broken, which is the point — the
    // evidence an operator needs was preserved, not erased.
    expect(after.schema).not.toMatch(new RegExp(HARDCODED_TABLE));
  }, 180_000);

  it('T3b — the diagnostic names the migration that actually failed', async () => {
    // The old branch resolved ONE hard-coded name whatever had failed. Use a
    // different migration so a hard-coded name cannot pass this.
    const db = await clone('other');
    const names = await (async () => {
      const c = sql(urlForDatabase(ROOT, db));
      try { return await c`SELECT migration_name FROM _prisma_migrations ORDER BY started_at DESC LIMIT 1`; }
      finally { await c.end({ timeout: 5 }).catch(() => {}); }
    })();
    const target = names[0].migration_name;
    expect(target).not.toBe(HARDCODED);

    await on(db, `UPDATE _prisma_migrations SET finished_at = NULL, logs = 'simulated (B5-01Q)'
                  WHERE migration_name = '${target}'`);

    const r = runGate(db);
    expect(r.status).not.toBe(0);
    expect(r.out, 'the operator must be told WHICH migration failed').toMatch(new RegExp(target));
    expect(r.out).toMatch(/OPERATOR PROCEDURE/);
  }, 180_000);

  // ── T4 · P3005 fabricates no baseline ───────────────────────────────────
  it('T4 — P3005 stops the deploy and creates no migration history', async () => {
    const db = await clone('p3005');
    await on(db, 'DROP TABLE IF EXISTS "_prisma_migrations"');

    const r = runGate(db);
    expect(r.status, 'an unmanaged database must not be baselined automatically').not.toBe(0);
    expect(r.out).toMatch(/P3005/);
    expect(r.out).toMatch(/DEPLOYMENT STOPPED/);

    // Nothing invented. The old script wrote a fabricated init row here (and,
    // on a full schema, three more) before failing anyway.
    const after = await fingerprint(db);
    expect(after.historyPresent, 'migration history must not be conjured').toBe(false);
  }, 180_000);

  // ── T5 · positive control: the resolve path cannot come back ────────────
  it('T5 — the deployment path contains no automatic migrate resolve', () => {
    // Backstop, not the primary proof — T3/T4 assert on the database itself.
    // This catches a reintroduction the moment it is typed, including in a
    // branch no test happens to reach.
    //
    // Scoped to what the script EXECUTES, not to what it prints: the P3009 and
    // P3005 diagnostics quote `migrate resolve --applied` on purpose, because
    // telling an operator the command they may run after inspecting the
    // database is the entire replacement for running it for them. A test that
    // banned the string would ban the fix. (Measured: it did — this assertion's
    // first form failed on the operator procedure text.)
    const gate = readFileSync(GATE, 'utf8');
    const commands = [...gate.matchAll(/\b(?:execSync|execFileSync|spawnSync|exec|spawn)\s*\(\s*(['"`])([\s\S]*?)\1/g)]
      .map((m) => m[2]);

    expect(commands.length, 'the gate must still be the thing that runs prisma').toBeGreaterThan(0);
    const resolving = commands.filter((c) => /migrate\s+resolve/.test(c));
    expect(resolving, 'no automatic `migrate resolve` may run in the deploy path').toEqual([]);

    // Every command it does run must be one of the read-only or forward-only
    // Prisma verbs. `resolve` writes history; `db push` and `reset` write schema.
    for (const c of commands) {
      expect(c, `unexpected prisma verb in the deploy path: ${c}`)
        .not.toMatch(/\b(db\s+push|migrate\s+reset|migrate\s+dev)\b/);
    }
  });

  // ── T6 · drift is visible ───────────────────────────────────────────────
  it('T6 — a column the datamodel requires but the database lacks stops the deploy', async () => {
    const db = await clone('drift');
    // History stays complete, so `migrate deploy` succeeds and has nothing to
    // say. Only the schema verification can catch this.
    await on(db, 'ALTER TABLE "decisions" DROP COLUMN "rootCause"');

    const r = runGate(db);
    expect(r.status, 'a missing required column must stop the deploy').not.toBe(0);
    expect(r.out).toMatch(/Migrations deployed successfully/);   // deploy itself was fine
    expect(r.out).toMatch(/SCHEMA MISMATCH/);
    expect(r.out, 'the diagnostic must name the object').toMatch(/decisions.*rootCause/s);
  }, 180_000);

  it('T6b — a column the database has and the datamodel does not is reported, not fatal', async () => {
    // Deliberate asymmetry. Prisma Client never selects an undeclared column,
    // so it cannot break a read; blocking here would make the safety gate a
    // production-repair tool and could wedge a database that already drifted.
    const db = await clone('extra');
    await on(db, 'ALTER TABLE "workspaces" ADD COLUMN "__b5q_extra__" TEXT');

    const r = runGate(db);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/SCHEMA DRIFT/);
    expect(r.out).toMatch(/__b5q_extra__/);
  }, 180_000);

  it('T6c — legacy tables the datamodel does not declare do not stop the deploy', async () => {
    // The case that actually reached production. `migrate diff` reports whole
    // tables in a GROUPED form whose children carry no sign of their own:
    //
    //     [-] Removed tables
    //       - marcom_sessions
    //
    // The first version of the parser lost the group's `[-]`, scored these by
    // the fail-safe default, and stopped a real deploy over four inert legacy
    // tables. T6b used a spare COLUMN, which is the per-object shape, so it
    // could not have caught this. Named after the real tables on purpose.
    const db = await clone('legacy');
    await on(db, 'CREATE TABLE "marcom_sessions" (id int PRIMARY KEY, note text)');
    await on(db, 'CREATE TABLE "marcom_user_context" (id int PRIMARY KEY)');

    const r = runGate(db);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/SCHEMA DRIFT/);
    expect(r.out).toMatch(/marcom_sessions/);
    expect(r.out).not.toMatch(/SCHEMA MISMATCH/);

    // Each table named individually with its own sign — the grouped header
    // must not arrive as one nameless "(none)" difference.
    for (const t of ['marcom_sessions', 'marcom_user_context']) {
      expect(r.out).toMatch(new RegExp(`${t}: \\[-\\] Removed table`));
    }
    expect(r.out).not.toMatch(/\(none\)/);
    // ...and the deploy does not claim a clean match while reporting drift.
    expect(r.out).toMatch(/satisfies prisma\/schema\.prisma \(2 unmanaged object/);
  }, 180_000);

  it('T6d — a table the datamodel declares and the database lacks stops the deploy', async () => {
    // The same grouped shape in the dangerous direction, so the fix for T6c
    // cannot have been "treat grouped output as harmless".
    const db = await clone('missingtable');
    await on(db, `DROP TABLE IF EXISTS "${HARDCODED_TABLE}" CASCADE`);

    const r = runGate(db);
    expect(r.status, 'a missing table must stop the deploy').not.toBe(0);
    expect(r.out).toMatch(/SCHEMA MISMATCH/);
    expect(r.out).toMatch(new RegExp(HARDCODED_TABLE));
    // ...and it must be reported as an understood difference, not a parser gap.
    expect(r.out).not.toMatch(/could not parse/);
  }, 180_000);

  // ── T7 · inspection is inspection ───────────────────────────────────────
  it('T7 — verification does not modify the database it inspects', async () => {
    // Run the gate against a database it will REJECT: the failure path is where
    // a "helpful" repair would be tempting, and where the old script wrote.
    const db = await clone('readonly');
    await on(db, 'ALTER TABLE "decisions" DROP COLUMN "rootCause"');
    const before = await fingerprint(db);

    const r = runGate(db);
    expect(r.status).not.toBe(0);

    const after = await fingerprint(db);
    expect(after.schema, 'the gate altered the schema it was inspecting').toBe(before.schema);
    expect(after.history, 'the gate wrote to migration history').toBe(before.history);
  }, 180_000);
});
