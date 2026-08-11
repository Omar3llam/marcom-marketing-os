// ============================================================
// snapshotSink — the first real ingestion sink (was seed-only)
// ============================================================
// Lands NormalizedSnapshot[] into the EXISTING graph: upserts Account→Campaign→
// AdSet→Ad (deterministic ids so a re-sync is idempotent) then upserts the
// MetricSnapshot rows by their natural unique key. No engine touches this; every
// downstream engine already reads MetricSnapshot. Before this, that substrate
// existed only in seed.js.
//
// Determinism makes it cheap + safe: entity ids are derived from
// (workspaceId, channel, level, externalId), so `toSnapshotRows` computes each
// snapshot's entityId WITHOUT a DB lookup — no N+1. Entity + snapshot upserts
// each run as one $transaction(map).
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { detId, ENTITY_LEVEL, PARENT_LEVEL } from './connectorTypes.js';

const LEVEL_ORDER = [ENTITY_LEVEL.ACCOUNT, ENTITY_LEVEL.CAMPAIGN, ENTITY_LEVEL.ADSET, ENTITY_LEVEL.AD, ENTITY_LEVEL.CREATIVE];

// level → { prisma model accessor, the parent FK field } (null FK at ACCOUNT).
const LEVEL_MODEL = Object.freeze({
  ACCOUNT:  { model: 'account',  fk: null },
  CAMPAIGN: { model: 'campaign', fk: 'accountId' },
  ADSET:    { model: 'adSet',    fk: 'campaignId' },
  AD:       { model: 'ad',       fk: 'adSetId' },
  CREATIVE: { model: 'creative', fk: 'adId' },
});

// The entity levels whose model actually HAS a platformCreatedTime column.
// Campaign got it for days-running; Ad for creative age. Account, AdSet and
// Creative do not have it — Prisma throws on an unknown arg, so this cannot be
// widened without the matching migration.
const LEVELS_WITH_PLATFORM_CREATED_TIME = new Set([ENTITY_LEVEL.CAMPAIGN, ENTITY_LEVEL.AD]);

const round = (n) => Math.round(n);

/**
 * PURE: NormalizedSnapshot[] → MetricSnapshot create-data rows. entityId is the
 * deterministic id of the entity (no DB lookup). The definitional ratios
 * (cpaMinor/ctr/roas) are derived HERE — one place — so connectors stay dumb.
 * Mirrors prisma/seed.js#snapshot().
 *
 * Roster-only rows (no delivery data found) are EXCLUDED here: they land as
 * entities (toEntityOps keeps them, so the campaign still appears in the list)
 * but never as a MetricSnapshot, so the UI shows "—" (unknown), never a
 * fabricated 0 — and an empty fetch can't overwrite real metrics with zeros.
 *
 * WINDOW PROVENANCE (Phase C): every row MUST arrive carrying the period its
 * producer measured. This function THROWS rather than defaulting — see the
 * guard below for why a default is the one thing it must not do.
 */
export function toSnapshotRows(workspaceId, channel, normalized = []) {
  return normalized.filter((n) => !n.rosterOnly).map((n) => {
    // The normalizer knows what it fetched; nothing downstream can recover it.
    // A default here would be indistinguishable from a real declaration and
    // would quietly re-create the defect this column exists to close: a row
    // asserting a window nobody established. `granularity: 'DAILY'` below is
    // exactly what that looks like after two years — hardcoded, believed, wrong.
    if (!n.measurementWindow) {
      throw new Error(
        `toSnapshotRows: measurementWindow is required (${channel} ${n.entityLevel} ${n.externalId}) — `
        + 'the normalizer must declare what period this row measures; it cannot be inferred here',
      );
    }
    const entityId = detId(workspaceId, channel, n.entityLevel, n.externalId);
    const spendMinor = round(n.spendMinor || 0);
    const revenueMinor = round(n.revenueMinor || 0);
    const conversions = n.conversions ?? 0;
    const impressions = n.impressions ?? 0;
    const clicks = n.clicks ?? 0;
    return {
      workspaceId,
      entityId,
      entityLevel: n.entityLevel,
      date: n.date instanceof Date ? n.date : new Date(n.date),
      source: n.source,
      // NOT a statement about what this row measures — see the Granularity enum
      // comment in schema.prisma. Left hardcoded on purpose: changing it would
      // rewrite the meaning of every historical row. measurementWindow is the
      // field that actually answers the question.
      granularity: 'DAILY',
      measurementWindow: n.measurementWindow,
      // The producer's own statement of the period, when it made one. null =
      // unreported; never reconstructed from `date`, which is the sync time.
      windowStart: n.windowStart ?? null,
      windowEnd: n.windowEnd ?? null,
      spendMinor,
      revenueMinor,
      cpaMinor: conversions > 0 ? round(spendMinor / conversions) : null,
      impressions,
      clicks,
      conversions: round(conversions),
      ctr: impressions > 0 ? clicks / impressions : null,
      // ROAS only when there's a positive revenue signal. Meta now requests
      // action_values (see CAMPAIGN_INSIGHT_FIELDS), so revenue flows through for
      // accounts with purchase tracking. But revenue 0 against real spend stays
      // ambiguous — "measured no purchases" vs "no purchase pixel configured" —
      // and the platform can't tell those apart. So we still land null (renders
      // "—"), never a fabricated 0.00x; a real positive value flows through here
      // unchanged.
      roas: spendMinor > 0 && revenueMinor > 0 ? revenueMinor / spendMinor : null,
      frequency: n.frequency ?? null,
      reach: n.reach ?? null, // null-when-absent (Google / unreported), never a fabricated 0
      // The funnel bag (lpv/atc/checkout/lead/…). null-when-absent, NEVER {}:
      // a reader must be able to tell "this channel reports no funnel" from
      // "every stage measured zero". Google/GA4 normalizers don't set it, so
      // their rows stay null and the funnel rules honestly decline to fire.
      actionMetrics: n.actionMetrics ?? null,
      dailyBudgetMinor: n.dailyBudgetMinor ?? null,
      currency: n.currency || 'USD',
    };
  });
}

/** PURE: the entity-graph upsert descriptors (one per distinct entity). */
export function toEntityOps(workspaceId, channel, normalized = []) {
  const seen = new Set();
  const ops = [];
  for (const n of normalized) {
    const key = `${n.entityLevel}:${n.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = detId(workspaceId, channel, n.entityLevel, n.externalId);
    const spec = LEVEL_MODEL[n.entityLevel];
    const data = { workspaceId, channel, name: n.name || n.externalId, externalId: String(n.externalId) };
    // Delivery status is stamped ONLY when the connector actually resolved one.
    // It used to be hardcoded 'ACTIVE' here and re-written on every update, so a
    // paused campaign asserted it was running and the diagnosis engine had no
    // way to know otherwise. Absent → the create falls to the schema default and
    // the update leaves the stored value alone (same rule as `objective`).
    if (n.status != null) data.status = n.status;
    // objective is a CAMPAIGN-only attribute (the column lives on Campaign, not
    // the other entity models) — only stamp it there, or the Account/AdSet upsert
    // would throw on an unknown arg.
    // objective is a CAMPAIGN-only attribute (the column lives on Campaign, not
    // the other entity models) — only stamp it there, or the Account/AdSet upsert
    // would throw on an unknown arg.
    if (n.entityLevel === ENTITY_LEVEL.CAMPAIGN) data.objective = n.objective ?? null;
    // platformCreatedTime exists on Campaign AND Ad — and ONLY those two. At
    // campaign level it is age; at ad level it is CREATIVE age. Account/AdSet/
    // Creative have no such column, so stamping it there would throw on an
    // unknown arg. This is a SET, not a level check, because the next level to
    // gain the column must be added here or its migration lands a dead column
    // that nothing ever writes.
    if (LEVELS_WITH_PLATFORM_CREATED_TIME.has(n.entityLevel)) {
      data.platformCreatedTime = n.platformCreatedTime ?? null;
    }
    // Remembered so the orphan sweep below can check the parent is actually in
    // this batch. detId is a pure hash — it happily produces an id for a parent
    // that was never fetched.
    let parentId = null;
    if (spec.fk) {
      const parentLevel = PARENT_LEVEL[n.entityLevel];
      parentId = detId(workspaceId, channel, parentLevel, n.parentExternalId);
      data[spec.fk] = parentId;
    }
    ops.push({ level: n.entityLevel, model: spec.model, id, data, parentId });
  }
  // Parents first so FKs resolve.
  ops.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
  return ops;
}

/**
 * PURE: drop any op whose parent exists neither in this batch NOR in the DB.
 *
 * `detId` is a hash, not a lookup — it returns an id for a parent that was never
 * fetched, so an orphan produces a syntactically valid FK pointing at a row that
 * does not exist. landSnapshots upserts every op in ONE `$transaction`, so a
 * single such row raises a foreign-key violation that rolls back the WHOLE
 * batch: one unparented ad would cost the sync its campaigns too.
 *
 * That is exactly the failure the connector's softFail design exists to prevent,
 * reintroduced through the database. It became reachable the moment ad ingestion
 * landed (ads are fetched on their own edge, which can fail or truncate
 * independently of the ad-sets they belong to), but it was ALWAYS possible one
 * level up: an ad-set whose campaign never delivered and whose roster fetch
 * softFailed has the same shape.
 *
 * `knownParentIds` is what makes this correct rather than merely safe: FK
 * validity is a property of the DATABASE, not of the batch. A parent landed by
 * an earlier sync satisfies the constraint perfectly well, so a batch-only check
 * would drop rows that would have succeeded — trading a rare crash for routine
 * silent data loss. landSnapshots resolves that set with one query per level.
 *
 * Dropping is the honest outcome for a true orphan: an entity whose parent we
 * have never seen cannot be placed in the hierarchy, and inventing the parent
 * would fabricate an entity that does not exist on the platform. Children of a
 * dropped op are dropped with it, so a missing subtree disappears cleanly rather
 * than half-landing.
 */
export function dropOrphans(ops, knownParentIds = new Set()) {
  const present = new Set(ops.map((o) => o.id));
  const kept = [];
  const dropped = [];
  for (const op of ops) {
    // Ops arrive sorted parents-first, so a parent's fate is always decided
    // before its children are examined — which is what makes the cascade work.
    if (op.parentId != null && !present.has(op.parentId) && !knownParentIds.has(op.parentId)) {
      present.delete(op.id); // cascade: this op's own children must go too
      dropped.push(op);
      continue;
    }
    kept.push(op);
  }
  if (dropped.length) {
    logger.warn(
      { dropped: dropped.length, levels: [...new Set(dropped.map((o) => o.level))] },
      '[snapshotSink] dropped entities whose parent exists in neither this batch nor the DB (would have failed the FK and rolled back the whole sync)',
    );
  }
  return kept;
}

/**
 * The subset of referenced parent ids that already exist in the DB. One query
 * per parent LEVEL (not per row) — no N+1. A read failure returns an empty set,
 * which degrades to the batch-only check: stricter, never wrong in the unsafe
 * direction.
 */
async function resolveKnownParents(ops) {
  const inBatch = new Set(ops.map((o) => o.id));
  // Group the missing parents by the model that would hold them.
  const byModel = new Map();
  for (const op of ops) {
    if (op.parentId == null || inBatch.has(op.parentId)) continue;
    const parentLevel = PARENT_LEVEL[op.level];
    const model = LEVEL_MODEL[parentLevel]?.model;
    if (!model) continue;
    if (!byModel.has(model)) byModel.set(model, new Set());
    byModel.get(model).add(op.parentId);
  }
  if (byModel.size === 0) return new Set(); // common path: nothing missing, no query

  const known = new Set();
  await Promise.all([...byModel].map(async ([model, ids]) => {
    try {
      const found = await prisma[model].findMany({ where: { id: { in: [...ids] } }, select: { id: true } });
      for (const row of found) known.add(row.id);
    } catch (err) {
      logger.warn({ model, err: err.message }, '[snapshotSink] parent-existence check failed — falling back to batch-only');
    }
  }));
  return known;
}

const DAY_MS = 86_400_000;

// A snapshot's identity for the same-day guard: one positive row per entity per
// UTC calendar day PER MEASUREMENT WINDOW.
//
// The window belongs in this key (Phase G). The guard exists to stop a bad or
// empty FETCH from overwriting real data for the same measurement — and two rows
// in different windows are not the same measurement, they are two answers to two
// different questions that a single sync run asks at the same instant.
//
// Without it, the commonest possible account shape loses its canonical row: a
// campaign that spent nothing in the last 30 days but has lifetime spend lands a
// CUMULATIVE_30D row with spend 0 beside an operational row with spend > 0, and
// the guard would read the operational positive as proof that the canonical zero
// is a bad fetch. It isn't — a real 0 over the canonical window is the measured
// truth, and discarding it is the "looks whole, isn't" failure with the sign
// flipped: the resolver would report NO_CANONICAL_WINDOW for exactly the
// campaigns most likely to deserve a KILL.
export function snapshotDayKey({ entityId, date, measurementWindow }) {
  const d = date instanceof Date ? date : new Date(date);
  return `${entityId}|${measurementWindow}|${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * PURE: drop any incoming zero-spend row that would shadow a same-day positive.
 * `positiveDayKeys` is the set of snapshotDayKey()s that already have spend > 0.
 * A genuinely-zero row with no same-day positive still lands; a positive row is
 * never dropped. (Same-day only: a legitimately new-day zero must be free to land
 * and become the latest — this guards against a bad/empty fetch, not real change.)
 */
export function dropShadowingZeros(rows, positiveDayKeys) {
  if (!positiveDayKeys || positiveDayKeys.size === 0) return rows;
  return rows.filter((r) => !(r.spendMinor === 0 && positiveDayKeys.has(snapshotDayKey(r))));
}

const startOfUtcDay = (ms) => {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

// Defensive net (any connector / any cause): a zero-spend snapshot must never
// shadow a real positive one for the same entity on the same day. One batched
// read (no N+1); a read failure degrades to the unguarded upsert (Fix 2 already
// makes the roster case safe, so this is belt-and-suspenders, never load-bearing
// for correctness of the common path).
async function guardZeroShadows(workspaceId, rows) {
  const zeros = rows.filter((r) => r.spendMinor === 0);
  if (zeros.length === 0) return rows; // common path: nothing to guard, no query
  try {
    const times = zeros.map((r) => (r.date instanceof Date ? r.date : new Date(r.date)).getTime());
    const dayStart = startOfUtcDay(Math.min(...times));
    const dayEnd = new Date(startOfUtcDay(Math.max(...times)).getTime() + DAY_MS);
    const existing = await prisma.metricSnapshot.findMany({
      where: {
        workspaceId,
        entityId: { in: zeros.map((r) => r.entityId) },
        date: { gte: dayStart, lt: dayEnd },
        spendMinor: { gt: 0 },
        // Only the windows the incoming zeros actually belong to. A positive row
        // in a DIFFERENT window is not evidence about this one (see
        // snapshotDayKey), and pulling it would put a key in the set that can
        // never legitimately match anyway.
        measurementWindow: { in: [...new Set(zeros.map((r) => r.measurementWindow))] },
      },
      select: { entityId: true, date: true, measurementWindow: true },
    });
    const positiveDayKeys = new Set(existing.map(snapshotDayKey));
    const guarded = dropShadowingZeros(rows, positiveDayKeys);
    if (guarded.length < rows.length) {
      logger.warn(
        { workspaceId, dropped: rows.length - guarded.length },
        '[snapshotSink] refused to shadow same-day positive spend with a zero snapshot',
      );
    }
    return guarded;
  } catch (err) {
    logger.warn({ workspaceId, err: err.message }, '[snapshotSink] zero-shadow guard skipped (read failed)');
    return rows;
  }
}

/**
 * Land a normalized batch for one workspace+channel. Idempotent (re-sync upserts
 * in place). Returns counts. Roster-only rows land as entities but not snapshots
 * (see toSnapshotRows); a zero never shadows a same-day positive (guardZeroShadows).
 */
export async function landSnapshots(workspaceId, channel, normalized = []) {
  if (!workspaceId) throw new Error('landSnapshots: workspaceId required');
  if (!normalized.length) return { entities: 0, snapshots: 0 };

  const allOps = toEntityOps(workspaceId, channel, normalized);
  // A row whose parent is in neither the batch nor the DB would raise an FK
  // violation, and every op shares ONE transaction — so one orphan ad would cost
  // this sync its campaigns too.
  const entityOps = dropOrphans(allOps, await resolveKnownParents(allOps));
  await prisma.$transaction(
    entityOps.map((op) =>
      prisma[op.model].upsert({
        where: { id: op.id },
        create: { id: op.id, ...op.data },
        // Only overwrite objective/status when the new value is KNOWN — a later
        // roster/short-window sync that lacks one must never clobber a
        // previously-resolved value. `status` was unconditionally overwritten
        // with the hardcoded 'ACTIVE', so a paused entity was re-activated on
        // every single sync. Objective is absent for non-campaign ops.
        update: {
          name: op.data.name,
          ...(op.data.status != null ? { status: op.data.status } : {}),
          ...(op.data.objective != null ? { objective: op.data.objective } : {}),
          // Same known-only rule: a short-window or insights-only sync that never
          // saw the /campaigns edge must not blank a creation time we already
          // resolved. It is immutable anyway — first known value wins forever.
          ...(op.data.platformCreatedTime != null ? { platformCreatedTime: op.data.platformCreatedTime } : {}),
        },
      }),
    ),
  );

  // Snapshots only for entities that actually landed. `metric_snapshots.entityId`
  // carries no FK, so an orphan's snapshot would NOT fail — it would silently
  // persist and be swept by every reader that queries snapshots by workspace
  // without joining the entity graph (GuardrailSweepService, PatternService,
  // BlendedTruthService all do). That produces findings about an entity the
  // graph does not contain, which is worse than the dropped row itself.
  const landedIds = new Set(entityOps.map((op) => op.id));
  const rows = await guardZeroShadows(
    workspaceId,
    toSnapshotRows(workspaceId, channel, normalized).filter((r) => landedIds.has(r.entityId)),
  );
  await prisma.$transaction(
    rows.map((r) =>
      prisma.metricSnapshot.upsert({
        where: {
          entityId_entityLevel_date_granularity_source_measurementWindow: {
            entityId: r.entityId, entityLevel: r.entityLevel, date: r.date, granularity: r.granularity, source: r.source,
            // Part of the identity since Phase F. One sync run stamps ONE `date`,
            // so a canonical 30-day row and the operational rolling row beside it
            // match on every other column — and this is an UPSERT, so without
            // this line the second silently overwrites the first.
            measurementWindow: r.measurementWindow,
          },
        },
        create: r,
        update: r,
      }),
    ),
  );

  logger.info({ workspaceId, channel, entities: entityOps.length, snapshots: rows.length }, '[snapshotSink] landed');
  return { entities: entityOps.length, snapshots: rows.length };
}
