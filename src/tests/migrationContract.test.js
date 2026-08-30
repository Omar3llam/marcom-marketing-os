// ============================================================
// Migration completeness ratchet (B5-01M)
// ============================================================
// B5-01H made every worker database descend from a template that is dropped,
// recreated EMPTY, and migrated by `prisma migrate deploy` on every run, with a
// non-zero status failing the run. B5-01L measured that lifecycle and found it
// sound: an incomplete database supplied as TEST_DATABASE_URL is not merely
// tolerated, it is ignored — the template is rebuilt from scratch regardless.
//
// What B5-01L also found is the gap this file closes:
//
//     `prisma migrate deploy` guarantees EVERY MIGRATION FILE WAS APPLIED.
//     It does not guarantee THE MIGRATION SET EXPRESSES schema.prisma.
//
// Measured, on this repository: `migrate diff --from-migrations
// --to-schema-datamodel` exits 2 today. Every current difference is accounted
// for below. But nothing asserted that, and B5-01L proved the cost — a template
// built from 55 of 66 migrations produced `39/39 passed, exit 0` because no
// executed test happened to touch the gap. Silence is the failure mode.
//
// ── WHY NOT IN dbProbe ──────────────────────────────────────────────────────
// The probe runs INSIDE a worker, once per DB-gated file, against a database
// already cloned from the migrated template. Asking it about migration
// completeness would answer a settled question 28 times per run, at the one
// place that cannot act on the answer. B5-01L proved the probe is not
// load-bearing here: hard-wiring it to `return true` changed nothing.
// Ownership stays where B5-01H put it — provisioning owns migration
// correctness, the probe owns availability.
//
// ── COST ────────────────────────────────────────────────────────────────────
// This file adds NO per-worker migration work. It runs in one worker, uses its
// OWN disposable databases, and never touches the ones the run under test uses.
// ============================================================
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { databaseIdentity, databaseName, urlForDatabase, adminUrl } from './dbIsolation.js';
// B5-01Q moved these OUT of this file. The production migration gate
// (scripts/prisma-migrate-safe.js) now asks the same question of the deploy
// target that this file asks of the migration set, and two copies of an
// allow-list is two allow-lists. Re-exported below so this file's own
// hygiene tests, and anything importing them from here, keep working.
import { ALLOWED, parseDiff, classify, tableMatches } from '../../scripts/migrationDiff.js';

export { ALLOWED, parseDiff, classify };

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PRISMA = resolve(REPO, 'node_modules/prisma/build/index.js');
const ROOT = process.env.TEST_DATABASE_URL;

// Full verification only. In fast mode there is no designated throwaway server
// to build a shadow database on, and fast mode claims nothing about database
// semantics anyway (B5-01G).
const ENABLED = Boolean(ROOT);

const ROOT_NAME = ENABLED ? databaseName(ROOT) : null;
const SHADOW_DB = ENABLED ? `${ROOT_NAME}_mdiff` : null;   // for migrate diff
const PROV_ROOT = ENABLED ? `${ROOT_NAME}_mc` : null;      // for the provisioning ratchet

// The allow-list, parseDiff and classify now live in scripts/migrationDiff.js
// (imported above) so the production gate and this ratchet share one definition.


/**
 * Apply the repository's migration set to our own disposable database, then
 * diff that RESULT against the datamodel.
 *
 * `--from-migrations --shadow-database-url` expresses the same comparison and
 * was the obvious first choice, but measured ~18s inside the suite versus ~2s
 * for this shape, and the two produce byte-identical output on this repository
 * (verified before switching). Diffing the applied result is also the more
 * honest question: it asks what the migrations ACTUALLY BUILD, which is what a
 * worker database is a clone of.
 */
function buildAndDiff(dbUrl) {
  const env = { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl };
  const applied = spawnSync(process.execPath, [PRISMA, 'migrate', 'deploy'], { cwd: REPO, encoding: 'utf8', env });
  if (applied.status !== 0) {
    return { status: applied.status, out: `migrate deploy failed:\n${applied.stdout ?? ''}${applied.stderr ?? ''}`, applyFailed: true };
  }
  const r = spawnSync(process.execPath, [
    PRISMA, 'migrate', 'diff',
    '--from-url', dbUrl,
    '--to-schema-datamodel', 'prisma/schema.prisma',
    '--exit-code',
  ], { cwd: REPO, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), applyFailed: false };
}

const sql = (url) => postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });

describe.skipIf(!ENABLED)('B5-01M · migration completeness ratchet', () => {
  let admin;
  let rawDiff = '';
  let differences = [];

  beforeAll(async () => {
    // ── STOP-4: the shadow lifecycle must be ours alone ──────────────────
    // Never the development database, never the root the workers derive from,
    // and never a worker database. Compared on PostgreSQL identity, not string.
    const ambient = process.env.DATABASE_URL;
    if (ambient) {
      expect(databaseIdentity(urlForDatabase(ROOT, SHADOW_DB)))
        .not.toBe(databaseIdentity(ambient));
    }
    expect(SHADOW_DB).not.toBe(ROOT_NAME);
    expect(SHADOW_DB).not.toMatch(/_w\d+$/);
    expect(SHADOW_DB).not.toBe(process.env.LUMI_TEST_DB_NAME);

    admin = sql(adminUrl(ROOT));
    await admin.unsafe(`DROP DATABASE IF EXISTS "${SHADOW_DB}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${SHADOW_DB}"`);

    const r = buildAndDiff(urlForDatabase(ROOT, SHADOW_DB));
    // A migration set that cannot even be applied is a harder failure than
    // drift, and must not be reported as "no differences found".
    expect(r.applyFailed, r.out).toBe(false);
    rawDiff = r.out;
    differences = parseDiff(rawDiff);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    // Drop what this file created, and ONLY that. Concurrently: a serial loop
    // over ~18 DROP DATABASE statements measured ~19s on this platform, which
    // is most of what this file would otherwise cost the suite.
    const names = await admin`
      SELECT datname FROM pg_database
      WHERE datname = ${SHADOW_DB} OR datname = ${`${PROV_ROOT}_tmpl`} OR datname LIKE ${`${PROV_ROOT}_w%`}`;
    await Promise.all(names.map(async ({ datname }) => {
      const c = sql(adminUrl(ROOT));
      try { await c.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`); }
      catch { /* teardown is best-effort; the next run drops it anyway */ }
      finally { await c.end({ timeout: 5 }).catch(() => {}); }
    }));
    await admin.end({ timeout: 5 }).catch(() => {});
  }, 120_000);

  // ── CONTRACT 1 · the migration set expresses the schema ─────────────────
  it('every migration/schema difference is explicitly classified', () => {
    const unexpected = differences.filter((d) => classify(d) === null);
    expect(
      unexpected.map((d) => `${d.table}: ${d.change}`),
      'Unclassified migration/schema divergence.\n'
      + 'The migration set no longer expresses prisma/schema.prisma, and nothing else in the\n'
      + 'suite would notice: B5-01L measured a template built from 55 of 66 migrations passing\n'
      + '39/39 with exit 0. Either add the missing migration, or — if this difference is another\n'
      + 'case Prisma cannot represent — add an ALLOW-LIST entry with a NAMED REASON.\n\n'
      + `── raw migrate diff ──\n${rawDiff}\n──────────────────────`,
    ).toEqual([]);
  });

  it('reports the classified differences it is deliberately tolerating', () => {
    // Prints what is being allowed, so a passing run still SHOWS the tolerated
    // set rather than implying it by silence. A ratchet nobody can read is a
    // ratchet nobody maintains.
    const byEntry = new Map();
    for (const d of differences) {
      const a = classify(d);
      if (!a) continue;
      byEntry.set(a.id, (byEntry.get(a.id) ?? 0) + 1);
    }
    const lines = [...byEntry].map(([id, n]) => `    ${String(n).padStart(2)} × ${id}`);
    console.info(
      `[migration-contract] ${differences.length} raw difference(s) from migrate diff, `
      + `all classified:\n${lines.join('\n')}`,
    );

    const known = differences.filter((d) => classify(d) !== null);
    expect(known.length).toBeGreaterThan(0);
    expect(known.length).toBe(differences.length);
  });

  // ── ALLOW-LIST HYGIENE (§7) ─────────────────────────────────────────────
  it('every allow-list entry names a table and carries a non-empty reason', () => {
    for (const a of ALLOWED) {
      expect(a.id, 'entry needs a stable id').toBeTruthy();
      expect(typeof a.reason === 'string' && a.reason.trim().length > 20,
        `${a.id}: reason must explain WHY, not just assert`).toBe(true);
      expect(a.table, `${a.id}: must name a table`).toBeTruthy();
      expect(a.pattern instanceof RegExp, `${a.id}: needs a pattern`).toBe(true);
    }
    expect(new Set(ALLOWED.map((a) => a.id)).size).toBe(ALLOWED.length);
  });

  it('no allow-list matcher is broad enough to swallow an unrelated change', () => {
    // MCE's guard. A matcher that admits any of these canaries is a wildcard
    // wearing a table name, and would turn the ratchet into decorative plumbing.
    const canaries = [
      '[+] Added column `__b5m_canary__`',
      '[-] Removed column `__b5m_canary__`',
      '[*] Altered column `__b5m_canary__` (arity changed from Nullable to Required)',
      '[+] Added index on columns (__b5m_canary__)',
      '[-] Removed index on columns (__b5m_canary__)',
      '[+] Added unique index on columns (__b5m_canary__)',
      '[-] Removed foreign key on columns (__b5m_canary__)',
      '[*] Renamed index `__b5m_canary__` to `__b5m_canary2__`',
    ];
    const offenders = [];
    for (const a of ALLOWED) {
      for (const table of ['decisions', 'users', 'workspaces', 'audit_logs', 'execution_requests', 'provider_performance_metrics']) {
        for (const c of canaries) {
          if (tableMatches(a.table, table) && a.pattern.test(c)) offenders.push(`${a.id} swallows "${c}" on ${table}`);
        }
      }
    }
    expect(offenders, 'allow-list matchers must be narrow').toEqual([]);
  });

  it('no allow-list entry is dead — each still matches a real current difference', () => {
    // Stops the list becoming a junk drawer of exemptions for problems that
    // were fixed years ago and would now hide a fresh regression.
    const dead = ALLOWED.filter((a) => !differences.some((d) => classify(d) === a));
    expect(dead.map((a) => a.id), 'remove entries that no longer describe reality').toEqual([]);
  });

  // ── CONTRACT 2 · the provisioning invariant (P1/P2/P3) ──────────────────
  it('P1 · a pre-existing template is destroyed, never inherited', async () => {
    // Behavioural, not textual. Seed a template with a sentinel, run the REAL
    // globalSetup in a child process, and require the sentinel to be gone.
    // A conditional "reuse if present" path would let it survive.
    const provRootUrl = urlForDatabase(ROOT, PROV_ROOT);
    const tmpl = `${PROV_ROOT}_tmpl`;
    await admin.unsafe(`DROP DATABASE IF EXISTS "${tmpl}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${tmpl}"`);

    const seeded = sql(urlForDatabase(ROOT, tmpl));
    try {
      await seeded.unsafe('CREATE TABLE "__b5m_stale_sentinel__" (id int)');
    } finally { await seeded.end({ timeout: 5 }); }

    const child = spawnSync(process.execPath, ['-e',
      "import('./src/tests/globalSetup.js').then(m => m.default()).then(() => process.exit(0), e => { console.error(e.message); process.exit(1); })",
    ], {
      cwd: REPO, encoding: 'utf8',
      env: {
        ...process.env,
        REQUIRE_DB: '1',
        TEST_DATABASE_URL: provRootUrl,
        LUMI_TEST_DB_ROOT: undefined,
      },
    });
    expect(child.status, `globalSetup failed: ${child.stderr}`).toBe(0);

    const after = sql(urlForDatabase(ROOT, tmpl));
    try {
      const [{ count: sentinel }] = await after`
        SELECT count(*)::int FROM information_schema.tables
        WHERE table_schema='public' AND table_name='__b5m_stale_sentinel__'`;
      const [{ count: applied }] = await after`
        SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
      expect(sentinel, 'the previous template survived — provisioning reused stale schema state').toBe(0);
      expect(applied, 'the rebuilt template must carry the full migration set').toBeGreaterThan(60);
    } finally { await after.end({ timeout: 5 }); }
  }, 180_000);

  it('P2/P3 · one migration authority, and its failure is fail-closed', () => {
    const setup = readFileSync(resolve(REPO, 'src/tests/globalSetup.js'), 'utf8');
    // P2 — exactly one migrate invocation owns the verification lifecycle.
    expect((setup.match(/'migrate',\s*'deploy'/g) ?? []).length).toBe(1);
    expect(setup).toMatch(/DROP DATABASE IF EXISTS/);
    expect(setup).toMatch(/CREATE DATABASE/);
    // P3 — a non-zero status still ends the run. Code shape, not prose: the
    // status is tested and an IsolationSetupError is thrown from that branch.
    expect(setup).toMatch(/migrate\.status\s*!==\s*0/);
    const branch = /migrate\.status\s*!==\s*0\s*\)\s*\{[\s\S]{0,400}?throw new IsolationSetupError/;
    expect(branch.test(setup), 'a failed migration must still throw, not warn-and-continue').toBe(true);
    // ...and no second migration path may appear elsewhere in the test harness.
    for (const f of ['src/tests/workerDb.js', 'src/tests/dbIsolation.js', 'scripts/run-tests.js']) {
      expect(readFileSync(resolve(REPO, f), 'utf8')).not.toMatch(/'migrate',\s*'deploy'/);
    }
  });
});
