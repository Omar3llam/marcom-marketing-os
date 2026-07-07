// ============================================================
// EntityGraphEngine — pure shaping for the connector entity graph
// ============================================================
// Reads NOTHING. Turns raw entity-graph rows (Campaign / AdSet) + their
// MetricSnapshot rows into the honest projection the Campaigns surface renders.
// Latest-snapshot-per-entity is resolved here, in ONE place, null-where-absent:
// a missing metric stays null so the client renders "—", never a fabricated 0.
// All metric ratios (roas/ctr/frequency) are lifted verbatim from the snapshot
// the connector sink already derived — this engine never computes a number.
// ============================================================

/**
 * PURE: reduce a flat list of MetricSnapshot rows to the latest (max `date`)
 * per entityId. Order-independent. Returns Map<entityId, snapshot>.
 */
export function latestByEntity(snapshots = []) {
  const byEntity = new Map();
  for (const s of snapshots) {
    if (!s || s.entityId == null) continue;
    const prev = byEntity.get(s.entityId);
    if (!prev || new Date(s.date).getTime() > new Date(prev.date).getTime()) {
      byEntity.set(s.entityId, s);
    }
  }
  return byEntity;
}

// Snapshot `source` groupings — mirror BlendedTruthService (kept local so this
// pure engine stays dependency-free). MANUAL = a manual revenue actual (CSV
// upload); actual sources are the trusted revenue truth over platform claims.
const PLATFORM_SOURCES = new Set(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);
const ACTUAL_SOURCES = new Set(['GA4', 'SHOPIFY', 'MANUAL']);

function latestOf(list) {
  let best = null;
  for (const s of list) {
    if (!best || new Date(s.date).getTime() > new Date(best.date).getTime()) best = s;
  }
  return best;
}

/**
 * PURE: reduce snapshots to ONE effective row per entity, overlaying actual
 * revenue onto the platform row. The latest PLATFORM row supplies spend +
 * engagement; the latest ACTUAL-source revenue (GA4/Shopify/MANUAL) overrides
 * `revenueMinor` and re-derives `roas` from the platform spend — so a manually
 * uploaded revenue lights up ROAS without its spend:0 shadowing the real spend,
 * and a live re-sync of the platform row can never clobber it (separate source).
 *
 * No actual rows → identical to latestByEntity (zero behaviour change for the
 * common platform-only account). Order-independent. Returns Map<entityId, snap>.
 */
export function effectiveByEntity(snapshots = []) {
  const groups = new Map();
  for (const s of snapshots) {
    if (!s || s.entityId == null) continue;
    const arr = groups.get(s.entityId);
    if (arr) arr.push(s); else groups.set(s.entityId, [s]);
  }

  const out = new Map();
  for (const [entityId, snaps] of groups) {
    const platform = latestOf(snaps.filter((s) => PLATFORM_SOURCES.has(s.source)));
    const base = platform ?? latestOf(snaps); // fallback: latest overall (e.g. actual-only)
    if (!base) continue;

    const actual = latestOf(snaps.filter((s) => ACTUAL_SOURCES.has(s.source)));
    if (actual && actual !== base && Number.isFinite(actual.revenueMinor) && actual.revenueMinor > 0) {
      const spendMinor = base.spendMinor;
      out.set(entityId, {
        ...base,
        revenueMinor: actual.revenueMinor,
        roas: Number.isFinite(spendMinor) && spendMinor > 0 ? actual.revenueMinor / spendMinor : null,
      });
    } else {
      out.set(entityId, base);
    }
  }
  return out;
}

// Metric fields lifted verbatim from a snapshot — null when the snapshot is
// absent (distinct from a real 0), so the client shows "—" not "0".
function metricsOf(snap) {
  return {
    spendMinor:  snap?.spendMinor ?? null,
    roas:        snap?.roas ?? null,
    ctr:         snap?.ctr ?? null,
    frequency:   snap?.frequency ?? null,
    conversions: snap?.conversions ?? null, // null-when-absent (distinct from a real 0)
    // Raw verdict-engine inputs (re-derives roas/ctr from these). null-when-
    // absent so the revenue gate can tell "no snapshot" from a measured 0.
    revenueMinor: snap?.revenueMinor ?? null,
    impressions:  snap?.impressions ?? null,
    clicks:       snap?.clicks ?? null,
    currency:    snap?.currency ?? null,
    lastDate:    snap?.date ?? null,
  };
}

/** PURE: project a Campaign entity + its latest CAMPAIGN snapshot into a row. */
export function toCampaignRow(campaign, snap) {
  return {
    entityId:   campaign.id,
    channel:    campaign.channel,
    name:       campaign.name,
    objective:  campaign.objective ?? null, // platform objective (awareness vs conversion); null when unknown
    adSetCount: campaign.adSetCount ?? 0,
    ...metricsOf(snap),
  };
}

/** PURE: project an AdSet entity + its latest ADSET snapshot into a row. */
export function toAdSetRow(adSet, snap) {
  return {
    entityId: adSet.id,
    channel:  adSet.channel,
    name:     adSet.name,
    ...metricsOf(snap),
  };
}
