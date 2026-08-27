// ============================================================
// dbIsolation — one physical database per Vitest worker (B5-01H)
// ============================================================
// B5-Discovery-03 proved STOP-4 structurally, not as a flake: memoryManager
// creates `test-provider-1`, budgetAllocator's beforeEach runs
// `deleteMany({ provider: { startsWith: 'test-' } })`, and vitest runs those
// files in PARALLEL workers against one database. Executing the two clauses in
// sequence deletes the other suite's live fixture every time; concurrency only
// decides whether it lands mid-assertion.
//
// The census for this slice found the problem is not two suites:
//
//     29 test files reach real PostgreSQL
//     12 identities are shared by files that BOTH reach it
//        · 10 inside the reinforcement-engine trio, including the workspace
//          UUIDs …0001/…0002 that both memoryManager and scoringEngine UPSERT
//          (the observed "Unique constraint failed on (id)")
//        ·  00000000-0000-4000-8000-0000000000ff across three execution
//           contract suites
//        ·  00000000-0000-4000-8000-00000000dead across two more
//      4 files delete by prefix rather than by owned id
//
// ── WHY DATABASE-LEVEL, NOT NAMESPACES ──────────────────────────────────────
// A namespace strategy would have to rewrite fixtures across 29 files and 12
// identity families, and one missed predicate silently reopens the hole — the
// mechanism would depend on every future test author remembering it. Database
// separation makes the five required properties true by construction: two
// workers cannot see, delete, update, collide with, or break each other's rows,
// because they are not looking at the same rows.
//
// Cost, measured: `prisma migrate deploy` on the template 3s ONCE, then
// ~360ms per worker via `CREATE DATABASE … TEMPLATE`, which is a file-level
// copy rather than a replay of 66 migrations.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
// Isolation is provisioned for `npm run test:full` only. Fast mode is
// deliberately unchanged: it claims nothing about database semantics (B5-01G),
// and provisioning there would both slow the fast loop and start executing DB
// suites that currently skip. The residual is stated in CLAUDE.md.
// ============================================================
import { availableParallelism } from 'node:os';

/**
 * How many workers the fork pool may use. Pinned rather than defaulted so the
 * provisioner and the pool agree on the count — a worker whose database was
 * never created must not exist. Still genuinely parallel (see §14): this is the
 * pool's normal width, not a serialisation.
 */
export const MAX_WORKERS = Math.max(2, Math.min(availableParallelism() - 1, 12));

/** The env var that designates a database as safe to destroy and recreate. */
export const TEST_DB_ENV = 'TEST_DATABASE_URL';

export class IsolationSetupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IsolationSetupError';
    this.code = 'DB_ISOLATION_UNAVAILABLE';
  }
}

/** PURE: host:port/name — the identity two URLs must not share. */
export function databaseIdentity(url) {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

/** PURE: never let a connection string reach a log or an error message. */
export const scrubUrl = (text) => String(text ?? '').replace(/\/\/[^/\s@]*@/g, '//<redacted>@');

/** PURE: the maintenance connection used to CREATE/DROP databases. */
export function adminUrl(base) {
  const u = new URL(base);
  u.pathname = '/postgres';
  return u.toString();
}

/** PURE: the database name this URL points at. */
export const databaseName = (url) => new URL(url).pathname.replace(/^\//, '');

/** PURE: template and per-worker database names, derived from one root. */
export const templateName = (root) => `${root}_tmpl`;
export const workerName = (root, poolId) => `${root}_w${poolId}`;

/** PURE: the same URL pointed at a different database on the same server. */
export function urlForDatabase(base, name) {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * The ambient-development-database guard (§15).
 *
 * Full verification DROPS and RECREATES databases derived from this root, so
 * "is it a test database?" cannot be answered by a naming convention or by
 * NODE_ENV — it is answered by requiring an explicit, separate designation AND
 * by comparing the actual PostgreSQL identity against the ambient one.
 *
 * @param {object} env — the environment to read (injectable, so this is testable)
 * @returns {string} the validated test-database root URL
 */
export function resolveIsolationRoot(env = process.env) {
  const test = env[TEST_DB_ENV];
  if (!test) {
    throw new IsolationSetupError(
      `${TEST_DB_ENV} is not set. Full verification provisions throwaway databases and must never\n`
      + '  be pointed at a database anyone cares about, so it will not silently fall back to\n'
      + '  DATABASE_URL. See "Full verification" in CLAUDE.md.',
    );
  }

  let identity;
  try {
    identity = databaseIdentity(test);
  } catch {
    throw new IsolationSetupError(`${TEST_DB_ENV} is not a valid connection URL.`);
  }

  const ambient = env.DATABASE_URL;
  if (ambient) {
    let ambientIdentity = null;
    try { ambientIdentity = databaseIdentity(ambient); } catch { /* unparseable ambient is not a collision */ }
    if (ambientIdentity && ambientIdentity === identity) {
      throw new IsolationSetupError(
        `${TEST_DB_ENV} resolves to the SAME PostgreSQL database as DATABASE_URL (${identity}).\n`
        + '  Full verification creates and drops databases derived from it. Point it at a separate\n'
        + '  database on any server — it does not need to exist beforehand.',
      );
    }
  }
  return test;
}
