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

function validate(channels, model) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('attributeCredit: channels must be a non-empty array');
  }
  if (!Object.values(ATTRIBUTION_MODEL).includes(model)) {
    throw new Error(`attributeCredit: model must be one of ${Object.values(ATTRIBUTION_MODEL).join(', ')}`);
  }
}

const round = (n) => Math.round(n);

/** LAST_TOUCH: each channel keeps its own platform-reported conversions/revenue. */
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

/** Per-conversion credit weights for a path of length n under a model. */
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
 * Path-based redistribution. Honest by construction: with no paths we return
 * INSUFFICIENT_DATA rather than invent journey credit.
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
 * INCREMENTALITY_WEIGHTED — the only causal model. Credit = measured
 * incremental conversions per channel (from concluded holdouts). Channels
 * with no test fall back to last-click but flagged LOW + "not proven causal".
 * Explicitly NOT Google path-based DDA.
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
 * Assign attribution credit per channel under a model — honestly.
 *
 * @param {object} args
 * @param {Array<{channelId, channel?, conversions?, platformRevenueMinor?, blendedRevenueMinor?, spendMinor?, currency?}>} args.channels
 * @param {string} args.model — ATTRIBUTION_MODEL value
 * @param {Array<{conversionId, channel, touchPosition, occurredAt?}>} [args.paths] — PathTouch rows (empty ⇒ path models dark)
 * @param {Object<string,{incrementalConversions, confidenceLabel?, ciLow?, ciHigh?}>} [args.incrementality] — by channelId
 * @param {{aovMinor:number}} [args.economics]
 * @returns {{ model, status, channels?, totalRevenueMinor?, caveat?, reason? }}
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
