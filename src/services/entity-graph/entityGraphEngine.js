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

// Metric fields lifted verbatim from a snapshot — null when the snapshot is
// absent (distinct from a real 0), so the client shows "—" not "0".
function metricsOf(snap) {
  return {
    spendMinor: snap?.spendMinor ?? null,
    roas:       snap?.roas ?? null,
    ctr:        snap?.ctr ?? null,
    frequency:  snap?.frequency ?? null,
    currency:   snap?.currency ?? null,
    lastDate:   snap?.date ?? null,
  };
}

/** PURE: project a Campaign entity + its latest CAMPAIGN snapshot into a row. */
export function toCampaignRow(campaign, snap) {
  return {
    entityId:   campaign.id,
    channel:    campaign.channel,
    name:       campaign.name,
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
