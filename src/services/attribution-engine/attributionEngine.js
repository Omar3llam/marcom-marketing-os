// ============================================================
// AttributionEngine — honest credit assignment (no invented numbers)
// ============================================================
// Public API: attributeCredit({ channels, model, paths, incrementality, economics, now })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no LLM, no DB, no timestamps
//   (`now` reserved). Mirrors the other deterministic engines.
//
// ISOLATION CONTRACT:
//   AttributionService loads blended truth + PathTouch rows + concluded
//   IncrementalityTests + economics and feeds this engine; nothing here
//   reads the DB.
//
// THE GUARD (the design's first principle):
//   Every output figure is an `attributed()` wrapper — value + source +
//   confidence — never a bare number. And we REFUSE to fabricate: the
//   path-based models (FIRST/LINEAR/POSITION) return INSUFFICIENT_DATA when
//   no path data is connected, rather than inventing journey credit. The
//   only causal model is INCREMENTALITY_WEIGHTED (measured holdout lift);
//   it is explicitly NOT Google-style path-based DDA.
// ============================================================
import { logger } from '../../utils/logger.js';
import {
  ATTRIBUTION_MODEL, ATTRIBUTION_SOURCE, CONFIDENCE_LEVEL, ATTRIBUTION_STATUS,
  POSITION_WEIGHTS, MODEL_CAVEAT, attributed,
} from './attributionTypes.js';

const PATH_MODELS = new Set([ATTRIBUTION_MODEL.FIRST_TOUCH, ATTRIBUTION_MODEL.LINEAR, ATTRIBUTION_MODEL.POSITION_BASED]);

/**
 * Validate that `channels` is a non-empty array and that `model` is a supported attribution model.
 * @param {Array} channels - Array of channel rows; must contain at least one element.
 * @param {string} model - One of the values in `ATTRIBUTION_MODEL`.
 * @throws {Error} If `channels` is not a non-empty array or `model` is not a valid `ATTRIBUTION_MODEL` value.
 */
function validate(channels, model) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('attributeCredit: channels must be a non-empty array');
  }
  if (!Object.values(ATTRIBUTION_MODEL).includes(model)) {
    throw new Error(`attributeCredit: model must be one of ${Object.values(ATTRIBUTION_MODEL).join(', ')}`);
  }
}

const round = (n) => Math.round(n);

/**
 * Assigns each channel its platform-reported conversions and platform revenue without redistributing or modelling credit.
 *
 * @param {Array<Object>} channels - Array of channel records; each item may include `channelId`, `channel`, `conversions`, and `platformRevenueMinor`.
 * @returns {{channels: Array<Object>, totalRevenueMinor: Object, caveat: string}} An object containing per-channel attributed rows, `totalRevenueMinor` as an attributed value sourced from the platform, and the model caveat `MODEL_CAVEAT.LAST_TOUCH`.
 */
function lastTouch(channels) {
  const rows = channels.map((c) => ({
    channelId: c.channelId,
    channel:   c.channel ?? null,
    creditedConversions:  attributed(c.conversions ?? 0, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.MEDIUM, { caveat: MODEL_CAVEAT.LAST_TOUCH }),
    creditedRevenueMinor: attributed(c.platformRevenueMinor ?? 0, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.MEDIUM, { caveat: MODEL_CAVEAT.LAST_TOUCH }),
  }));
  const total = channels.reduce((s, c) => s + (c.platformRevenueMinor ?? 0), 0);
  return {
    channels: rows,
    totalRevenueMinor: attributed(total, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.MEDIUM, { caveat: MODEL_CAVEAT.LAST_TOUCH }),
    caveat: MODEL_CAVEAT.LAST_TOUCH,
  };
}

/**
 * Compute per-touch attribution weights for a path of length `n` under the specified model.
 * @param {number} n - Number of touches in the path.
 * @param {string} model - Attribution model (e.g. ATTRIBUTION_MODEL.FIRST_TOUCH, ATTRIBUTION_MODEL.LINEAR, ATTRIBUTION_MODEL.POSITION_BASED).
 * @returns {number[]} An array of `n` non-negative weights that sum to 1 (returns `[]` when `n === 0`). For `FIRST_TOUCH` the first touch gets full weight; for `LINEAR` weights are uniform; for `POSITION_BASED` returns `[1]` when `n === 1`, `[0.5, 0.5]` when `n === 2`, and for `n > 2` returns a U-shaped split where first and last weights are 0.4 each and the remaining 0.2 is distributed equally across middle touches.
 */
function pathWeights(n, model) {
  if (n === 0) return [];
  if (model === ATTRIBUTION_MODEL.FIRST_TOUCH) return [1, ...Array(n - 1).fill(0)];
  if (model === ATTRIBUTION_MODEL.LINEAR)      return Array(n).fill(1 / n);
  // POSITION_BASED (U-shaped): 40 first / 40 last / 20 split across middle.
  if (n === 1) return [1];
  if (n === 2) return [0.5, 0.5];
  const mid = (POSITION_WEIGHTS.middle) / (n - 2);
  return [POSITION_WEIGHTS.first, ...Array(n - 2).fill(mid), POSITION_WEIGHTS.last];
}

/**
 * Compute path-based attribution credits per channel using provided journey touches and economic AOV.
 *
 * Processes touches grouped by conversion, applies per-touch weights for the selected path model, and produces
 * per-channel credited conversions and credited revenue (in minor units) along with a total revenue figure.
 *
 * @param {Array<Object>} channels - Channel rows to return in the result; each item must include `channelId`.
 * @param {string} model - Attribution model name (one of the path-based models: FIRST_TOUCH, LINEAR, POSITION_BASED).
 * @param {Array<Object>} paths - Array of touch records representing journey touches (grouped by `conversionId` and ordered by `touchPosition`); when not an array or empty, the function returns an INSUFFICIENT_DATA result and does not fabricate journey credit.
 * @param {Object} economics - Economics options; `economics.aovMinor` (number) is used as the per-conversion revenue.
 * @returns {Object} Result object. If `paths` is missing or empty, returns `{ status: ATTRIBUTION_STATUS.INSUFFICIENT_DATA, model, reason }`. Otherwise returns `{ status: ATTRIBUTION_STATUS.OK, channels, totalRevenueMinor, caveat }` where each channel row contains `creditedConversions` and `creditedRevenueMinor` (values wrapped with `attributed(...)` using `ATTRIBUTION_SOURCE.MODEL`, `CONFIDENCE_LEVEL.LOW`, and a `MODEL_CAVEAT.RULES_BASED` metadata) and `totalRevenueMinor` is the summed credited revenue (also wrapped with the same attribution metadata).
 */
function pathBased(channels, model, paths, economics) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { status: ATTRIBUTION_STATUS.INSUFFICIENT_DATA, model, reason: 'no path data connected — connect a journey source to compute this model' };
  }
  const aov = economics?.aovMinor ?? 0;

  // Group touches into ordered per-conversion paths.
  const byConv = new Map();
  for (const t of paths) {
    if (!byConv.has(t.conversionId)) byConv.set(t.conversionId, []);
    byConv.get(t.conversionId).push(t);
  }
  const creditConv = new Map();
  const creditRev  = new Map();
  for (const [, touches] of byConv) {
    const ordered = [...touches].sort((a, b) => (a.touchPosition ?? 0) - (b.touchPosition ?? 0));
    const w = pathWeights(ordered.length, model);
    ordered.forEach((t, i) => {
      creditConv.set(t.channel, (creditConv.get(t.channel) ?? 0) + w[i]);
      creditRev.set(t.channel,  (creditRev.get(t.channel)  ?? 0) + w[i] * aov);
    });
  }

  const rows = channels.map((c) => ({
    channelId: c.channelId,
    channel:   c.channel ?? null,
    creditedConversions:  attributed(round((creditConv.get(c.channelId) ?? 0) * 100) / 100, ATTRIBUTION_SOURCE.MODEL, CONFIDENCE_LEVEL.LOW, { modelName: model, caveat: MODEL_CAVEAT.RULES_BASED }),
    creditedRevenueMinor: attributed(round(creditRev.get(c.channelId) ?? 0), ATTRIBUTION_SOURCE.MODEL, CONFIDENCE_LEVEL.LOW, { modelName: model, caveat: MODEL_CAVEAT.RULES_BASED }),
  }));
  const total = rows.reduce((s, r) => s + (r.creditedRevenueMinor.value ?? 0), 0);
  return {
    status: ATTRIBUTION_STATUS.OK,
    channels: rows,
    totalRevenueMinor: attributed(total, ATTRIBUTION_SOURCE.MODEL, CONFIDENCE_LEVEL.LOW, { modelName: model, caveat: MODEL_CAVEAT.RULES_BASED }),
    caveat: MODEL_CAVEAT.RULES_BASED,
  };
}

/**
 * Assigns credited conversions and revenue per channel using measured holdout incrementality when available, otherwise falls back to platform-reported values flagged as not causal.
 *
 * @param {Array<Object>} channels - Channel rows; each should include at least `channelId` and may include `conversions` and `platformRevenueMinor`.
 * @param {Object<string,Object>} incrementality - Map from `channelId` to holdout results; each value may contain `incrementalConversions` (number), optional `ciLow` and `ciHigh` (numbers), and optional `confidenceLabel`.
 * @param {Object} economics - Economics options; `aovMinor` (number) is used to convert incremental conversions to revenue.
 * @returns {Object} An attribution result object containing:
 *  - `status`: `ATTRIBUTION_STATUS.OK`,
 *  - `channels`: array of rows where each row includes `creditedConversions` and `creditedRevenueMinor` wrapped with attribution metadata,
 *  - `totalRevenueMinor`: attributed sum of credited revenue,
 *  - `caveat`: `MODEL_CAVEAT.INCREMENTALITY_WEIGHTED`.
 */
function incrementalityWeighted(channels, incrementality, economics) {
  const aov = economics?.aovMinor ?? 0;
  const inc = incrementality ?? {};
  const rows = channels.map((c) => {
    const t = inc[c.channelId];
    if (t && typeof t.incrementalConversions === 'number') {
      const rev = round(t.incrementalConversions * aov);
      const band = (typeof t.ciLow === 'number' && typeof t.ciHigh === 'number') ? [t.ciLow, t.ciHigh] : null;
      return {
        channelId: c.channelId, channel: c.channel ?? null,
        creditedConversions:  attributed(round(t.incrementalConversions), ATTRIBUTION_SOURCE.INCREMENTALITY, t.confidenceLabel ?? CONFIDENCE_LEVEL.MEDIUM, { modelName: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED, band, caveat: MODEL_CAVEAT.INCREMENTALITY_WEIGHTED }),
        creditedRevenueMinor: attributed(rev, ATTRIBUTION_SOURCE.INCREMENTALITY, t.confidenceLabel ?? CONFIDENCE_LEVEL.MEDIUM, { modelName: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED, caveat: MODEL_CAVEAT.INCREMENTALITY_WEIGHTED }),
      };
    }
    // No holdout — honest fallback to claimed, flagged LOW.
    return {
      channelId: c.channelId, channel: c.channel ?? null,
      creditedConversions:  attributed(c.conversions ?? 0, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.LOW, { caveat: MODEL_CAVEAT.NO_HOLDOUT }),
      creditedRevenueMinor: attributed(c.platformRevenueMinor ?? 0, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.LOW, { caveat: MODEL_CAVEAT.NO_HOLDOUT }),
    };
  });
  const total = rows.reduce((s, r) => s + (r.creditedRevenueMinor.value ?? 0), 0);
  const anyCausal = rows.some((r) => r.creditedRevenueMinor.source === ATTRIBUTION_SOURCE.INCREMENTALITY);
  return {
    status: ATTRIBUTION_STATUS.OK,
    channels: rows,
    totalRevenueMinor: attributed(total, anyCausal ? ATTRIBUTION_SOURCE.INCREMENTALITY : ATTRIBUTION_SOURCE.PLATFORM, anyCausal ? CONFIDENCE_LEVEL.MEDIUM : CONFIDENCE_LEVEL.LOW, { modelName: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED, caveat: MODEL_CAVEAT.INCREMENTALITY_WEIGHTED }),
    caveat: MODEL_CAVEAT.INCREMENTALITY_WEIGHTED,
  };
}

/**
 * Compute per-channel attribution and totals using the specified attribution model.
 *
 * Processes input channels with one of three strategies:
 * - last-touch: uses platform-reported conversions/revenue per channel,
 * - path-based (FIRST_TOUCH, LINEAR, POSITION_BASED): distributes conversion and revenue credit across connected path touches and returns INSUFFICIENT_DATA when path rows are missing,
 * - incrementality-weighted: uses holdout incremental measurements when available and falls back to platform values otherwise.
 *
 * @param {object} args - Function arguments.
 * @param {Array<{channelId: string, channel?: string, conversions?: number, platformRevenueMinor?: number, blendedRevenueMinor?: number, spendMinor?: number, currency?: string}>} args.channels - Channel rows to attribute; must be a non-empty array.
 * @param {string} args.model - One of ATTRIBUTION_MODEL values determining the attribution strategy.
 * @param {Array<{conversionId: string, channel: string, touchPosition?: number, occurredAt?: string}>} [args.paths] - Path touch rows; when empty or missing, path-based models return INSUFFICIENT_DATA rather than inventing journey credit.
 * @param {Object<string,{incrementalConversions?: number, confidenceLabel?: string, ciLow?: number, ciHigh?: number}>} [args.incrementality] - Incrementality results keyed by channelId used by the incrementality-weighted model.
 * @param {{aovMinor?: number}} [args.economics] - Economic inputs (average order value in minor units) used to convert conversion credit into revenue.
 * @param {*} [args.now] - Ignored; present to enforce deterministic call signatures.
 * @returns {{ model: string, status: string, channels?: Array, totalRevenueMinor?: Object, caveat?: string, reason?: string }} An object containing the requested model, attribution status, per-channel rows and a wrapped totalRevenueMinor when available; when path-based models lack path rows, returns status INSUFFICIENT_DATA and a human-readable reason.
 */
export function attributeCredit({ channels, model, paths = [], incrementality = {}, economics = {}, now } = {}) {
  validate(channels, model);
  void now;

  let result;
  if (model === ATTRIBUTION_MODEL.LAST_TOUCH) {
    result = { status: ATTRIBUTION_STATUS.OK, ...lastTouch(channels) };
  } else if (PATH_MODELS.has(model)) {
    result = pathBased(channels, model, paths, economics);
  } else { // INCREMENTALITY_WEIGHTED
    result = incrementalityWeighted(channels, incrementality, economics);
  }

  logger.debug({ model, status: result.status }, '[AttributionEngine] attributed');
  return { model, ...result };
}
