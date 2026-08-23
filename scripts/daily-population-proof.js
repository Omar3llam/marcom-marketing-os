#!/usr/bin/env node
// ============================================================
// B4-D — production population proof for the DAILY observation pipeline
// ============================================================
// Activating a dormant pipeline is only half the slice. The other half is being
// able to say what it actually produced — and to say it from the database that
// serves users, not from a local one that happens to be reachable.
//
// This script is the instrument for that measurement. It exists because the
// alternative is somebody typing queries by hand and reporting the numbers from
// memory, which is exactly the provenance failure this program keeps closing:
// a real count with no way to tell WHICH database answered.
//
// ── IT IS READ-ONLY, STRUCTURALLY ─────────────────────────────────────────────
// Every call below is count / groupBy / findMany / $queryRaw. There is no
// create, update, upsert, delete or $executeRaw anywhere in this file, and the
// contract test asserts that by reading the source. It never writes an
// OutcomeSnapshot — B4-D produces evidence, and the step from evidence to a
// scored outcome is a later slice with unanswered questions in front of it.
//
// ── IT NEVER INVENTS A NUMBER ─────────────────────────────────────────────────
// A zero population is a valid, reportable result. When the count is zero the
// script does not shrug: it classifies WHY from real rows — no connected
// accounts, no connector that implements daily, a sync that never ran, or a
// population that was fetched and refused. Guessing is the one outcome that is
// not allowed.
//
//   node scripts/daily-population-proof.js
//   node scripts/daily-population-proof.js --json
//
// Run it against production with the production DATABASE_URL in the environment.
// The header prints the host and database NAME so the reader can see which
// database answered; credentials are never printed.
// ============================================================
import { prisma } from '../src/lib/prisma.js';
import { MEASUREMENT_WINDOW } from '../src/services/connectors/connectorTypes.js';
import { classifyAndReduce, DAILY_OBSERVATION_SELECT } from '../src/services/daily-observations/dailyObservationReader.js';
import { areComparable } from '../src/services/daily-observations/observationComparability.js';
import { PLATFORM_DB } from '../src/services/connectors/credentialStore.js';

const DAY_MS = 86_400_000;
const JSON_OUT = process.argv.includes('--json');
const DAILY = MEASUREMENT_WINDOW.DAILY;

/** The database that answered — host and name only. Never the credentials. */
function provenance() {
  const raw = process.env.DATABASE_URL || '';
  try {
    const u = new URL(raw);
    return {
      host: u.host,
      database: u.pathname.replace(/^\//, '') || null,
      nodeEnv: process.env.NODE_ENV || null,
      dailyIngestionEnabled: process.env.DAILY_INGESTION_ENABLED ?? '(unset)',
      measuredAt: new Date().toISOString(),
    };
  } catch {
    return { host: null, database: null, nodeEnv: process.env.NODE_ENV || null, measuredAt: new Date().toISOString() };
  }
}

// ── F1 + F2 — how many rows, from whom, over what span ───────────────────────
async function population() {
  const total = await prisma.metricSnapshot.count({ where: { measurementWindow: DAILY } });

  const bySource = await prisma.metricSnapshot.groupBy({
    by: ['source'],
    where: { measurementWindow: DAILY },
    _count: { _all: true },
    _min: { windowStart: true, date: true },
    _max: { windowStart: true, date: true },
  });

  // Workspaces have to be counted per source separately — groupBy cannot do a
  // distinct count of another column, and inventing one from the row count would
  // be a fabricated number.
  const providers = [];
  for (const g of bySource) {
    const ws = await prisma.metricSnapshot.findMany({
      where: { measurementWindow: DAILY, source: g.source },
      select: { workspaceId: true },
      distinct: ['workspaceId'],
    });
    const entities = await prisma.metricSnapshot.findMany({
      where: { measurementWindow: DAILY, source: g.source },
      select: { entityId: true },
      distinct: ['entityId'],
    });
    providers.push({
      source: g.source,
      rows: g._count._all,
      workspaces: ws.length,
      entities: entities.length,
      earliestDay: g._min.windowStart, latestDay: g._max.windowStart,
      firstObserved: g._min.date, lastObserved: g._max.date,
    });
  }
  return { total, providers };
}

// ── F3 — are these actually one-day rows? ────────────────────────────────────
async function periodIntegrity() {
  const missingPeriod = await prisma.metricSnapshot.count({
    where: { measurementWindow: DAILY, OR: [{ windowStart: null }, { windowEnd: null }] },
  });

  // The daily contract is windowStart === windowEnd at UTC midnight (an
  // inclusive one-day period). Anything else is a range that reached the daily
  // population, which is the one defect that would poison every future
  // difference computed from it.
  const [{ count: notOneDay }] = await prisma.$queryRaw`
    SELECT count(*)::int AS count FROM "metric_snapshots"
    WHERE "measurementWindow" = 'DAILY'
      AND "windowStart" IS NOT NULL AND "windowEnd" IS NOT NULL
      AND "windowStart" <> "windowEnd"`;

  const [{ count: notMidnight }] = await prisma.$queryRaw`
    SELECT count(*)::int AS count FROM "metric_snapshots"
    WHERE "measurementWindow" = 'DAILY' AND "windowStart" IS NOT NULL
      AND "windowStart" <> date_trunc('day', "windowStart")`;

  // The sink upserts by hand on a key the schema cannot declare, so two racing
  // syncs can each land a row for the same day. Documented as a residual, not a
  // surprise — this counts how often it actually happened.
  const duplicates = await prisma.$queryRaw`
    SELECT count(*)::int AS groups, coalesce(sum(n - 1), 0)::int AS extra_rows FROM (
      SELECT count(*) AS n FROM "metric_snapshots"
      WHERE "measurementWindow" = 'DAILY' AND "windowStart" IS NOT NULL
      GROUP BY "workspaceId", "entityId", "entityLevel", "source", "windowStart"
      HAVING count(*) > 1
    ) d`;

  // A DAILY row for an entity nothing else measures would mean the sink minted
  // one, which it is built never to do.
  const [{ count: orphanEntities }] = await prisma.$queryRaw`
    SELECT count(DISTINCT s."entityId")::int AS count FROM "metric_snapshots" s
    WHERE s."measurementWindow" = 'DAILY'
      AND NOT EXISTS (SELECT 1 FROM "campaign_entities" c WHERE c."id" = s."entityId")`;

  return {
    missingPeriod,
    notOneDay,
    notMidnight,
    duplicateDays: duplicates[0]?.groups ?? 0,
    duplicateExtraRows: duplicates[0]?.extra_rows ?? 0,
    orphanEntities,
  };
}

// ── F4 — can the reader that was built for this population consume it? ───────
async function readerProof() {
  // The busiest real entity, so the proof runs over the most rows production
  // actually holds rather than a hand-picked one.
  const busiest = await prisma.$queryRaw`
    SELECT "workspaceId", "entityId", "entityLevel", "source", count(*)::int AS rows
    FROM "metric_snapshots"
    WHERE "measurementWindow" = 'DAILY'
    GROUP BY "workspaceId", "entityId", "entityLevel", "source"
    ORDER BY rows DESC LIMIT 1`;
  if (!busiest.length) return { ran: false, reason: 'NO_DAILY_ROWS' };

  const target = busiest[0];
  const rows = await prisma.metricSnapshot.findMany({
    where: {
      workspaceId: target.workspaceId, entityId: target.entityId,
      entityLevel: target.entityLevel, source: target.source,
      measurementWindow: DAILY,
    },
    select: DAILY_OBSERVATION_SELECT,
    orderBy: [{ windowStart: 'asc' }, { date: 'asc' }],
  });

  // A REAL boundary if one exists. classifyAndReduce needs an instant to split
  // around; taking it from a decision that actually executed on this entity is
  // the only version of this proof that means anything about production.
  const decision = await prisma.decision.findFirst({
    where: {
      workspaceId: target.workspaceId, entityId: target.entityId,
      OR: [{ humanExecutedAt: { not: null } }, { platformExecutedAt: { not: null } }],
    },
    select: { id: true, humanExecutedAt: true, platformExecutedAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const real = decision
    ? [decision.humanExecutedAt, decision.platformExecutedAt].filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime())[0]
    : null;

  // No executed decision on this entity → the split point is structural, and it
  // is LABELLED as such. It proves the rows are readable; it does not claim a
  // measurement was made about anything.
  const withPeriod = rows.filter((r) => r.windowStart);
  const boundary = real ?? new Date(
    withPeriod.length
      ? new Date(withPeriod[Math.floor(withPeriod.length / 2)].windowStart).getTime() + DAY_MS / 2
      : Date.now(),
  );

  const { before, after, excluded } = classifyAndReduce(rows, boundary);
  const latestBefore = before.length ? before[before.length - 1] : null;
  const earliestAfter = after.length ? after[0] : null;
  const verdict = areComparable(latestBefore, earliestAfter);

  const byReason = {};
  for (const e of excluded) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;

  return {
    ran: true,
    boundaryKind: real ? 'REAL_INTERVENTION' : 'SYNTHETIC_BOUNDARY',
    boundaryNote: real ? `decision ${decision.id}` : 'no executed decision on this entity — structural read proof only, not a measurement',
    boundary: boundary.toISOString(),
    entity: { entityLevel: target.entityLevel, source: target.source, rows: target.rows },
    rowsTested: rows.length,
    before: before.length,
    after: after.length,
    ambiguous: [...before, ...after].filter((o) => o.ambiguous).length,
    excluded: excluded.length,
    excludedByReason: byReason,
    crossBoundaryExcluded: byReason.CROSSES_BOUNDARY ?? 0,
    comparable: verdict.ok,
    comparabilityReason: verdict.ok ? null : verdict.reason,
  };
}

// ── §J — a zero population is classified, never shrugged at ──────────────────
async function classifyEmpty() {
  const credentials = await prisma.$queryRaw`
    SELECT platform, count(*)::int AS rows,
           count(*) FILTER (WHERE is_active)::int AS active,
           max(last_synced_at) AS last_sync
    FROM marcom_credentials GROUP BY platform`;

  // Only META implements fetchDailyRaw/normalizeDaily today, so an account set
  // with no active meta_ads credential cannot produce a daily row however well
  // everything else is working.
  const anyDaily = credentials.some((c) => c.platform === PLATFORM_DB.META && c.active > 0);
  const everSynced = credentials.some((c) => c.last_sync != null);
  const anySnapshots = await prisma.metricSnapshot.count();

  let reason;
  if (!credentials.length || !credentials.some((c) => c.active > 0)) reason = 'NO_CONNECTED_ACCOUNTS';
  else if (!everSynced) reason = 'SYNC_NOT_TRIGGERED';
  else if (!anyDaily) reason = 'CONNECTOR_UNIMPLEMENTED';
  else if (anySnapshots === 0) reason = 'SYNC_NOT_TRIGGERED';
  else reason = 'UNKNOWN'; // credentials + syncs + other populations exist, daily does not
  return { reason, credentials, totalSnapshotsAllWindows: anySnapshots };
}

async function main() {
  const report = { provenance: provenance() };
  report.population = await population();
  report.periodIntegrity = await periodIntegrity();
  report.reader = await readerProof();
  if (report.population.total === 0) report.emptyClassification = await classifyEmpty();

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const p = report.provenance;
  console.log('\nB4-D — DAILY population proof');
  console.log('='.repeat(64));
  console.log(`database   ${p.host || '(unparseable)'} / ${p.database || '?'}`);
  console.log(`NODE_ENV   ${p.nodeEnv}`);
  console.log(`flag       DAILY_INGESTION_ENABLED=${p.dailyIngestionEnabled}`);
  console.log(`measured   ${p.measuredAt}`);

  console.log('\nF1 — population');
  console.log(`  DAILY rows: ${report.population.total}`);

  console.log('\nF2 — provider distribution');
  if (!report.population.providers.length) console.log('  (no rows)');
  for (const s of report.population.providers) {
    console.log(`  ${s.source}: ${s.rows} rows · ${s.workspaces} workspaces · ${s.entities} entities`);
    console.log(`      days ${iso(s.earliestDay)} → ${iso(s.latestDay)}   observed ${iso(s.firstObserved)} → ${iso(s.lastObserved)}`);
  }

  console.log('\nF3 — period integrity');
  for (const [k, v] of Object.entries(report.periodIntegrity)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  console.log('\nF4 — reader compatibility');
  if (!report.reader.ran) console.log(`  not run — ${report.reader.reason}`);
  else {
    const r = report.reader;
    console.log(`  boundary   ${r.boundaryKind} (${r.boundaryNote})`);
    console.log(`  rows       ${r.rowsTested} · before ${r.before} · after ${r.after}`);
    console.log(`  excluded   ${r.excluded} ${JSON.stringify(r.excludedByReason)}`);
    console.log(`  ambiguous  ${r.ambiguous}`);
    console.log(`  comparable ${r.comparable}${r.comparabilityReason ? ` (${r.comparabilityReason})` : ''}`);
  }

  if (report.emptyClassification) {
    console.log('\n§J — why the population is empty');
    console.log(`  ${report.emptyClassification.reason}`);
    for (const c of report.emptyClassification.credentials) {
      console.log(`    ${c.platform}: ${c.rows} rows, ${c.active} active, last sync ${iso(c.last_sync)}`);
    }
    console.log(`    snapshots across ALL windows: ${report.emptyClassification.totalSnapshotsAllWindows}`);
  }
  console.log('');
}

const iso = (d) => (d ? new Date(d).toISOString() : 'null');

main()
  .catch((err) => { console.error('[daily-population-proof] failed:', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
