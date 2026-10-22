// ============================================================
// Execution schema readiness (B5-01R‴)
// ============================================================
// THE PROPERTY
//
//   A worker running against a database whose schema is older than the worker's
//   own code must produce ZERO provider mutations.
//
// That property already held before this file existed — but by accident.
// B5-01R measured it: ExecutionLifecycleService.transition() reads the whole
// ExecutionRequest row, so a column the datamodel declares and the database
// lacks makes Prisma throw P2022 before the platform call. B5-01R′ pinned that
// behaviour so it could not vanish silently, and measured what happens when it
// does: narrowing that one read produced TWO real platform mutations across
// three BullMQ attempts.
//
// A ratchet on an accident is a floor, not a policy. This file is the policy.
//
// ── WHAT "COMPATIBLE" MEANS HERE ────────────────────────────────────────────
// Every migration SHIPPED IN THIS IMAGE has one clean completed receipt whose
// checksum matches the actual shipped SQL bytes. All receipts, including newer
// ones, must be unique and clean; an unknown name alone is not incompatibility.
//
// The comparison is deliberately one-directional. A database carrying MORE
// migrations than the image is READY: that is the normal state during a rollout
// (backend migrates, then the new worker replaces the old one) and after a
// rollback, and refusing it would turn an ordinary deploy into an outage. Only
// the database being BEHIND the code is unsafe, because only then does the code
// name things that do not exist.
//
// ── WHY NOT THE OTHER CANDIDATES ────────────────────────────────────────────
//   SELECT 1                  reachable ≠ compatible. Explicitly rejected: the
//                             existing lifecycle healthCheck() is exactly this,
//                             which is why it cannot serve as readiness.
//   a required-column list    a second, hand-maintained copy of the schema, and
//                             it drifts the first time someone forgets it.
//   a Prisma model probe      would depend on the same default-projection
//                             behaviour this file exists to stop depending on.
//   migrate diff              needs the Prisma CLI at runtime; the worker's
//                             build is `npm install && npx prisma generate`
//                             under NODE_ENV=production, so the CLI is not a
//                             dependency this may rely on. Also far too heavy.
//
// `_prisma_migrations` is read with RAW SQL on purpose — no model, no
// projection, no dependency on the generated client agreeing with the database.
// That independence is the whole point (B5-01R‴ I3).
//
// ── OBSERVATIONAL ───────────────────────────────────────────────────────────
// One SELECT. This never applies a migration, never alters schema, never writes
// history, never touches an execution row.
// ============================================================
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { prisma } from '../../lib/prisma.js';

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)), '../../../prisma/migrations',
);

export class SchemaNotReadyError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'SchemaNotReadyError';
    this.code = 'SCHEMA_NOT_READY';
    Object.assign(this, detail);
  }
}

/** Migration directory names shipped in this image, in Prisma's own ordering. */
export function shippedMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{14}_/.test(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Observational. Returns the comparison; throws nothing for an incompatible
 * database — only the caller decides what an answer means.
 */
export async function checkExecutionSchemaReady(client = prisma) {
  const shipped = shippedMigrations();
  if (!shipped.length) throw new Error('shipped migration sources are missing');
  const checksums = new Map(shipped.map(name => [name, createHash('sha256')
    .update(readFileSync(resolve(MIGRATIONS_DIR, name, 'migration.sql'))).digest('hex')]));
  // A tagged template, never the Unsafe variant. This query takes no input at
  // all, so the pre-built string bought nothing — it only kept the one shape
  // that becomes an injection the day someone adds a filter to it, which is why
  // the security gate forbids the shape rather than judging each use. Still RAW
  // SQL, which is the point above: no model, no projection, no dependency on
  // the generated client agreeing with the database (I3).
  const rows = await client.$queryRaw`
    SELECT migration_name,checksum,applied_steps_count,
      finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back,
      logs IS NULL OR logs='' AS clean_log,
      started_at IS NOT NULL AND finished_at>=started_at AND finished_at<=clock_timestamp() AS ordered
    FROM public._prisma_migrations
  `;
  const counts = new Map();
  for (const row of rows) counts.set(row.migration_name, (counts.get(row.migration_name) || 0) + 1);
  // Prisma5.22 migrate deploy on PG17 records one applied deployment step,
  // including multi-statement migration76. Zero/other counts do not establish
  // that execution here. Resolve/recovery histories are not auto-normalized.
  const invalid = new Set(rows.filter(r => typeof r.migration_name !== 'string' || !r.migration_name
    || counts.get(r.migration_name) !== 1 || r.finished !== true || r.rolled_back !== false
    || r.clean_log !== true || r.ordered !== true || r.applied_steps_count !== 1
    || typeof r.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(r.checksum)
    || (checksums.has(r.migration_name) && r.checksum !== checksums.get(r.migration_name)))
    .map(r => r.migration_name));
  const applied = new Set(rows.filter(r => !invalid.has(r.migration_name)).map(r => r.migration_name));
  const missing = shipped.filter((m) => !applied.has(m));
  return {
    ready: missing.length === 0 && invalid.size === 0,
    missing,
    invalidCount: invalid.size,
    shippedCount: shipped.length,
    appliedCount: applied.size,
  };
}

// Memoised on SUCCESS ONLY. A ready answer remains permanent and costs
// one query per worker. This historical cache policy is deliberately unchanged:
// first success is not continuous history/freshness or whole-process admission.
// A NOT-READY answer is never cached: the next job
// re-asks, which is how recovery happens when the backend's migration lands.
// No timer, no poll loop, no sleep — the only moment readiness matters is the
// moment a job arrives (B5-01R‴ I5).
let readyOnce = false;

/** Test seam. Production never calls this. */
export function __resetReadinessCache() { readyOnce = false; }

/**
 * FAIL CLOSED. Throws SchemaNotReadyError unless every shipped migration is
 * recorded applied — including when the check itself cannot run, which is the
 * case where "assume ready" would be most tempting and most wrong. A missing
 * `_prisma_migrations` table is not an unknown, it is a database this worker
 * must not act against.
 */
export async function assertExecutionSchemaReady(client = prisma) {
  if (readyOnce) return;

  let result;
  try {
    result = await checkExecutionSchemaReady(client);
  } catch (err) {
    throw new SchemaNotReadyError(
      `execution schema readiness could not be determined: ${err.message}`,
      { cause: err },
    );
  }

  if (!result.ready) {
    if (result.invalidCount) {
      throw new SchemaNotReadyError(
        'execution migration history is unqualified: ambiguous or invalid receipts. Refusing to execute.',
        { missing: result.missing },
      );
    }
    const shown = result.missing.slice(0, 5);
    throw new SchemaNotReadyError(
      `database is behind this worker: ${result.missing.length} of ${result.shippedCount} `
      + `migration(s) shipped with this code are not applied `
      + `(${shown.join(', ')}${result.missing.length > shown.length ? ', …' : ''}). `
      + 'Refusing to execute — the backend deploy has not finished migrating.',
      { missing: result.missing },
    );
  }

  readyOnce = true;
}
