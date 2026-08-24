// ============================================================
// RevenueCsvService — manual revenue actuals from a CSV upload
// ------------------------------------------------------------
// Unlocks ROAS for accounts with NO purchase pixel: the user uploads campaign
// revenue, we fuzzy-match each row to an existing Campaign entity, and land the
// revenue as a MANUAL-source MetricSnapshot — the same "decorate, don't mint"
// contract GA4 actuals use (actualsSink). We NEVER overwrite the platform
// (META/GOOGLE) snapshot: a manual row on a separate `source` key means the next
// live sync can't clobber it, and BlendedTruth still reconciles platform-claimed
// vs actual honestly (MANUAL is an ACTUAL source).
//
// The verdict projection (entityGraphEngine.effectiveByEntity) overlays the
// latest actual revenue onto the latest platform row, so ROAS lights up without
// the MANUAL row's spend:0 shadowing the platform spend.
//
// Honest by construction: an identifier that matches no campaign, or a campaign
// with no synced snapshot to attach to, is SURFACED (never silently dropped);
// truly-zero revenue still leaves ROAS at "—".
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { upsertNonDailyMetricSnapshot } from '../connectors/nonDailySnapshotWrite.js';
import { logger } from '../../utils/logger.js';
import { toMinor } from '../../lib/money.js';
import { DATA_SOURCE, ENTITY_LEVEL, MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';
import { selectOperationalSnapshots } from '../evidence/index.js';

export const MAX_REVENUE_CSV_ROWS = 500;

/**
 * PURE: best-effort match of a CSV identifier to a campaign.
 * exact (name OR externalId) → case-insensitive name → partial containment.
 * Returns the campaign, or null (surfaced to the user as unmatched — never guessed).
 */
export function findBestMatch(campaigns, identifier) {
  if (identifier == null) return null;
  const id = String(identifier).trim();
  if (!id) return null;

  // 1. exact — name or platform externalId
  let m = campaigns.find((c) => c.name === id || c.externalId === id);
  if (m) return m;

  // 2. case-insensitive name
  const lower = id.toLowerCase();
  m = campaigns.find((c) => (c.name ?? '').toLowerCase() === lower);
  if (m) return m;

  // 3. partial containment either direction (handles export prefixes/suffixes)
  m = campaigns.find((c) => {
    const cn = (c.name ?? '').toLowerCase();
    return cn.length > 0 && (cn.includes(lower) || lower.includes(cn));
  });
  return m ?? null;
}

/**
 * PURE: a revenue cell → a non-negative number, or null when unparseable.
 * Strips currency symbols, thousands separators, and whitespace ("EGP 12,500" →
 * 12500). Assumes '.' is the decimal separator (standard ad-platform exports).
 */
export function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * PURE: a conversion-count cell → a non-negative integer, or null when absent /
 * unparseable. Reuses parseAmount's cleaning (a CSV export writes "1,204", which
 * Number() alone reads as NaN) and rounds — a count is whole. Null (not 0) so the
 * caller can tell "no conversions column mapped" from a measured zero.
 */
export function parseCount(raw) {
  const n = parseAmount(raw);
  return n == null ? null : Math.round(n);
}

/**
 * Match rows → campaigns, land the revenue as MANUAL-source snapshots.
 * @param {string} workspaceId
 * @param {Array<{campaignIdentifier:string, revenueAmount:(string|number), conversions?:(string|number), currency?:string}>} rows
 *   `conversions` is OPTIONAL — absent (the pre-existing 2-column upload) lands 0,
 *   exactly as before.
 * @returns {Promise<{ matched:number, updated:number, unmatched:Array, errors:Array }>}
 */
export async function processRevenueCsv(workspaceId, rows) {
  if (!workspaceId) throw new Error('processRevenueCsv: workspaceId required');
  const results = { matched: 0, updated: 0, unmatched: [], errors: [] };
  if (!Array.isArray(rows) || rows.length === 0) return results;

  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId },
    select: { id: true, name: true, externalId: true },
  });

  // 1. Resolve every row up-front (pure) — collect matches + surface misses.
  const matched = [];
  for (const row of rows) {
    const identifier = row?.campaignIdentifier;
    const campaign = findBestMatch(campaigns, identifier);
    if (!campaign) {
      results.unmatched.push({ identifier: String(identifier ?? '').trim(), reason: 'no matching campaign' });
      continue;
    }
    const amount = parseAmount(row?.revenueAmount);
    if (amount == null) {
      results.errors.push({ identifier: campaign.name, reason: 'invalid revenue amount' });
      continue;
    }
    results.matched += 1;
    // An unparseable conversions cell degrades to null → lands 0, the same as an
    // unmapped column. It never fails the row: revenue is the required truth here.
    matched.push({ campaign, amount, conversions: parseCount(row?.conversions), currency: row?.currency });
  }

  // 2. One query for the latest snapshot per matched entity (no N+1 in the loop):
  //    gives the date + currency the MANUAL actual aligns to.
  const ids = [...new Set(matched.map((m) => m.campaign.id))];
  const snaps = ids.length
    ? await selectOperationalSnapshots(workspaceId, {
        // R3.8. This file no longer states WHERE its evidence lives. The
        // operational population — workspace scope and the Phase-G window
        // allow-list — is declared once in the Evidence layer and asked for here.
        // The reason it had to be operational has not changed: the uploaded
        // revenue is attached to THIS row's `date` and currency, and the MANUAL
        // row it produces is read back by the operational overlay, so it has to
        // align with an operational row rather than a canonical one no
        // operational reader will ever see it beside.
        //
        // `entityLevel` is the seam's second narrowing and this is its first
        // caller. It is a NARROWER QUESTION, not a narrower population: campaign
        // rows are what a manual campaign-revenue upload can attach to, and an
        // ad-set row carrying the same entityId would hand back the wrong date.
        //
        // Descending, EXPLICITLY. The seam's default is oldest-first; the reducer
        // below takes the first row per entity and calls it the latest, so the
        // ordering is load-bearing rather than incidental. Inheriting the default
        // here would silently make "latest" mean "oldest".
        //
        // NO `since` (this read has never had one — an upload must be able to
        // attach to a campaign whose last sync is old), NO source filter (the
        // post-query logic owns none either), NO reduction, and NO catch: a
        // failed read propagates to the route, which reports the upload failed.
        // Turning it into `[]` here would report every matched campaign as
        // "no synced data yet — sync this channel first" about a database we
        // could not reach.
        entityIds:   ids,
        entityLevel: ENTITY_LEVEL.CAMPAIGN,
        select:      { entityId: true, date: true, currency: true },
        orderBy:     { date: 'desc' },
      })
    : [];
  const latestByEntity = new Map();
  for (const s of snaps) if (!latestByEntity.has(s.entityId)) latestByEntity.set(s.entityId, s); // desc → first = latest

  // 3. Build MANUAL-source snapshot rows (decorate the entity; never the platform row).
  const snapshotRows = [];
  for (const m of matched) {
    const latest = latestByEntity.get(m.campaign.id);
    if (!latest) {
      results.matched -= 1; // matched a name but nothing to attach to — report honestly
      results.unmatched.push({ identifier: m.campaign.name, reason: 'no synced data yet — sync this channel first' });
      continue;
    }
    const currency = m.currency || latest.currency || 'USD';
    snapshotRows.push({
      workspaceId,
      entityId: m.campaign.id,
      entityLevel: ENTITY_LEVEL.CAMPAIGN,
      date: latest.date,
      source: DATA_SOURCE.MANUAL,
      granularity: 'DAILY',
      // A human uploaded a revenue figure. Nothing in the file says what period
      // it covers — the upload has no date range, and `latest.date` borrowed
      // below is the platform row's SYNC time, not a measurement span. So the
      // period is genuinely unknown, and saying so is the only honest option.
      measurementWindow: MEASUREMENT_WINDOW.LEGACY_UNKNOWN,
      windowStart: null,
      windowEnd: null,
      spendMinor: 0, // an actual carries no spend — the platform row supplies it
      revenueMinor: toMinor(m.amount, currency),
      // CPA is SPEND ÷ conversions (snapshotSink), and this row's spend is 0 by
      // contract — so CPA is NOT derivable here and stays null (mirrors
      // actualsSink). The account CPA is derived downstream from the PLATFORM
      // row's spend ÷ these conversions. Writing revenue ÷ conversions here would
      // store average order value under the name `cpaMinor` — a mislabelled
      // number the guardrail sweep reads as cost.
      cpaMinor: null,
      impressions: 0,
      clicks: 0,
      // The conversion COUNT the platform pixel never saw (optional column).
      // Absent → 0, preserving the pre-conversions upload behaviour exactly.
      conversions: m.conversions ?? 0,
      ctr: null,
      roas: null, // ratios stay null; the projection re-derives roas from platform spend
      frequency: null,
      currency,
    });
  }

  // 4. Idempotent upsert by the source-keyed natural key (mirrors actualsSink).
  if (snapshotRows.length) {
      // B4-E4 — the SAME identity, the SAME atomic batch, a different mechanism.
      // Prisma's generated compound-key upsert cannot carry an ON CONFLICT
      // predicate, and PostgreSQL will not match a predicated statement to a
      // partial index without one. Nothing about what is written changes here.
    await prisma.$transaction(snapshotRows.map((r) => upsertNonDailyMetricSnapshot(prisma, r)));
    results.updated = snapshotRows.length;
  }

  logger.info(
    { workspaceId, matched: results.matched, updated: results.updated, unmatched: results.unmatched.length, errors: results.errors.length },
    '[RevenueCsv] processed manual revenue upload',
  );
  return results;
}
