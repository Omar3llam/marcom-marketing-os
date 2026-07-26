// ============================================================
// MARCOM / Lumi — campaignGrouping (Campaigns · decision queue)
// ------------------------------------------------------------
// PURE: turn the flat connector campaign list into a decision queue — what
// needs acting on, what to watch, what is fine, and what cannot be scored at
// all. No I/O, no React; same input → same output, so the ordering is testable
// without rendering (mirrors verdictEvidence.js).
//
// MAP SHAPES (verified against CampaignsView, NOT assumed):
//   verdicts[entityId] → 'KILL'  — a STRING, not { verdict }
//   impacts[entityId]  → 7       — a NUMBER, not { impactScore }
// Both are built flat in CampaignsView (verdictByEntityId / impactByEntityId)
// and reach this file through the panel's `verdicts` / `impacts` props.
//
// HONESTY: a campaign the engine could not score (gated out — no measured
// revenue and no engagement) has NO verdict. It lands in UNSCORED, never in
// HEALTHY: "we couldn't judge this" and "this is fine" are different claims.
// ============================================================

export const GROUPS = {
  ACTION:   'action',   // KILL + REALLOCATE — money is being lost or misplaced
  WATCHING: 'watching', // WATCH + REFRESH   — trending wrong, not yet urgent
  HEALTHY:  'healthy',  // HOLD + SCALE      — working; leave alone or grow
  UNSCORED: 'unscored', // no verdict        — gated out / needs revenue data
};

// Exhaustive over the six-verdict enum (verdict-engine/verdictTypes.js). A
// verdict absent from this map falls to UNSCORED rather than being dropped, so
// a new verdict can never silently disappear from the table.
const VERDICT_TO_GROUP = {
  KILL:       GROUPS.ACTION,
  REALLOCATE: GROUPS.ACTION,
  WATCH:      GROUPS.WATCHING,
  REFRESH:    GROUPS.WATCHING,
  HOLD:       GROUPS.HEALTHY,
  SCALE:      GROUPS.HEALTHY,
};

export const GROUP_ORDER = [GROUPS.ACTION, GROUPS.WATCHING, GROUPS.HEALTHY, GROUPS.UNSCORED];

export const GROUP_CONFIG = {
  [GROUPS.ACTION]:   { label: 'Needs Action', color: 'text-signal-kill' },
  [GROUPS.WATCHING]: { label: 'Watching',     color: 'text-signal-watch' },
  [GROUPS.HEALTHY]:  { label: 'Healthy',      color: 'text-signal-scale' },
  [GROUPS.UNSCORED]: { label: 'Needs Data',   color: 'text-lumi-muted' },
};

/**
 * PURE: order within a group — impact desc, then spend desc, then name.
 *
 * impactScore is SPARSE by design: AccountHealthService only scores campaigns
 * above 1% of account spend, so a sub-floor campaign has none. A missing score
 * sorts AFTER every real one (it is unknown, not zero), and spend then breaks
 * the tie so the biggest unscored budgets still surface first.
 */
function sortCampaigns(campaigns, impacts = {}) {
  return [...campaigns].sort((a, b) => {
    const iA = impacts?.[a.entityId] ?? null;
    const iB = impacts?.[b.entityId] ?? null;

    if (iA != null && iB == null) return -1;
    if (iA == null && iB != null) return 1;
    if (iA != null && iB != null && iA !== iB) return iB - iA;

    const sA = a.spendMinor ?? 0;
    const sB = b.spendMinor ?? 0;
    if (sA !== sB) return sB - sA;

    return (a.name ?? '').localeCompare(b.name ?? '');
  });
}

/**
 * PURE: split campaigns into the four decision bands, each internally sorted.
 * Never mutates the input array.
 *
 * @param {Array<object>} campaigns — connector rows ({ entityId, name, spendMinor, … })
 * @param {Record<string, string>} verdicts — entityId → verdict STRING
 * @param {Record<string, number>} impacts  — entityId → impactScore NUMBER
 * @returns {Record<string, Array<object>>} keyed by GROUPS.*
 */
export function groupCampaigns(campaigns = [], verdicts = {}, impacts = {}) {
  const groups = {
    [GROUPS.ACTION]:   [],
    [GROUPS.WATCHING]: [],
    [GROUPS.HEALTHY]:  [],
    [GROUPS.UNSCORED]: [],
  };

  for (const c of campaigns ?? []) {
    if (!c) continue;
    const verdict = verdicts?.[c.entityId] ?? null;
    groups[VERDICT_TO_GROUP[verdict] ?? GROUPS.UNSCORED].push(c);
  }

  for (const key of GROUP_ORDER) groups[key] = sortCampaigns(groups[key], impacts);
  return groups;
}
