// ============================================================
// dbProbe — "is a usable database reachable?" for integration tests
// ============================================================
// Some backend suites are genuine DB-integration tests (they create/clean
// real rows). When no database is configured — or the configured one is
// behind on migrations — those suites should SKIP, not hard-fail, so the
// unit suite stays green locally while the integration suites still run in
// full against a migrated DB.
//
// Usage (top-level await is supported in vitest test files):
//   import { dbAvailable } from '../../tests/dbProbe.js';
//   const DB_OK = await dbAvailable();
//   describe.skipIf(!DB_OK)('my integration suite', () => { ... });
//
// The probe touches a recent column so a STALE schema reads as "not
// available" too (a partially-migrated DB would otherwise fail mid-suite).
//
// ── B5-01G · WHY SKIPPING IS A MODE, NOT A DEFAULT ──────────────────────────
// Skipping is honest for a fast local loop and dishonest for a run that claims
// full verification. B5-Discovery-03 measured the difference: with no usable
// database the suite reports `4631 passed | 330 skipped` and EXIT 0, and a real
// data-corruption defect in nonDailySnapshotWrite.js (timestamps three hours
// adrift; a re-upload inserting a duplicate revenue row instead of updating)
// survived that run untouched. The 330 tests that would have caught it never
// ran, and nothing in the output said so — this module's warning below is
// swallowed by vitest, so the only trace was the number 330.
//
// So the caller now declares which claim it is making, via REQUIRE_DB:
//
//     REQUIRE_DB unset   →  skipping permitted; the run claims nothing about
//                           database semantics
//     REQUIRE_DB=1       →  skipping is a FAILURE; an unusable database means
//                           the verification could not be performed
//
// The check lives HERE rather than in each suite on purpose. All 27 DB-gated
// files obtain their gate from this one function, so the requirement cannot be
// applied to 26 of them: there is no per-file switch to forget. `npm run
// test:full` sets the variable; see scripts/run-tests.js.
//
// This does NOT make the probe a migration-completeness check. It still only
// answers "can this suite talk to a schema new enough to use?", and
// B5-Discovery-03 proved it answers `true` for a database missing eleven
// migrations (STOP-2, still open). REQUIRE_DB changes what happens when the
// answer is `false`; it does not make the answer more trustworthy.
// ============================================================
import { PrismaClient } from '@prisma/client';

let cached;
let lastFailure = null;

/** The environment variable that turns a skipped DB suite into a failure. */
export const REQUIRE_DB_ENV = 'REQUIRE_DB';

/** Stable code, matched on `error.code` — never on the message. */
export const DB_VERIFICATION_REQUIRED = 'DB_VERIFICATION_REQUIRED';

/**
 * Does the current run claim to verify database semantics?
 * Read live rather than captured at import: a test may set it per-case.
 */
export function dbRequired() {
  return process.env[REQUIRE_DB_ENV] === '1';
}

export class DatabaseVerificationRequiredError extends Error {
  constructor(reason) {
    super(
      `${REQUIRE_DB_ENV}=1 but no migrated database is reachable, so this suite cannot be verified.\n`
      + `  probe failure: ${reason || 'unknown'}\n`
      + '  A skipped database suite is not a passing one. Either provide a migrated database\n'
      + '  (see "Verification" in CLAUDE.md) or run `npm run test:fast`, which makes no claim\n'
      + '  about database semantics.',
    );
    this.name = 'DatabaseVerificationRequiredError';
    this.code = DB_VERIFICATION_REQUIRED;
  }
}

/**
 * PURE: strip credentials from anything that looks like a connection URL.
 * Prisma's messages carry host:port, not passwords — but this error is meant to
 * be pasted into reports and CI logs, so the scrub is not conditional on trust.
 */
export function scrubConnectionSecrets(text) {
  return String(text ?? '').replace(/\/\/[^/\s@]*@/g, '//<redacted>@');
}

export async function dbAvailable() {
  if (cached === undefined) {
    const prisma = new PrismaClient();
    const timeout = new Promise((resolve) => setTimeout(() => resolve('probe timed out after 4000ms'), 4000));
    try {
      const probe = prisma.workspace
        .findFirst({ select: { id: true, networkConsent: true } })
        .then(() => null)
        .catch((err) => scrubConnectionSecrets(err.message).split('\n').filter(Boolean).join(' | '));
      lastFailure = await Promise.race([probe, timeout]);
      cached = lastFailure === null;
    } catch (err) {
      lastFailure = scrubConnectionSecrets(err.message);
      cached = false;
    } finally {
      await prisma.$disconnect().catch((err) => {
        console.warn('[dbProbe] failed to disconnect:', scrubConnectionSecrets(err.message));
      });
    }
    if (!cached) console.warn('[dbProbe] database probe failed:', lastFailure);
  }

  // Re-evaluated on every call, not just the first: the requirement belongs to
  // the RUN, and the probe result is cached for the process.
  if (!cached) {
    if (dbRequired()) throw new DatabaseVerificationRequiredError(lastFailure);
    console.warn('[dbProbe] no migrated database reachable — DB integration suites will skip.');
  }
  return cached;
}

/** Test-only: forget the cached probe result so a new condition can be measured. */
export function __resetDbProbeCache() {
  cached = undefined;
  lastFailure = null;
}
