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
//   write path has gone through detId — an assumption, not a guarantee, and R9
//   is explicit that application-level uniqueness is not equivalent to DB-level
//   uniqueness.
//
//   The migration cannot be written blind. `CREATE UNIQUE INDEX` fails outright
//   on a table that already contains duplicates, and this repo runs
//   `prisma migrate deploy` inside its Render build (scripts/prisma-migrate-safe.js),
//   so an unverified constraint does not fail in review — it fails the deploy.
//
// WHY IT REFUSES MORE THAN IT USED TO
//   The first version of this script asked only "are there duplicates?" and, on
//   a database with five empty tables, printed "clean — the migration can be
//   applied". That is a fabricated green: it had audited nothing and said the
//   migration was safe. An audit that cannot distinguish "verified against real
//   data" from "found nothing because there is nothing here" is worse than no
//   audit, because it is quotable.
//
//   So the script now establishes, in order, and STOPS at the first failure:
//     A. which database it is actually connected to
//     B. whether migration history exists at all
//     C. whether every migration in prisma/migrations has been applied
//     D. row counts per model  (an empty audit is reported AS empty)
//     E. NULL externalId counts
//     F. duplicate (workspaceId, channel, externalId) tuples
//     G. detId integrity — stored.id === detId(ws, channel, level, externalId)
//     H. surviving 'unknown' fabricated identities
//
// WHAT IT DOES NOT DO
//   It does not delete, merge, rewrite or "repair" anything, and it never picks
//   a winner among duplicates. Choosing a cleanup policy for real customer data
//   is a human decision, not a script's.
//
// USAGE
//   npm run r9-preflight
//
// EXIT CODES
//   0  CLEAN     — audited real state; the migration can be generated
//   1  BLOCKED   — violations or drift found; DO NOT apply the migration
//   2  INCONCLUSIVE — could not establish state (unreachable, no history, …)
// ============================================================
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { readdirSync } from 'fs';
import { resolve } from 'path';
import { detId, ENTITY_LEVEL } from '../src/services/connectors/connectorTypes.js';

// The npm script runs plain `node`, which does not read .env on its own. Without
// this the script dies on a missing DATABASE_URL and the operator has to guess
// why — so load it the same way vitest.config.js does.
loadEnv({ path: resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

// table → model + the ENTITY_LEVEL constant the write path stamps into detId.
// The tuple is identical for all five: the model itself supplies the level, so
// `level` is NOT part of the constraint (an Account and a Campaign live in
// different tables and cannot collide with each other).
const TABLES = [
  { table: 'accounts',          model: 'Account',  level: ENTITY_LEVEL.ACCOUNT },
  { table: 'campaign_entities', model: 'Campaign', level: ENTITY_LEVEL.CAMPAIGN },
  { table: 'ad_sets',           model: 'AdSet',    level: ENTITY_LEVEL.ADSET },
  { table: 'ads',               model: 'Ad',       level: ENTITY_LEVEL.AD },
  { table: 'creatives',         model: 'Creative', level: ENTITY_LEVEL.CREATIVE },
];

const q = (sql) => prisma.$queryRawUnsafe(sql);

/** Connection target, credentials stripped. An audit must name what it audited. */
function target() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return { host: u.hostname, port: u.port || '5432', db: u.pathname.replace(/^\//, '') };
  } catch {
    return null;
  }
}

/**
 * Duplicate (workspaceId, channel, externalId) groups.
 *
 * `externalId IS NOT NULL` is not a convenience filter — it is the correct
 * predicate. Prisma emits a plain `CREATE UNIQUE INDEX`, and PostgreSQL indexes
 * default to NULLS DISTINCT, so two rows whose externalId is NULL do NOT
 * conflict. Counting them as duplicates would report violations the constraint
 * would never raise.
 */
const duplicatesIn = (table) => q(`
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

const rowCount = async (table) => (await q(`SELECT COUNT(*)::int AS n FROM "${table}"`))[0].n;

const nullExternalIdCount = async (table) =>
  (await q(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE "externalId" IS NULL`))[0].n;

/**
 * The specific damage the retired googleNormalize fallback could have done:
 * every Google row lacking BOTH a platform id and a name became
 * externalId = 'unknown', so they all collapsed onto ONE entity. Such a row is
 * not a uniqueness violation (there is only one per workspace) but it IS a
 * fabricated entity carrying summed spend, and the constraint would freeze it
 * in place.
 */
const unknownIdentityRows = (table) => q(`
  SELECT "id"::text AS id, "workspaceId"::text AS workspace_id, "name", "channel"::text AS channel
  FROM "${table}"
  WHERE "externalId" = 'unknown'
  LIMIT 100
`);

/**
 * detId integrity: every stored id must equal the derivation. A mismatch means
 * a row was created by something other than the canonical write path, and the
 * uniqueness assumption never applied to it. Reported, never repaired.
 */
async function detIdMismatches(table, level) {
  const rows = await q(`
    SELECT "id"::text AS id, "workspaceId"::text AS workspace_id,
           "channel"::text AS channel, "externalId" AS external_id
    FROM "${table}"
    WHERE "externalId" IS NOT NULL
  `);
  return rows.filter((r) => r.id !== detId(r.workspace_id, r.channel, level, r.external_id));
}

function bail(code, headline, detail) {
  console.log(`\nRESULT: ${headline}`);
  if (detail) console.log(detail);
  prisma.$disconnect();
  process.exit(code);
}

async function main() {
  console.log('=== R9 · entity uniqueness preflight ===');
  console.log('constraint under test: UNIQUE (workspaceId, channel, externalId)');
  console.log('mode: READ-ONLY — this script never writes\n');

  // ── A. what am I connected to? ─────────────────────────────────────────
  const t = target();
  if (!t) bail(2, 'INCONCLUSIVE — DATABASE_URL is unset or unparseable.');
  console.log(`target: ${t.host}:${t.port}/${t.db}`);
  if (t.host === 'localhost' || t.host === '127.0.0.1') {
    console.log('        ⚠ LOCAL database. A local result is not evidence about production.');
  }
  console.log('');

  // ── B/C. migration history ─────────────────────────────────────────────
  // A constraint audit is only meaningful against the schema the migration will
  // actually meet. If history is missing or behind, the tables in front of us
  // are not the tables the migration will run on.
  let applied;
  try {
    applied = await q('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
  } catch {
    bail(2,
      'INCONCLUSIVE — no _prisma_migrations table on this database.',
      '        The schema here was not created by the migration workflow (db push or manual).\n'
      + '        Reconcile migration history through the project\'s normal process first.\n'
      + '        A uniqueness migration must not be generated against an unmanaged schema.');
  }

  const onDisk = readdirSync(resolve(process.cwd(), 'prisma/migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const appliedNames = new Set(applied.map((r) => r.migration_name));
  const pending = onDisk.filter((m) => !appliedNames.has(m));
  const unknownApplied = [...appliedNames].filter((m) => !onDisk.includes(m));

  console.log(`migrations: ${onDisk.length} on disk, ${appliedNames.size} applied, ${pending.length} pending`);
  if (unknownApplied.length) {
    console.log(`            ⚠ ${unknownApplied.length} applied migration(s) not present on disk — database is AHEAD/DIVERGED:`);
    for (const m of unknownApplied) console.log(`                ${m}`);
  }
  if (pending.length) {
    console.log('            database is BEHIND schema.prisma. Pending:');
    for (const m of pending) console.log(`                ${m}`);
    bail(2,
      'INCONCLUSIVE — migration state is not current.',
      '        Apply the pending migrations through the normal workflow, then re-run.\n'
      + '        Generating a new migration against a drifted database is how history diverges.');
  }
  if (unknownApplied.length) {
    bail(2, 'INCONCLUSIVE — database is ahead of prisma/migrations.',
      '        Reconcile before generating a new migration.');
  }
  console.log('            ✅ migration state is current\n');

  // ── D–H. the data audit ────────────────────────────────────────────────
  let violations = 0;
  let unknowns = 0;
  let mismatches = 0;
  let totalRows = 0;

  for (const { table, model, level } of TABLES) {
    const [rows, dups, nulls, unknownRows, bad] = await Promise.all([
      rowCount(table), duplicatesIn(table), nullExternalIdCount(table),
      unknownIdentityRows(table), detIdMismatches(table, level),
    ]);
    totalRows += rows;

    const status = dups.length === 0 && bad.length === 0 ? 'OK' : 'VIOLATION';
    console.log(`${status.padEnd(9)} ${model.padEnd(9)} (${table})`);
    console.log(`          rows: ${rows}   null externalId: ${nulls} (not violations — NULLS DISTINCT)`);

    for (const d of dups) {
      violations += 1;
      console.log(`          ✗ DUPLICATE workspace=${d.workspace_id} channel=${d.channel} externalId=${JSON.stringify(d.external_id)} rows=${d.row_count}`);
      console.log(`              ids: ${d.row_ids.join(', ')}`);
    }
    for (const b of bad) {
      mismatches += 1;
      console.log(`          ✗ detId MISMATCH id=${b.id} workspace=${b.workspace_id} channel=${b.channel} externalId=${JSON.stringify(b.external_id)}`);
      console.log(`              expected: ${detId(b.workspace_id, b.channel, level, b.external_id)}`);
    }
    for (const r of unknownRows) {
      unknowns += 1;
      console.log(`          ⚠ FABRICATED IDENTITY 'unknown' id=${r.id} workspace=${r.workspace_id} channel=${r.channel} name=${JSON.stringify(r.name)}`);
    }
    console.log('');
  }

  if (violations || mismatches || unknowns) {
    const parts = [];
    if (violations) parts.push(`${violations} duplicate tuple group(s)`);
    if (mismatches) parts.push(`${mismatches} detId mismatch(es)`);
    if (unknowns) parts.push(`${unknowns} fabricated 'unknown' identity row(s)`);
    bail(1,
      `BLOCKED — ${parts.join(', ')}. DO NOT apply the uniqueness migration.`,
      '        Report the rows above. Do not delete, merge, or re-key them without an\n'
      + '        explicitly approved deterministic cleanup procedure.');
  }

  if (totalRows === 0) {
    console.log('RESULT: CLEAN — but ZERO entity rows were audited.');
    console.log('        The constraint cannot be violated by data that does not exist, so the');
    console.log('        migration is safe HERE. This says nothing about any other database.');
    console.log('        Confirm this is the environment the migration will actually run on.');
    return;
  }

  console.log(`RESULT: CLEAN — ${totalRows} entity rows audited; every one satisfies the constraint.`);
  console.log('        The uniqueness migration can be generated and applied.');
}

main()
  .catch((err) => {
    console.error('\nRESULT: INCONCLUSIVE — the preflight could not run. This is not a clean result.');
    console.error(err.message);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
