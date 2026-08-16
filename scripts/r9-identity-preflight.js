#!/usr/bin/env node
// ============================================================
// MARCOM — R9 Canonical Index · uniqueness preflight audit
// ============================================================
// READ-ONLY. Answers the one question that has to be answered before the entity
// uniqueness migration may be applied:
//
//   Does the existing data already satisfy
//   UNIQUE (workspaceId, channel, externalId)
//   on accounts / campaign_entities / ad_sets / ads / creatives?
//
// WHY THIS EXISTS
//   Nothing in the database enforces that one platform campaign is one row. The
//   entity models have no unique constraint beyond their primary key, so
//   uniqueness is maintained entirely by `detId(workspaceId, channel, level,
//   externalId)` in application code. That has held only for as long as every
//   write path has gone through detId — which is an assumption, not a guarantee,
//   and R9 §16 is explicit that application-level uniqueness is not equivalent
//   to DB-level uniqueness.
//
//   The migration therefore cannot be written blind. `CREATE UNIQUE INDEX` fails
//   outright on a table that already contains duplicates, and this repo runs
//   `prisma migrate deploy` inside its Render build (see scripts/prisma-migrate-safe.js),
//   so an unverified constraint does not fail in review — it fails the deploy.
//
// WHAT IT DOES NOT DO
//   It does not delete, merge, rewrite or "repair" anything. If it finds
//   violations it prints them and exits non-zero. Choosing a cleanup policy for
//   real customer data is a human decision, not a script's.
//
// USAGE
//   node scripts/r9-identity-preflight.js          # audit the configured DATABASE_URL
//
// EXIT CODES
//   0  clean — the migration can be applied
//   1  violations found — DO NOT apply the migration; report the rows
//   2  could not run (no database reachable)
// ============================================================
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// table → the Prisma delegate that reads it. The tuple is identical for all
// five: the model itself supplies the level dimension, so `level` is NOT part of
// the constraint (an Account and a Campaign live in different tables and cannot
// collide with each other however similar their externalIds look).
const TABLES = [
  { table: 'accounts', model: 'Account' },
  { table: 'campaign_entities', model: 'Campaign' },
  { table: 'ad_sets', model: 'AdSet' },
  { table: 'ads', model: 'Ad' },
  { table: 'creatives', model: 'Creative' },
];

/**
 * Duplicate (workspaceId, channel, externalId) groups in one table.
 *
 * `externalId IS NOT NULL` is not a convenience filter — it is the correct
 * predicate. Prisma emits a plain `CREATE UNIQUE INDEX`, and PostgreSQL indexes
 * default to NULLS DISTINCT, so two rows whose externalId is NULL do NOT
 * conflict with each other. Counting them as duplicates would report violations
 * the constraint would never raise (R9 §17, Step B).
 */
async function duplicatesIn(table) {
  return prisma.$queryRawUnsafe(`
    SELECT "workspaceId"::text AS workspace_id,
           "channel"::text     AS channel,
           "externalId"        AS external_id,
           COUNT(*)::int       AS row_count,
           array_agg("id"::text ORDER BY "createdAt") AS row_ids
    FROM "${table}"
    WHERE "externalId" IS NOT NULL
    GROUP BY "workspaceId", "channel", "externalId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 200
  `);
}

/** Rows with no external identity at all — reported, never counted as violations. */
async function nullExternalIdCount(table) {
  const [{ n }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "externalId" IS NULL`,
  );
  return n;
}

/**
 * The specific damage the old googleNormalize fallback could have done: every
 * Google row lacking BOTH a platform id and a name became
 * externalId = 'unknown', so they all collapsed onto ONE campaign entity. Such a
 * row is not a uniqueness violation (there is only one of it per workspace) but
 * it IS a fabricated entity carrying summed spend, and it should be identified
 * before the constraint freezes it in place.
 */
async function unknownIdentityRows(table) {
  return prisma.$queryRawUnsafe(`
    SELECT "id"::text AS id, "workspaceId"::text AS workspace_id, "name", "channel"::text AS channel
    FROM "${table}"
    WHERE "externalId" = 'unknown'
    LIMIT 100
  `);
}

async function main() {
  console.log('=== R9 · entity uniqueness preflight ===');
  console.log('constraint under test: UNIQUE (workspaceId, channel, externalId)');
  console.log('mode: READ-ONLY — this script never writes\n');

  let violations = 0;
  let unknowns = 0;

  for (const { table, model } of TABLES) {
    const [dups, nulls, unknownRows] = await Promise.all([
      duplicatesIn(table),
      nullExternalIdCount(table),
      unknownIdentityRows(table),
    ]);

    const status = dups.length === 0 ? 'OK' : 'VIOLATION';
    console.log(`${status.padEnd(9)} ${model.padEnd(9)} (${table})`);
    console.log(`          null externalId rows: ${nulls}  — not violations (NULLS DISTINCT)`);

    if (unknownRows.length > 0) {
      unknowns += unknownRows.length;
      console.log(`          ⚠ ${unknownRows.length} row(s) with externalId = 'unknown' (fabricated identity):`);
      for (const r of unknownRows) {
        console.log(`              id=${r.id} workspace=${r.workspace_id} channel=${r.channel} name=${JSON.stringify(r.name)}`);
      }
    }

    for (const d of dups) {
      violations += 1;
      console.log(`          ✗ workspace=${d.workspace_id} channel=${d.channel} externalId=${JSON.stringify(d.external_id)} rows=${d.row_count}`);
      console.log(`              ids: ${d.row_ids.join(', ')}`);
    }
    console.log('');
  }

  if (unknowns > 0) {
    console.log(`NOTE: ${unknowns} row(s) carry the retired 'unknown' identity. googleNormalize no longer`);
    console.log("      creates these, but existing rows persist and remain fabricated entities.\n");
  }

  if (violations > 0) {
    console.log(`RESULT: ${violations} violating group(s). DO NOT apply the uniqueness migration.`);
    console.log('        Report the rows above. Do not delete, merge, or re-key them without an');
    console.log('        explicitly approved deterministic cleanup procedure.');
    process.exit(1);
  }

  console.log('RESULT: clean — every existing row already satisfies the constraint.');
  console.log('        The uniqueness migration can be generated and applied.');
}

main()
  .catch((err) => {
    console.error('\nPREFLIGHT COULD NOT RUN — the audit is inconclusive, not clean.');
    console.error(err.message);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
