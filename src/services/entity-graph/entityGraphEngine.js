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

// How far an actual-revenue row may lag the platform row it decorates before it
// stops being evidence about that spend. Measured BETWEEN THE TWO ROWS' dates
// (not against the wall clock) so this engine stays pure: a connector row is a
// rolling-window aggregate re-stamped every sync, so as the platform row marches
// forward a once-uploaded revenue drifts further from the spend it is divided by.
// Past this bound we stop scoring it rather than publish a confidently wrong ROAS.
// An account whose syncing stopped entirely is NOT stale by this measure — its
// revenue and spend are still contemporaries (connectorHealth owns that story).
export const REVENUE_MAX_AGE_MS = Number(process.env.REVENUE_MAX_AGE_DAYS || 90) * 24 * 60 * 60 * 1000;

/**
 * PURE: reduce snapshots to ONE effective row per entity, overlaying actual
 * revenue onto the platform row. The latest PLATFORM row supplies spend +
 * engagement; the latest ACTUAL-source revenue (GA4/Shopify/MANUAL) overrides
 * `revenueMinor` and re-derives `roas` from the platform spend — so a manually
 * uploaded revenue lights up ROAS without its spend:0 shadowing the real spend,
 * and a live re-sync of the platform row can never clobber it (separate source).
 *
 * An actual lagging the platform row by more than `maxRevenueAgeMs` is NOT
 * overlaid: the row keeps its own platform figures and carries `revenueStale`
 * so the reader can say "revenue data outdated" instead of scoring a ROAS that
 * pairs old revenue with newer spend. A fresh platform pixel revenue therefore
 * still stands on its own — a stale manual upload never blanks it.
 *
 * No actual rows → identical to latestByEntity (zero behaviour change for the
 * common platform-only account). Order-independent. Returns Map<entityId, snap>.
 */
export function effectiveByEntity(snapshots = [], { maxRevenueAgeMs = REVENUE_MAX_AGE_MS } = {}) {
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
    const hasRevenue = actual && actual !== base
      && Number.isFinite(actual.revenueMinor) && actual.revenueMinor > 0;

    if (!hasRevenue) {
      out.set(entityId, base);
      continue;
    }

    // Negative lag (an actual NEWER than the platform row) is fresh, never stale.
    const lagMs = new Date(base.date).getTime() - new Date(actual.date).getTime();
    if (lagMs > maxRevenueAgeMs) {
      // Keep the platform row untouched — including its own pixel revenue, which
      // is current even when a manual upload has gone stale.
      out.set(entityId, { ...base, revenueStale: true });
      continue;
    }

    const spendMinor = base.spendMinor;
    out.set(entityId, {
      ...base,
      revenueMinor: actual.revenueMinor,
      roas: Number.isFinite(spendMinor) && spendMinor > 0 ? actual.revenueMinor / spendMinor : null,
      // The same actual may carry the conversion COUNT the platform pixel never
      // saw (a manual upload's optional column). Overlay it on the revenue's
      // terms — a real count only — so account CPA can be derived from the
      // platform row's spend ÷ measured conversions. A zero/absent count leaves
      // the platform's own conversions standing: an actual without a conversions
      // column must never erase a pixel that IS counting.
      conversions: Number.isFinite(actual.conversions) && actual.conversions > 0
        ? actual.conversions
        : base.conversions,
      revenueStale: false,
    });
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
    reach:       snap?.reach ?? null, // unique people reached; null when unreported (distinct from a real 0)
    conversions: snap?.conversions ?? null, // null-when-absent (distinct from a real 0)
    // Raw verdict-engine inputs (re-derives roas/ctr from these). null-when-
    // absent so the revenue gate can tell "no snapshot" from a measured 0.
    revenueMinor: snap?.revenueMinor ?? null,
    impressions:  snap?.impressions ?? null,
    clicks:       snap?.clicks ?? null,
    // The funnel bag { lpv, atc, checkout, lead, … }. null-when-absent, never
    // {} — the funnel rules treat null as "blind" and decline to diagnose,
    // rather than reading a missing stage as a measured zero drop-off.
    actionMetrics: snap?.actionMetrics ?? null,
    dailyBudgetMinor: snap?.dailyBudgetMinor ?? null,
    currency:    snap?.currency ?? null,
    lastDate:    snap?.date ?? null,
    // true only when a real actual-revenue row exists but lags the platform row
    // past the bound — i.e. "revenue data outdated", distinct from never having
    // uploaded any (false), which the needs-revenue surface already covers.
    revenueStale: snap?.revenueStale === true,
  };
}

/** PURE: project a Campaign entity + its latest CAMPAIGN snapshot into a row. */
export function toCampaignRow(campaign, snap) {
  return {
    entityId:   campaign.id,
    channel:    campaign.channel,
    name:       campaign.name,
    objective:  campaign.objective ?? null, // platform objective (awareness vs conversion); null when unknown
    // Platform-native campaign id (snapshotSink writes it on every synced
    // entity). null for rows that predate the connector — the client renders no
    // platform link rather than a guessed one.
    externalId: campaign.externalId ?? null,
    // Platform-side creation time — the basis for days-running. null for
    // pre-connector rows and channels that don't report it, which makes the
    // too-early gate honestly skip rather than assume a campaign is new.
    platformCreatedTime: campaign.platformCreatedTime ?? null,
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
    // Delivery status (ACTIVE | PAUSED | ARCHIVED). Derived from Meta's
    // effective_status, so CAMPAIGN_PAUSED lands as PAUSED — an ad set is not
    // running just because its own switch is on. NOTE: the column is NOT NULL
    // and defaults to ACTIVE, so ACTIVE means "running, OR never told"; only
    // PAUSED/ARCHIVED are positive knowledge. Readers must act on those two.
    status:   adSet.status ?? null,
    ...metricsOf(snap),
  };
}
