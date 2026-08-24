#!/usr/bin/env node
// ============================================================
// B4-E7 — production proof for DAILY observation persistence
// ============================================================
// B4-E5 proved, on a disposable PostgreSQL, that the partial identity lets
// several measurement days of one entity coexist. That proof stops at the edge
// of the machine it ran on. E7 asks a different question:
//
//     does the DEPLOYED system actually persist and read them?
//
// Only a database that serves users can answer it, and that database is not
// reachable from a developer laptop — production's DATABASE_URL is injected by
// Render from `lumi-postgres` and exists in no file in this repository. So this
// script is the instrument a human runs INSIDE that environment, once, to
// produce the whole E7 evidence set in a single pass:
//
//   §3  the deployed index topology, read from the catalog
//   §4  the production DAILY population
//   §5  duplicate logical observations, listed exactly
//   §8  multi-day coexistence, per entity, with row ids
//   §7  a normalized→persisted→reader trace that proves values were STORED
//   §10 the real reader over the real population
//   §11 the real verdict pipeline: a verdict, or an honest gate
//   §12 the deployed commit, from Render's own env
//
// ── IT IS READ-ONLY, STRUCTURALLY ─────────────────────────────────────────────
// Every call is count / groupBy / findMany / $queryRaw. There is no create,
// update, upsert, delete or $executeRaw anywhere in this file, and a contract
// test asserts that by reading the source. It cannot trigger a sync and it
// cannot repair a defect — E7 forbids both. What it finds, it reports.
//
// ── IT NEVER INVENTS A NUMBER ─────────────────────────────────────────────────
// Absence is reported as absence. An entity with one measurement day is not
// "nearly two"; a population with no rows is classified from real evidence, and
// a missing day is never rendered as a zero. Every failure gets one of E7's own
// codes rather than a shrug.
//
//   node scripts/e7-production-proof.js
//   node scripts/e7-production-proof.js --json
//   node scripts/e7-production-proof.js --save  /tmp/before.json   § before a sync
//   node scripts/e7-production-proof.js --compare /tmp/before.json § after it (§6/§9)
//
// The header prints the database HOST and NAME so the reader can see which
// database answered. The connection string is never printed.
// ============================================================
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { MEASUREMENT_WINDOW } from '../src/services/connectors/connectorTypes.js';
import { dailyKey } from '../src/services/connectors/dailySnapshotSink.js';
import { readDailyObservations } from '../src/services/daily-observations/dailyObservationReader.js';
import { evaluateConnectorVerdicts } from '../src/services/verdict-engine/index.js';

const DAILY = MEASUREMENT_WINDOW.DAILY;
const DAY_MS = 86_400_000;

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const SAVE_TO = flagValue('--save');
const COMPARE_TO = flagValue('--compare');

/** The six columns of the write identity, sorted — what an identity index carries. */
const IDENTITY_COLUMNS = ['date', 'entityId', 'entityLevel', 'granularity', 'measurementWindow', 'source'];

/** Failure codes, from E7 §13. A finding always gets one of these. */
export const E7 = Object.freeze({
  NO_DB_ACCESS: 'E7-1',
  SCHEMA_NOT_E5: 'E7-2',
  NO_CONNECTED_ACCOUNTS: 'E7-3',
  NO_ELIGIBLE_POPULATION: 'E7-4',
  DUPLICATE_POPULATION: 'E7-5',
  TRACE_BROKEN: 'E7-6',
  INSUFFICIENT_MULTI_DAY: 'E7-7',
  RETRY_DUPLICATION: 'E7-8',
  READER_REGRESSION: 'E7-9',
  VERDICT_FABRICATION: 'E7-10',
});

// ── provenance + §12 deployment identity ─────────────────────────────────────
/**
 * Which database answered, and which build asked. Host and name only — never
 * the credentials.
 *
 * RENDER_GIT_COMMIT is set by Render itself inside the running service, so when
 * this is executed where E7 requires it to be, §12 answers itself. Off Render it
 * is absent, and the honest value is the one E7 names: DEPLOY_COMMIT_UNOBSERVABLE.
 */
function provenance() {
  const raw = process.env.DATABASE_URL || '';
  let host = null;
  let database = null;
  try {
    const u = new URL(raw);
    host = u.host;
    database = u.pathname.replace(/^\//, '') || null;
  } catch { /* leave null — an unparseable URL is reported, not guessed */ }
  return {
    host,
    database,
    nodeEnv: process.env.NODE_ENV || null,
    dailyIngestionEnabled: process.env.DAILY_INGESTION_ENABLED ?? '(unset)',
    dailyIngestionDays: process.env.DAILY_INGESTION_DAYS ?? '(unset)',
    deployCommit: process.env.RENDER_GIT_COMMIT || 'DEPLOY_COMMIT_UNOBSERVABLE',
    renderService: process.env.RENDER_SERVICE_NAME || null,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Is this actually production?
 *
 * This gate exists because the first run of this script printed
 * "COMPLETE — PRODUCTION PROVEN" against a local test database. Every other
 * control in this program guards against a number with no provenance; a verdict
 * line that claims production from a laptop is that same defect wearing the
 * strongest possible wording, and it would be quoted long after the terminal
 * that produced it was closed.
 *
 * Production is asserted only when the database is NOT local AND the process can
 * show it is the deployed service (Render injects both variables) or is at least
 * running as production. Anything else is reported honestly and the verdict says
 * so, whatever the evidence underneath it looks like.
 */
export function environmentClass(p) {
  if (!p.host || /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(p.host)) {
    return { production: false, why: 'the database host is local' };
  }
  const onRender = Boolean(process.env.RENDER_GIT_COMMIT || process.env.RENDER_SERVICE_NAME);
  if (!onRender && p.nodeEnv !== 'production') {
    return { production: false, why: 'no Render service identity and NODE_ENV is not production' };
  }
  return { production: true, why: null };
}

/** UTC, always. A measurement day rendered in the reader's local zone is a different day. */
const utcDay = (d) => (d == null ? '—' : new Date(d).toISOString().slice(0, 10));
const utcStamp = (d) => (d == null ? 'never' : new Date(d).toISOString().replace('T', ' ').slice(0, 19));

// ── §3 — the deployed identity topology ──────────────────────────────────────
/**
 * Read from pg_index, not from the migration file and not from the index NAME.
 * E7 §3 is explicit that a name is not evidence: an index called
 * `..._non_daily_identity_key` that carries no predicate is the retired
 * full-table identity wearing the new label, and it would collide exactly as
 * before.
 */
async function topology() {
  const rows = await prisma.$queryRaw`
    SELECT i.relname::text AS name,
           pg_get_indexdef(ix.indexrelid)::text AS def,
           (ix.indpred IS NOT NULL) AS partial,
           n.nspname::text AS schema,
           (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM pg_attribute a
             WHERE a.attrelid = ix.indrelid AND a.attnum = ANY (ix.indkey)) AS cols
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'metric_snapshots'
      AND ix.indisunique AND NOT ix.indisprimary
    ORDER BY i.relname`;

  const identity = rows.filter(
    (r) => [...(r.cols || [])].sort().join(',') === IDENTITY_COLUMNS.join(','),
  );
  const full = identity.filter((r) => !r.partial);
  const partial = identity.filter((r) => r.partial);
  // The predicate has to EXCLUDE DAILY, not merely exist. A partial index on
  // some other condition still arbitrates the daily population.
  const excludesDaily = partial.filter((r) => /measurementWindow" <> 'DAILY'/.test(r.def));

  const ok = full.length === 0 && excludesDaily.length === 1;
  return {
    ok,
    code: ok ? null : E7.SCHEMA_NOT_E5,
    allUnique: rows.map((r) => ({ name: r.name, partial: r.partial, cols: r.cols })),
    identityIndexes: identity.map((r) => ({ name: r.name, partial: r.partial, schema: r.schema, def: r.def })),
    fullTableIdentities: full.map((r) => r.name),
    partialExcludingDaily: excludesDaily.map((r) => r.name),
  };
}

// ── §4 — the production population ───────────────────────────────────────────
/**
 * `marcom_credentials` is created at server BOOT by ensureCredentialSchema(),
 * not by any migration, so it can legitimately be absent on a database the app
 * has never served from. Guarded with to_regclass: an absent table is reported
 * as an unknown, never crashed on and never read as "zero accounts".
 */
async function connectedAccounts() {
  const [{ present }] = await prisma.$queryRaw`
    SELECT (to_regclass('marcom_credentials') IS NOT NULL) AS present`;
  if (!present) return { tablePresent: false, platforms: [] };

  const platforms = await prisma.$queryRaw`
    SELECT platform::text AS platform,
           count(*)::int AS rows,
           count(*) FILTER (WHERE is_active)::int AS active,
           max(last_synced_at) AS last_sync
    FROM marcom_credentials GROUP BY platform ORDER BY platform`;
  return { tablePresent: true, platforms };
}

async function population() {
  const total = await prisma.metricSnapshot.count({ where: { measurementWindow: DAILY } });
  const bySource = await prisma.metricSnapshot.groupBy({
    by: ['source'],
    where: { measurementWindow: DAILY },
    _count: { _all: true },
    _min: { windowStart: true, date: true },
    _max: { windowStart: true, date: true },
  });

  const providers = [];
  for (const g of bySource) {
    // groupBy cannot do a distinct count of another column, and deriving one
    // from the row count would be a fabricated number.
    const entities = await prisma.metricSnapshot.findMany({
      where: { measurementWindow: DAILY, source: g.source },
      select: { entityId: true }, distinct: ['entityId'],
    });
    const workspaces = await prisma.metricSnapshot.findMany({
      where: { measurementWindow: DAILY, source: g.source },
      select: { workspaceId: true }, distinct: ['workspaceId'],
    });
    providers.push({
      source: g.source,
      rows: g._count._all,
      entities: entities.length,
      workspaces: workspaces.length,
      earliestDay: g._min.windowStart,
      latestDay: g._max.windowStart,
      firstObserved: g._min.date,
      lastObserved: g._max.date,
    });
  }
  return { total, providers };
}

// ── §5.1 — duplicate LOGICAL observations ────────────────────────────────────
/**
 * The DAILY logical identity is taken from the sink, not invented here:
 * dailySnapshotSink resolves existing rows with `dailyKey`
 *     (entityId, entityLevel, source, windowStart)
 * after narrowing its read to one workspace — so the logical key is that tuple
 * PLUS workspaceId. Two rows sharing it are two persisted observations of one
 * measurement day, which the sink's read-then-write is supposed to prevent.
 */
async function duplicates() {
  const groups = await prisma.$queryRaw`
    SELECT "workspaceId"::text AS "workspaceId", "entityId"::text AS "entityId",
           "entityLevel"::text AS "entityLevel", source::text AS source,
           to_char("windowStart", 'YYYY-MM-DD') AS day,
           count(*)::int AS rows,
           array_agg(id::text ORDER BY date) AS ids,
           array_agg(to_char(date, 'YYYY-MM-DD HH24:MI:SS') ORDER BY date) AS observed
    FROM metric_snapshots
    WHERE "measurementWindow" = 'DAILY' AND "windowStart" IS NOT NULL
    GROUP BY 1,2,3,4,5
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 50`;
  return {
    ok: groups.length === 0,
    code: groups.length ? E7.DUPLICATE_POPULATION : null,
    groups,
  };
}

// ── §5.2 / §8 — multi-day coexistence, listed ────────────────────────────────
/**
 * The core acceptance criterion, and E7 is explicit that `rows > entities` is
 * not sufficient on its own — the rows have to be listed. This returns the
 * actual per-entity rows: measurement day, window bounds, observation instant
 * and row id.
 */
async function coexistence(limit = 5) {
  const entities = await prisma.$queryRaw`
    SELECT "workspaceId"::text AS "workspaceId", "entityId"::text AS "entityId",
           "entityLevel"::text AS "entityLevel", source::text AS source,
           count(*)::int AS rows,
           count(DISTINCT "windowStart")::int AS days
    FROM metric_snapshots
    WHERE "measurementWindow" = 'DAILY' AND "windowStart" IS NOT NULL
    GROUP BY 1,2,3,4
    ORDER BY count(DISTINCT "windowStart") DESC, count(*) DESC
    LIMIT ${limit}`;

  const detailed = [];
  for (const e of entities) {
    const rows = await prisma.$queryRaw`
      SELECT id::text AS id,
             to_char("windowStart", 'YYYY-MM-DD') AS day,
             to_char("windowStart", 'YYYY-MM-DD HH24:MI:SS') AS "windowStart",
             to_char("windowEnd",   'YYYY-MM-DD HH24:MI:SS') AS "windowEnd",
             to_char(date,          'YYYY-MM-DD HH24:MI:SS') AS observed,
             "spendMinor", impressions, clicks, conversions, currency
      FROM metric_snapshots
      WHERE "measurementWindow" = 'DAILY'
        AND "workspaceId" = ${e.workspaceId}::uuid
        AND "entityId"    = ${e.entityId}::uuid
        AND "entityLevel" = ${e.entityLevel}::"EntityLevel"
        AND source        = ${e.source}::"DataSource"
      ORDER BY "windowStart"`;
    detailed.push({ ...e, observations: rows });
  }

  const best = detailed[0] || null;
  const proven = Boolean(best && best.days >= 2);
  return {
    proven,
    code: proven ? null : E7.INSUFFICIENT_MULTI_DAY,
    maxDistinctDays: best ? best.days : 0,
    entities: detailed,
  };
}

// ── §7 — normalized → persisted → reader trace ───────────────────────────────
/**
 * E7 §7 asks for proof that values were PERSISTED rather than reconstructed by
 * the reader. The normalizer's own output is not available after the fact — it
 * is not retained anywhere — so the strongest available evidence is the one this
 * builds: read the row straight from the table with raw SQL, run the reader over
 * the same entity, and compare the reader's observation to the stored row FIELD
 * BY FIELD, matched on the row id the reader carries.
 *
 * A divergence means the reader is showing something the database does not
 * hold, which is E7-6.
 */
const TRACED_FIELDS = [
  ['id', 'id'], ['entityId', 'entityId'], ['entityLevel', 'entityLevel'],
  ['source', 'source'], ['measurementWindow', 'measurementWindow'],
  ['spendMinor', 'spendMinor'], ['revenueMinor', 'revenueMinor'],
  ['impressions', 'impressions'], ['clicks', 'clicks'], ['conversions', 'conversions'],
  ['currency', 'currency'],
];

async function trace(entity) {
  if (!entity) return { ran: false, reason: 'no DAILY entity to trace' };

  const stored = await prisma.$queryRaw`
    SELECT id::text AS id, "entityId"::text AS "entityId", "entityLevel"::text AS "entityLevel",
           source::text AS source, "measurementWindow"::text AS "measurementWindow",
           to_char("windowStart", 'YYYY-MM-DD HH24:MI:SS') AS "windowStart",
           to_char("windowEnd",   'YYYY-MM-DD HH24:MI:SS') AS "windowEnd",
           to_char(date,          'YYYY-MM-DD HH24:MI:SS') AS date,
           "spendMinor", "revenueMinor", impressions, clicks, conversions, currency
    FROM metric_snapshots
    WHERE "measurementWindow" = 'DAILY'
      AND "workspaceId" = ${entity.workspaceId}::uuid
      AND "entityId"    = ${entity.entityId}::uuid
      AND "entityLevel" = ${entity.entityLevel}::"EntityLevel"
      AND source        = ${entity.source}::"DataSource"
    ORDER BY "windowStart"`;

  const days = stored.map((r) => r.windowStart).filter(Boolean);
  if (!days.length) return { ran: false, reason: 'traced entity has no dated DAILY rows' };

  // A boundary past every stored day, so the reader classifies them all as
  // "before" and none is dropped for straddling it. The span is widened to cover
  // the real distance between the first and last day.
  const first = new Date(`${days[0].replace(' ', 'T')}Z`).getTime();
  const last = new Date(`${days[days.length - 1].replace(' ', 'T')}Z`).getTime();
  const spanDays = Math.max(1, Math.round((last - first) / DAY_MS) + 2);
  const boundary = new Date(last + DAY_MS);

  const read = await readDailyObservations(entity.workspaceId, {
    entityId: entity.entityId,
    entityLevel: entity.entityLevel,
    source: entity.source,
    interventionAt: boundary,
    beforeDays: spanDays,
    afterDays: 1,
  });

  const byId = new Map(stored.map((r) => [r.id, r]));
  const comparisons = [];
  for (const obs of read.before) {
    const row = byId.get(obs.id);
    if (!row) {
      comparisons.push({ id: obs.id, ok: false, problem: 'reader returned an observation with no stored row' });
      continue;
    }
    const mismatches = [];
    for (const [readerField, dbField] of TRACED_FIELDS) {
      const a = obs[readerField];
      const b = row[dbField];
      if (String(a) !== String(b)) mismatches.push({ field: readerField, reader: a, database: b });
    }
    // The measured day must come from windowStart, never from the sync instant.
    if (obs.day !== String(row.windowStart).slice(0, 10)) {
      mismatches.push({ field: 'day', reader: obs.day, database: String(row.windowStart).slice(0, 10) });
    }
    comparisons.push({ id: obs.id, day: obs.day, ok: mismatches.length === 0, mismatches });
  }

  const ok = comparisons.length > 0 && comparisons.every((c) => c.ok);
  return {
    ran: true,
    ok,
    code: ok ? null : E7.TRACE_BROKEN,
    storedRows: stored.length,
    readerObservations: read.before.length,
    excluded: read.excluded,
    notObserved: read.notObserved,
    status: read.status,
    comparisons,
  };
}

// ── §10 — reader proof ───────────────────────────────────────────────────────
/**
 * Reported, never asserted into existence. If production holds no
 * boundary-crossing row and no restated day, those cases are NOT OBSERVED —
 * E7 §10 forbids reading their absence as a pass.
 */
function readerProof(traced) {
  if (!traced?.ran) return { ran: false };
  // A day the sink has restated is INDISTINGUISHABLE from a freshly landed one
  // by inspection: dailySnapshotSink updates the row in place and advances
  // `date`, so it leaves one row either way. The only case a single read can see
  // is the sink's documented race — two rows for one logical day — and that is
  // reported by §5.1, not here. Genuine restatement is observable only across a
  // sync, which is what --save / --compare exists for. Saying "NOT OBSERVED"
  // from a single pass would be reading absence as evidence.
  const multiRowDays = traced.storedRows - traced.readerObservations;
  return {
    ran: true,
    distinctDaysObservable: traced.readerObservations,
    notObservedDays: traced.notObserved,
    excludedRows: traced.excluded,
    boundaryCrossingObserved: traced.excluded.some((e) => e.reason === 'CROSSES_BOUNDARY') ? 'OBSERVED' : 'NOT OBSERVED',
    rowsReducedAway: multiRowDays,
    restatementObserved: 'NOT OBSERVABLE IN A SINGLE PASS — run --save before a sync and --compare after',
  };
}

// ── §11 — verdict, or an honest gate ─────────────────────────────────────────
/**
 * The real pipeline, unmodified. `evaluateConnectorVerdicts` is the READ twin —
 * it computes and returns; `persistLevelVerdicts` is the one that writes, and it
 * is deliberately not called here.
 *
 * A gate is a successful outcome. The only failure this can report is a verdict
 * standing on evidence that is not there.
 */
async function verdictProof(workspaceIds) {
  const results = [];
  for (const workspaceId of workspaceIds) {
    let ev;
    try {
      ev = await evaluateConnectorVerdicts(workspaceId);
    } catch (err) {
      results.push({ workspaceId, error: err.message });
      continue;
    }
    const gates = {};
    for (const g of ev.gatedOut || []) {
      const reason = g?.reason || g?.rootCause || 'UNSTATED';
      gates[reason] = (gates[reason] ?? 0) + 1;
    }
    const verdicts = {};
    const walk = (node) => {
      if (!node) return;
      if (node.verdict) verdicts[node.verdict] = (verdicts[node.verdict] ?? 0) + 1;
      for (const child of node.children || []) walk(child);
    };
    walk(ev.annotated || ev.tree);
    results.push({
      workspaceId,
      status: ev.status,
      campaigns: (ev.campaigns || []).length,
      verdicts,
      gatedOut: ev.gatedOut?.length ?? 0,
      gateReasons: gates,
      outcome: Object.keys(verdicts).length ? 'VERDICT' : 'HONEST GATE',
    });
  }
  return results;
}

// ── §6 / §9 — snapshot + compare, across a real sync ─────────────────────────
/**
 * E7 cannot trigger a sync from here and must not fabricate one. What it can do
 * is fingerprint the population before and after a sync a human triggers through
 * the normal application path, and say exactly what changed.
 *
 * The fingerprint is keyed on the SINK'S OWN logical identity, so "created" and
 * "restated" mean what the sink means by them.
 */
async function fingerprint() {
  const rows = await prisma.metricSnapshot.findMany({
    where: { measurementWindow: DAILY },
    select: {
      id: true, workspaceId: true, entityId: true, entityLevel: true, source: true,
      windowStart: true, date: true, spendMinor: true, impressions: true, clicks: true, conversions: true,
    },
    orderBy: [{ entityId: 'asc' }, { windowStart: 'asc' }],
  });
  const byKey = {};
  for (const r of rows) {
    if (r.windowStart == null) continue;
    const key = `${r.workspaceId}|${dailyKey(r)}`;
    (byKey[key] ??= []).push({
      id: r.id,
      observedAt: r.date?.toISOString() ?? null,
      spendMinor: r.spendMinor, impressions: r.impressions, clicks: r.clicks, conversions: r.conversions,
    });
  }
  return { takenAt: new Date().toISOString(), totalRows: rows.length, keys: Object.keys(byKey).length, byKey };
}

export function compare(before, after) {
  const created = [];
  const restated = [];
  const duplicated = [];
  const unchanged = [];

  for (const [key, rows] of Object.entries(after.byKey)) {
    const prior = before.byKey[key];
    if (rows.length > 1) duplicated.push({ key, rows });
    if (!prior) { created.push({ key, rows }); continue; }
    const a = prior[0];
    const b = rows[0];
    const changed = ['observedAt', 'spendMinor', 'impressions', 'clicks', 'conversions']
      .filter((f) => String(a[f]) !== String(b[f]));
    if (changed.length) {
      restated.push({ key, idBefore: a.id, idAfter: b.id, idStable: a.id === b.id, changed: changed.map((f) => ({ field: f, before: a[f], after: b[f] })) });
    } else unchanged.push(key);
  }
  const vanished = Object.keys(before.byKey).filter((k) => !after.byKey[k]);

  return {
    ok: duplicated.length === 0,
    code: duplicated.length ? E7.RETRY_DUPLICATION : null,
    rowsBefore: before.totalRows, rowsAfter: after.totalRows,
    keysBefore: before.keys, keysAfter: after.keys,
    created, restated, duplicated, vanished, unchangedCount: unchanged.length,
  };
}

// ── report ───────────────────────────────────────────────────────────────────
function line(label, value) { console.log(`  ${String(label).padEnd(26)} ${value}`); }

async function main() {
  const report = { provenance: provenance(), sections: {} };
  const findings = [];

  const topo = await topology();
  report.sections.topology = topo;
  if (!topo.ok) findings.push({ code: topo.code, detail: 'deployed schema is not on the B4-E5 partial identity' });

  const accounts = await connectedAccounts();
  const pop = await population();
  report.sections.connectedAccounts = accounts;
  report.sections.population = pop;

  const anyActive = accounts.platforms.some((p) => p.active > 0);
  if (accounts.tablePresent && !anyActive) {
    findings.push({ code: E7.NO_CONNECTED_ACCOUNTS, detail: 'no active credential in marcom_credentials' });
  }
  if (anyActive && pop.total === 0) {
    findings.push({ code: E7.NO_ELIGIBLE_POPULATION, detail: 'accounts are connected but no DAILY row exists' });
  }

  const dup = await duplicates();
  report.sections.duplicates = dup;
  if (!dup.ok) findings.push({ code: dup.code, detail: `${dup.groups.length} logical observation(s) persisted more than once` });

  const coex = pop.total > 0 ? await coexistence() : { proven: false, code: E7.INSUFFICIENT_MULTI_DAY, maxDistinctDays: 0, entities: [] };
  report.sections.coexistence = coex;
  if (!coex.proven && pop.total > 0) {
    findings.push({ code: coex.code, detail: `richest entity holds ${coex.maxDistinctDays} measurement day(s)` });
  }

  const traced = await trace(coex.entities[0]);
  report.sections.trace = traced;
  if (traced.ran && !traced.ok) findings.push({ code: traced.code, detail: 'reader output diverges from the stored row' });

  report.sections.reader = readerProof(traced);

  const workspaceIds = [...new Set(coex.entities.map((e) => e.workspaceId))];
  report.sections.verdict = workspaceIds.length ? await verdictProof(workspaceIds) : [];

  if (COMPARE_TO) {
    const before = JSON.parse(readFileSync(COMPARE_TO, 'utf8'));
    const cmp = compare(before, await fingerprint());
    report.sections.retry = cmp;
    if (!cmp.ok) findings.push({ code: cmp.code, detail: `${cmp.duplicated.length} logical key(s) hold more than one row after the sync` });
  }
  if (SAVE_TO) {
    writeFileSync(SAVE_TO, JSON.stringify(await fingerprint(), null, 2), 'utf8');
  }

  const env = environmentClass(report.provenance);
  report.environment = env;
  report.findings = findings;
  if (findings.length) {
    report.verdict = `STOP — ${findings.map((f) => f.code).join(', ')}`;
  } else if (!env.production) {
    // The evidence may be perfect. It still is not production evidence, and this
    // line is what someone will quote.
    report.verdict = `NOT PRODUCTION — ${env.why}. Evidence below is real but describes `
      + `${report.provenance.host}/${report.provenance.database}, not the deployed database.`;
  } else if (coex.proven) {
    report.verdict = 'COMPLETE — PRODUCTION PROVEN';
  } else {
    report.verdict = `UNPROVEN — ${E7.INSUFFICIENT_MULTI_DAY}: insufficient multi-day production evidence`;
  }

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return report; }

  console.log('\nB4-E7 — production DAILY persistence proof');
  console.log('='.repeat(64));
  line('database', `${report.provenance.host || '(unknown)'} / ${report.provenance.database || '(unknown)'}`);
  line('NODE_ENV', report.provenance.nodeEnv);
  line('deployed commit', report.provenance.deployCommit);
  line('DAILY_INGESTION_ENABLED', report.provenance.dailyIngestionEnabled);
  line('measured', report.provenance.measuredAt);

  console.log('\n§3 — deployed identity topology');
  for (const i of topo.identityIndexes) console.log(`  ${i.partial ? 'PARTIAL' : 'FULL   '} ${i.name}\n    ${i.def}`);
  if (!topo.identityIndexes.length) console.log('  (no unique index on the six identity columns)');
  line('retired full identity', topo.fullTableIdentities.length ? `PRESENT — ${topo.fullTableIdentities.join(', ')}` : 'absent ✓');
  line('E5 topology live', topo.ok ? 'YES ✓' : `NO — ${E7.SCHEMA_NOT_E5}`);

  console.log('\n§4 — population');
  line('credential table', accounts.tablePresent ? 'present' : 'ABSENT (app has never booted here)');
  for (const p of accounts.platforms) line(`  ${p.platform}`, `${p.active}/${p.rows} active · last sync ${utcStamp(p.last_sync)}`);
  line('DAILY rows', pop.total);
  for (const p of pop.providers) {
    line(`  ${p.source}`, `${p.rows} rows · ${p.entities} entities · ${p.workspaces} workspaces`);
    line('    days (UTC)', `${utcDay(p.earliestDay)} → ${utcDay(p.latestDay)}`);
  }

  console.log('\n§5.1 — duplicate logical observations');
  if (dup.ok) line('duplicates', 'none ✓');
  else for (const g of dup.groups) console.log(`  ${g.entityId} ${g.day} → ${g.rows} rows [${g.ids.join(', ')}]`);

  console.log('\n§8 — multi-day coexistence');
  if (!coex.entities.length) line('entities', 'none');
  for (const e of coex.entities) {
    console.log(`  entity ${e.entityId} (${e.entityLevel}, ${e.source})`);
    line('    rows / distinct days', `${e.rows} / ${e.days}`);
    for (const o of e.observations) console.log(`      ${o.day}  spend ${o.spendMinor}  observed ${o.observed}  id ${o.id}`);
  }
  line('coexistence proven', coex.proven ? `YES ✓ (${coex.maxDistinctDays} days)` : `NO — ${E7.INSUFFICIENT_MULTI_DAY}`);

  console.log('\n§7 — persisted → reader trace');
  if (!traced.ran) line('trace', `not run — ${traced.reason}`);
  else {
    line('stored rows', traced.storedRows);
    line('reader observations', traced.readerObservations);
    line('field-identical', traced.ok ? 'YES ✓ — every traced field' : `NO — ${E7.TRACE_BROKEN}`);
    for (const c of traced.comparisons.filter((x) => !x.ok)) console.log(`    ${c.id} ${JSON.stringify(c.mismatches ?? c.problem)}`);
  }

  console.log('\n§10 — reader');
  if (!report.sections.reader.ran) line('reader', 'not run');
  else {
    line('distinct days visible', report.sections.reader.distinctDaysObservable);
    line('unobserved days', JSON.stringify(report.sections.reader.notObservedDays));
    line('boundary-crossing', report.sections.reader.boundaryCrossingObserved);
    line('restatement', report.sections.reader.restatementObserved);
  }

  console.log('\n§11 — verdict or honest gate');
  if (!report.sections.verdict.length) line('verdict', 'not run — no DAILY entity');
  for (const v of report.sections.verdict) {
    line(v.workspaceId, `${v.outcome} · status ${v.status} · ${v.campaigns} campaigns`);
    if (Object.keys(v.verdicts).length) line('    verdicts', JSON.stringify(v.verdicts));
    if (Object.keys(v.gateReasons).length) line('    gates', JSON.stringify(v.gateReasons));
  }

  if (report.sections.retry) {
    const r = report.sections.retry;
    console.log('\n§9 — retry / restatement (against the saved fingerprint)');
    line('rows', `${r.rowsBefore} → ${r.rowsAfter}`);
    line('logical keys', `${r.keysBefore} → ${r.keysAfter}`);
    line('created', r.created.length);
    line('restated', r.restated.length);
    line('id stable on restate', r.restated.length ? r.restated.every((x) => x.idStable) : 'n/a');
    line('duplicated keys', r.duplicated.length ? `${r.duplicated.length} — ${E7.RETRY_DUPLICATION}` : 'none ✓');
  }
  if (SAVE_TO) console.log(`\nfingerprint saved → ${SAVE_TO}`);

  console.log('\n' + '='.repeat(64));
  console.log(`  ${report.verdict}`);
  for (const f of findings) console.log(`    ${f.code} · ${f.detail}`);
  console.log('');
  return report;
}

// Run ONLY when executed directly. The pure parts above — environmentClass and
// compare — are the ones that decide whether a run may call itself production
// and whether a re-sync duplicated an observation, so they are unit-tested
// rather than grepped for; importing this file must therefore not open a
// database connection or measure anything.
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .catch((err) => { console.error('[e7-production-proof] failed:', err.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
