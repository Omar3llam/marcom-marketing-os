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

// ── B5-01Z · sealing the template so nothing can re-attach to it ────────────
// `CREATE DATABASE … TEMPLATE` refuses while ANY backend holds the source.
// The original provisioner met that requirement by construction: it spawned
// `migrate deploy` as a child so the session died with the child. That is true
// but not sufficient — it assumes nothing ELSE ever connects.
//
// Measured against Neon on 2026-09-02, that assumption is false. A copy failed
// 24 consecutive times over 125s while `pg_stat_activity` showed ZERO sessions
// on the template throughout, because a background-worker launcher (Neon runs
// pg_cron and a TimescaleDB launcher) re-attaches to any CONNECTABLE database
// between the copy's check and its start. Each attempt burns ~5.1s inside
// PostgreSQL's own CheckOtherDBBackends wait, and whether it ever wins is a
// coin flip: a separate run succeeded on attempt 5.
//
// A race that cannot be observed cannot be won by terminating. So the door is
// closed instead: a database with datallowconn=false takes no new connections,
// which is exactly why template0 is not connectable and is therefore always
// copyable. Sealed, the same 6 copies succeeded on the FIRST attempt in
// 187–1024ms each, identically on Neon and on local PostgreSQL.
//
// ALTER DATABASE … ALLOW_CONNECTIONS needs database ownership plus CREATEDB,
// which the provisioner has because it just created the database. The
// superuser-only path — UPDATE pg_database — is refused on Neon (42501), and
// is not used here.

/** SQLSTATE raised when the copy source is occupied. */
export const SOURCE_IN_USE = '55006';

/** PURE: is this the "source database is being accessed by other users" error? */
export const isSourceInUseError = (err) => err?.code === SOURCE_IN_USE;

/** How many times a single copy may be re-attempted before the run fails. */
export const TEMPLATE_COPY_ATTEMPTS = 5;

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Make the template uncopyable-from-nobody: no new connections, then no old
 * ones either.
 *
 * The ORDER is the mechanism, not a detail. Evicting first and closing second
 * leaves a window the launcher reconnects through, which is the failure this
 * exists to remove. Closing first makes the eviction final.
 *
 * @param {(sql: string) => Promise<unknown[]>} exec — runs one statement
 * @param {string} tmpl — the template database name
 * @returns {Promise<number>} how many backends had to be evicted
 */
export async function sealTemplate(exec, tmpl) {
  await exec(`ALTER DATABASE "${tmpl}" WITH ALLOW_CONNECTIONS false`);
  const evicted = await exec(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity `
    + `WHERE datname = '${tmpl}' AND pid <> pg_backend_pid()`,
  );
  return Array.isArray(evicted) ? evicted.length : 0;
}

/**
 * Lift the seal. The template is only uncopyable-from while copies are being
 * made; afterwards it is an ordinary database again, and it has to be, because
 * migrationContract.test.js P1 connects to it to prove that a pre-existing
 * template was destroyed rather than inherited.
 *
 * Keeping the scope this narrow is deliberate: a permanent seal would buy
 * nothing (nothing copies from it again) and would silently break inspection.
 */
export async function unsealTemplate(exec, tmpl) {
  await exec(`ALTER DATABASE "${tmpl}" WITH ALLOW_CONNECTIONS true`);
}

/**
 * Retry a copy that lost the race anyway — defence in depth, not the mechanism.
 *
 * FAIL CLOSED (§21): bounded, and the only exit on exhaustion is the original
 * error. It never returns a sentinel, and it never retries an error that is not
 * source-in-use — a permission failure must surface immediately rather than be
 * spent against the budget.
 */
export async function withSourceInUseRetry(fn, { attempts = TEMPLATE_COPY_ATTEMPTS, sleep = defaultSleep } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!isSourceInUseError(err) || attempt >= attempts) throw err;
      await sleep(250 * attempt);
    }
  }
}

// ── B5-01Z · the per-test budget follows the database's distance ────────────
// Vitest's 5s default assumes queries are local. Against a remote verification
// database every query is an internet round trip, and 7 DB-heavy tests exceed
// the budget on latency alone — they pass unchanged at 30s (measured against
// Neon, 2026-09-02: 64/64 in the three affected files).
//
// This does NOT relax the budget for anyone else. Loopback — CI's postgres:15
// service and every local developer — keeps exactly the 5s it has today, and
// fast mode never widens it at all, because fast mode makes no database claim.
//
// It also does not reopen the hole networkGuard closed. B5-01P‴ deliberately
// stopped relying on the clock to catch stray network calls: violations are
// RECORDED and an afterEach fails the test on the record, precisely so a slow
// round trip is not the only evidence. The timeout is a runaway-test guard, not
// the network guard.

/** Loopback hosts, for which the local budget is correct. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);

/** The per-test budget when the verification database is not on this machine. */
export const REMOTE_TEST_TIMEOUT_MS = 30_000;

/**
 * PURE: is FULL verification pointed at a database that is not on loopback?
 *
 * Both halves matter. Fast mode makes no claim about database semantics, so a
 * remote URL sitting in the shell must not widen anything.
 */
export function isRemoteVerificationHost(env = process.env) {
  if (env.REQUIRE_DB !== '1') return false;
  const url = env[TEST_DB_ENV];
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (LOOPBACK_HOSTS.has(host)) return false;
    return !host.startsWith('127.');
  } catch {
    return false;                      // unparseable is not a distance claim
  }
}
