// ============================================================
// MARCOM / Lumi — DecisionContract validator
// ------------------------------------------------------------
// JS port of the spec's TypeScript types — JSDoc carries the
// shape, validateDecisionContract enforces it at the API
// boundary so the SUCCESS view never receives a malformed payload.
// ============================================================

/**
 * @typedef {'KILL' | 'SCALE' | 'HOLD' | 'OPTIMIZE'} DecisionVerdict
 * @typedef {'campaign' | 'strategy' | 'content'}    DecisionMode
 * @typedef {'High' | 'Medium' | 'Low'}              RiskLevel
 *
 * @typedef {Object} CampaignRow
 * @property {string} name
 * @property {number} spend
 * @property {number} ctr
 * @property {number} roas
 * @property {number} frequency
 * @property {DecisionVerdict} verdict
 * @property {number} impactScore
 * @property {string} reasoning
 *
 * @typedef {Object} ContentRewrite
 * @property {string}   original
 * @property {number}   score
 * @property {string[]} issues
 * @property {string}   rewrite
 * @property {string}   platformNotes
 *
 * @typedef {Object} CreativeVariant
 * @property {string} angle_name
 * @property {string} primary_text
 * @property {string} headline
 * @property {string} description
 * @property {string} visual_direction
 * @property {string} platform_notes
 *
 * @typedef {Object} CreativeAssets
 * @property {string} creative_strategy_rationale
 * @property {CreativeVariant[]} variants
 *
 * @typedef {Object} DecisionContract
 * @property {string}          id
 * @property {DecisionMode}    mode
 * @property {string}          title
 * @property {DecisionVerdict} verdict
 * @property {number}          confidence       // 0-100
 * @property {RiskLevel}       riskLevel
 * @property {string}          financialImpact
 * @property {string[]}        whyBreakdown
 * @property {string}          actionLabel
 * @property {{ campaignTable?: CampaignRow[], strategyMarkdown?: string,
 *              contentRewrite?: ContentRewrite, creativeAssets?: CreativeAssets|null }} modeSpecificData
 * @property {string}          timestamp        // ISO 8601
 * @property {Array<'claude'|'openai'>} agentsUsed
 */

const REQUIRED = [
  'id', 'mode', 'title', 'verdict', 'confidence',
  'riskLevel', 'financialImpact', 'whyBreakdown',
  'actionLabel', 'modeSpecificData', 'timestamp',
];

/** @returns {DecisionContract} — throws on invalid input. */
export function validateDecisionContract(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('API returned non-object response');
  }
  const missing = REQUIRED.filter((k) => !(k in data));
  if (missing.length > 0) {
    throw new Error(`DecisionContract missing fields: ${missing.join(', ')}`);
  }
  if (!Array.isArray(data.whyBreakdown)) {
    throw new Error('whyBreakdown must be an array');
  }
  return data;
}
