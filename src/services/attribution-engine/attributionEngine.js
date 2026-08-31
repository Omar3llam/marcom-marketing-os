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
  POSITION_WEIGHTS, MODEL_CAVEAT, EVIDENCE_STATUS, EVIDENCE_REASON,
  attributed, unavailable,
} from './attributionTypes.js';

const PATH_MODELS = new Set([ATTRIBUTION_MODEL.FIRST_TOUCH, ATTRIBUTION_MODEL.LINEAR, ATTRIBUTION_MODEL.POSITION_BASED]);

/**
 * Per-source evidence health (B5-01T′). Every field defaults to OK, so a caller
 * that does not pass `evidence` gets exactly the pre-slice behaviour — which is
 * correct, because a caller that never had a failed read never had one to report.
 *
 * THE WHOLE POINT OF THIS PARAMETER: `paths: []` and "the PathTouch read threw"
 * arrive at this engine as the same empty array. They are different facts and
 * only the SERVICE knows which one happened, so the service has to say.
 */
const EVIDENCE_OK = Object.freeze({
  conversions:    EVIDENCE_STATUS.OK,
  incrementality: EVIDENCE_STATUS.OK,
  paths:          EVIDENCE_STATUS.OK,
});
const isDown = (evidence, key) => evidence?.[key] === EVIDENCE_STATUS.UNAVAILABLE;

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
function lastTouch(channels, evidence) {
  // B5-01T′ · I2/I3. When the conversion read failed there is no platform zero
  // to report — the platform reported nothing. Revenue is untouched: it comes
  // from blended truth, which propagates its own failures and did not fail here.
  const conversionsDown = isDown(evidence, 'conversions');
  const rows = channels.map((c) => ({
    channelId: c.channelId,
    channel:   c.channel ?? null,
    creditedConversions: conversionsDown
      ? unavailable(EVIDENCE_REASON.CONVERSIONS, { caveat: MODEL_CAVEAT.CONVERSIONS_UNAVAILABLE })
      : attributed(c.conversions ?? 0, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.MEDIUM, { caveat: MODEL_CAVEAT.LAST_TOUCH }),
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
function pathBased(channels, model, paths, economics, evidence) {
  // B5-01T′ · I6/T4. ORDER MATTERS, and this is the whole fix: the unavailable
  // check comes FIRST, because a failed PathTouch read also arrives here as an
  // empty array. Falling through to the line below would tell an operator to go
  // connect a journey source they may already have connected — an outage
  // rendered as an onboarding prompt, with a call to action attached.
  if (isDown(evidence, 'paths')) {
    return { status: ATTRIBUTION_STATUS.EVIDENCE_UNAVAILABLE, model, reason: EVIDENCE_REASON.PATHS };
  }
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
function incrementalityWeighted(channels, incrementality, economics, evidence) {
  const aov = economics?.aovMinor ?? 0;
  const inc = incrementality ?? {};
  // B5-01T′. Two INDEPENDENT reads feed this model and they fail independently,
  // so they are answered independently rather than blanking the whole row:
  //
  //   holdout read down    → the channel's causal status is UNKNOWN. The claimed
  //                          number is still real, so it is still reported as
  //                          PLATFORM/LOW — what changes is the caveat, which may
  //                          no longer assert that no holdout exists (I6).
  //   conversion read down → there is no conversion number at all (I2).
  const holdoutDown     = isDown(evidence, 'incrementality');
  const conversionsDown = isDown(evidence, 'conversions');
  const rows = channels.map((c) => {
    const t = holdoutDown ? undefined : inc[c.channelId];
    if (t && typeof t.incrementalConversions === 'number') {
      const rev = round(t.incrementalConversions * aov);
      const band = (typeof t.ciLow === 'number' && typeof t.ciHigh === 'number') ? [t.ciLow, t.ciHigh] : null;
      return {
        channelId: c.channelId, channel: c.channel ?? null,
        creditedConversions:  attributed(round(t.incrementalConversions), ATTRIBUTION_SOURCE.INCREMENTALITY, t.confidenceLabel ?? CONFIDENCE_LEVEL.MEDIUM, { modelName: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED, band, caveat: MODEL_CAVEAT.INCREMENTALITY_WEIGHTED }),
        creditedRevenueMinor: attributed(rev, ATTRIBUTION_SOURCE.INCREMENTALITY, t.confidenceLabel ?? CONFIDENCE_LEVEL.MEDIUM, { modelName: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED, caveat: MODEL_CAVEAT.INCREMENTALITY_WEIGHTED }),
      };
    }
    // No holdout — honest fallback to claimed, flagged LOW. The caveat states
    // WHY there is no causal number, and the two whys are not the same fact.
    const caveat = holdoutDown ? MODEL_CAVEAT.HOLDOUT_UNAVAILABLE : MODEL_CAVEAT.NO_HOLDOUT;
    return {
      channelId: c.channelId, channel: c.channel ?? null,
      creditedConversions: conversionsDown
        ? unavailable(EVIDENCE_REASON.CONVERSIONS, { caveat: MODEL_CAVEAT.CONVERSIONS_UNAVAILABLE })
        : attributed(c.conversions ?? 0, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.LOW, { caveat }),
      creditedRevenueMinor: attributed(c.platformRevenueMinor ?? 0, ATTRIBUTION_SOURCE.PLATFORM, CONFIDENCE_LEVEL.LOW, { caveat }),
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
export function attributeCredit({
  channels, model, paths = [], incrementality = {}, economics = {}, evidence = EVIDENCE_OK, now,
} = {}) {
  validate(channels, model);
  void now;

  const ev = { ...EVIDENCE_OK, ...(evidence ?? {}) };

  let result;
  if (model === ATTRIBUTION_MODEL.LAST_TOUCH) {
    result = { status: ATTRIBUTION_STATUS.OK, ...lastTouch(channels, ev) };
  } else if (PATH_MODELS.has(model)) {
    result = pathBased(channels, model, paths, economics, ev);
  } else { // INCREMENTALITY_WEIGHTED
    result = incrementalityWeighted(channels, incrementality, economics, ev);
  }

  // B5-01T′ · §8 — the response must not LOOK complete. A caller that reads only
  // `status` must be able to tell that something could not be read, without
  // walking every channel; `evidence` then says which read it was.
  //
  // This DOWNGRADES OK, and never upgrades: a path model that is already
  // INSUFFICIENT_DATA or EVIDENCE_UNAVAILABLE keeps the more specific answer it
  // computed, because "we could not read paths" is more useful than "something
  // somewhere was unavailable".
  const anyDown = Object.values(ev).some((s) => s === EVIDENCE_STATUS.UNAVAILABLE);
  if (anyDown && result.status === ATTRIBUTION_STATUS.OK) {
    result = { ...result, status: ATTRIBUTION_STATUS.EVIDENCE_UNAVAILABLE };
  }

  logger.debug({ model, status: result.status, evidence: ev }, '[AttributionEngine] attributed');
  return { model, ...result, evidence: ev };
}
