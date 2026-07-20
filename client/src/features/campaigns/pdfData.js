// ============================================================
// MARCOM / Lumi — Content for the Campaign PDF (connector substrate)
// ------------------------------------------------------------
// PURE: turn the LIVE connector graph into the rows the PDF renders. One row per
// synced campaign (never duplicated): a scored campaign carries its engine
// verdict + rationale; a gated (no-revenue) campaign carries an honest "add
// revenue data" note and needsRevenue=true — NEVER a fabricated verdict.
//
// Units: spend comes as `spendMinor` (integer minor units) + a currency code, so
// it's converted via the currency's real exponent (fromMinor), never a hardcoded
// /100 (a Gulf dinar is 1000 fils). CTR is a fraction on the snapshot → the PDF
// wants a percentage, so it's ×100. A missing metric stays null (renders "—").
// ============================================================
import { fromMinor } from '@/lib/money';

/**
 * @param {Object} args
 * @param {Array}  args.connectorCampaigns    - rows from useConnectorCampaigns (all synced, scored + gated)
 * @param {Object} args.verdictByEntityId     - entityId → verdict string
 * @param {Object} args.verdictInfoByEntityId - entityId → { rationale, confidence }
 * @param {Object} args.impactByEntityId      - entityId → impact score
 * @param {Set}    args.gatedOutIds           - entityIds with no measured revenue (from useConnectorVerdicts.gatedOut)
 * @returns {Array} PDF rows { entityId, campaign, verdict, rationale, spend, roas, ctr, currency, impact, needsRevenue }
 */
export function buildPdfCampaigns({
  connectorCampaigns = [],
  verdictByEntityId = {},
  verdictInfoByEntityId = {},
  impactByEntityId = {},
  gatedOutIds = new Set(),
} = {}) {
  return connectorCampaigns.map((c) => {
    const gated = gatedOutIds.has(c.entityId);
    return {
      entityId:  c.entityId,
      campaign:  c.name,
      // Gated rows are never scored → no verdict; a scored row gets the engine's.
      verdict:   gated ? null : (verdictByEntityId[c.entityId] ?? null),
      rationale: gated
        ? 'Add revenue data to unlock verdict'
        : (verdictInfoByEntityId[c.entityId]?.rationale ?? null),
      // Minor → major via the currency's real exponent; null stays null ("—").
      spend:     c.spendMinor != null ? fromMinor(c.spendMinor, c.currency || 'USD') : null,
      roas:      c.roas ?? null,
      ctr:       c.ctr != null ? c.ctr * 100 : null, // fraction → percentage
      currency:  c.currency || 'USD',
      impact:    impactByEntityId[c.entityId] ?? null,
      needsRevenue: gated,
    };
  });
}
