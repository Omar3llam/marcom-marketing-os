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

    // R5: the provenance of a BLENDED row. Two real rows, two sources, two
    // observation timestamps — recorded in the order they contribute (the
    // platform row supplies spend and everything else; the actual supplies
    // revenue, and possibly conversions). Stamped here because this is the only
    // place that knows a second row was involved; downstream all that survives
    // is one merged object.
    const blendedEvidence = [
      { entityId, source: base.source ?? null,   observedAt: base.date ?? null },
      { entityId, source: actual.source ?? null, observedAt: actual.date ?? null },
    ];

    // Negative lag (an actual NEWER than the platform row) is fresh, never stale.
    const lagMs = new Date(base.date).getTime() - new Date(actual.date).getTime();
    if (lagMs > maxRevenueAgeMs) {
      // Keep the platform row untouched — including its own pixel revenue, which
      // is current even when a manual upload has gone stale.
      //
      // The stale actual did NOT contribute, so it is NOT in the provenance.
      // Listing a row we deliberately declined to use would be the reference
      // claiming evidence the number never rested on.
      out.set(entityId, { ...base, revenueStale: true });
      continue;
    }

    const spendMinor = base.spendMinor;
    out.set(entityId, {
      ...base,
      _evidenceRows: blendedEvidence,
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

/**
 * PURE: the evidence rows a projected row's numbers actually came from, as
 * provenance metadata ONLY — entity, source, observation timestamp. Never the
 * values: those are already on the row, and two copies of a number is two
 * numbers that can disagree.
 *
 * R5 REPAIRS A LOSS POINT HERE. `source` used to die at this projection and
 * `date` survived only as `lastDate`, so by the time a verdict was persisted
 * nothing could say which source it read or when the reading was taken.
 *
 * USUALLY ONE ROW, SOMETIMES TWO. effectiveByEntity can build a row from a
 * PLATFORM row and an ACTUAL-revenue row with different sources and different
 * dates; when it does, it stamps both here (see `_evidenceRows`). Reporting one
 * source and one timestamp for a blended row would name the platform's date
 * beside the actual's revenue — a single-reference design cannot describe that
 * row honestly, which is exactly why R5's reference is a list.
 */
function evidenceRowsOf(snap) {
  if (!snap) return [];
  if (Array.isArray(snap._evidenceRows)) return snap._evidenceRows;
  return [{
    entityId:   snap.entityId ?? null,
    source:     snap.source ?? null,
    observedAt: snap.date ?? null, // the SYNC/observation timestamp, never a clock
  }];
}

// Metric fields lifted verbatim from a snapshot — null when the snapshot is
// absent (distinct from a real 0), so the client shows "—" not "0".
function metricsOf(snap) {
  return {
    // Provenance, not a metric: which row(s) the numbers below came from. Empty
    // when there is no snapshot at all — the same honest absence the nulls carry.
    evidenceRows: evidenceRowsOf(snap),
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

/**
 * PURE: project a Campaign entity + its latest CAMPAIGN snapshot into a row.
 *
 * `evidenceBasis` (R5) is what the READER knows and the row cannot infer: which
 * population it read, through which selector, over what measurement window, with
 * what reduction, and how many rows it consumed before reducing. It is passed in
 * rather than derived here for the reason the Evidence layer exists at all — the
 * population is a property of the QUERY, and a projection that guessed it from
 * the row in front of it would be inferring a population from a value, which is
 * the merge the canonical/operational split is there to prevent.
 *
 * null when the caller did not declare one, and null stays null all the way to
 * the stored decision: "not captured" is a real state and never a fabricated
 * basis.
 */
export function toCampaignRow(campaign, snap, evidenceBasis = null) {
  return {
    entityId:   campaign.id,
    evidenceBasis,
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
    // How many ads hang off this ad-set — the client's only honest basis for
    // showing a drill chevron. Same shape as toCampaignRow's adSetCount (carried
    // ON the entity object, not a positional arg), so a caller that never counted
    // reports 0 rather than a phantom expandable row.
    adCount:  adSet.adCount ?? 0,
    ...metricsOf(snap),
  };
}

/**
 * PURE: project an Ad entity + its latest AD snapshot into a row.
 * Mirrors toAdSetRow one level down, plus platformCreatedTime — at AD level that
 * field is CREATIVE AGE, the input a fatigue trend is actually about (how long
 * this audience has been seeing THIS ad, not how long its campaign has run).
 * Absent by design at ad-set level, which has no creative of its own.
 *
 * metricsOf spreads `actionMetrics`, so the video quartiles PR #310's ACTION_MAP
 * lands (videoView / video25 / video50 / video95) arrive here for free — they
 * only exist meaningfully at this level.
 */
export function toAdRow(ad, snap) {
  return {
    entityId: ad.id,
    channel:  ad.channel,
    name:     ad.name,
    // Same NOT NULL / default-ACTIVE caveat as toAdSetRow: only PAUSED and
    // ARCHIVED are positive knowledge.
    status:   ad.status ?? null,
    // null for pre-connector rows and channels that don't report it — creative
    // age is then unknown, which must read as unknown, never as "brand new".
    platformCreatedTime: ad.platformCreatedTime ?? null,
    ...metricsOf(snap),
  };
}
