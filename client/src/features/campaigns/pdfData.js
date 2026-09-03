// ============================================================
// MARCOM / Lumi — Content for the Campaign PDF (connector substrate)
// ------------------------------------------------------------
// PURE: turn the LIVE connector graph into the rows the PDF renders. One row per
// synced campaign (never duplicated): a scored campaign carries its engine
// verdict + rationale; a GATED campaign carries the reason it was gated and the
// note that reason implies — NEVER a fabricated verdict.
//
// C-07 — the gated half used to be a boolean. `gatedOutIds` was a Set of ids
// built by throwing away the `reason` the backend published, so every gated
// campaign got the same line, "Add revenue data to unlock verdict", including
// the ones that had never been synced and the ones whose measurement had gone
// stale. Rows now carry `gatingReason` and a rationale derived from it.
//
// Units: spend comes as `spendMinor` (integer minor units) + a currency code, so
// it's converted via the currency's real exponent (fromMinor), never a hardcoded
// /100 (a Gulf dinar is 1000 fils). CTR is a fraction on the snapshot → the PDF
// wants a percentage, so it's ×100. A missing metric stays null (renders "—").
// ============================================================
import { fromMinor } from '@/lib/money';
import { gatedRationale } from './gatingReasonCopy.js';

/**
 * @param {Object} args
 * @param {Array}  args.connectorCampaigns    - rows from useConnectorCampaigns (all synced, scored + gated)
 * @param {Object} args.verdictByEntityId     - entityId → verdict string
 * @param {Object} args.verdictInfoByEntityId - entityId → { rationale, confidence }
 * @param {Object} args.impactByEntityId      - entityId → impact score
 * @param {Array}  args.gatedOut              - useConnectorVerdicts.gatedOut, WHOLE rows:
 *   { id, name, reason, knowledge, prerequisite, …reason-specific operands }.
 *   Passed intact rather than as a Set of ids — the reason is the point.
 * @returns {Array} PDF rows { entityId, campaign, verdict, rationale, spend, roas,
 *   ctr, currency, impact, gatingReason }
 */
export function buildPdfCampaigns({
  connectorCampaigns = [],
  verdictByEntityId = {},
  verdictInfoByEntityId = {},
  impactByEntityId = {},
  gatedOut = [],
} = {}) {
  const gatedById = new Map((gatedOut ?? []).map((g) => [g.id, g]));

  return connectorCampaigns.map((c) => {
    const gated = gatedById.get(c.entityId) ?? null;
    return {
      entityId:  c.entityId,
      campaign:  c.name,
      // Gated rows are never scored → no verdict; a scored row gets the engine's.
      verdict:   gated ? null : (verdictByEntityId[c.entityId] ?? null),
      rationale: gated
        ? gatedRationale(gated)
        : (verdictInfoByEntityId[c.entityId]?.rationale ?? null),
      // Minor → major via the currency's real exponent; null stays null ("—").
      spend:     c.spendMinor != null ? fromMinor(c.spendMinor, c.currency || 'USD') : null,
      roas:      c.roas ?? null,
      ctr:       c.ctr != null ? c.ctr * 100 : null, // fraction → percentage
      currency:  c.currency || 'USD',
      impact:    impactByEntityId[c.entityId] ?? null,
      // The reason itself, so the summary page can group by it. null for a
      // scored campaign — and `needsRevenue` is gone: it named one of three
      // reasons and was set for all of them.
      gatingReason: gated?.reason ?? null,
      // Carried so the summary can state the age without re-reading gatedOut.
      measurementAgeDays: gated?.measurementAgeDays ?? null,
      maxAgeDays: gated?.maxAgeDays ?? null,
    };
  });
}
