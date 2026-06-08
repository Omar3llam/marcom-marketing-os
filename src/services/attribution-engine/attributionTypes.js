// ============================================================
// Attribution engine — shared types + the honesty primitive
// ============================================================
// Sibling module so services/routes/contracts import the enums + the
// Attributed wrapper without pulling the engine (ESM link hygiene —
// the Phase-5 lesson).
// ============================================================

// The attribution models. Note what is DELIBERATELY absent: a `DATA_DRIVEN`
// id. Market "data-driven attribution (DDA)" means Google's path-based
// Shapley/Markov over user journeys — which we cannot compute honestly (no
// path data). Our causal model is INCREMENTALITY_WEIGHTED: credit weighted
// by MEASURED holdout lift. Calling it DATA_DRIVEN would itself be a quiet
// lie, so we don't.
export const ATTRIBUTION_MODEL = Object.freeze({
  FIRST_TOUCH:            'FIRST_TOUCH',
  LAST_TOUCH:             'LAST_TOUCH',
  LINEAR:                 'LINEAR',
  POSITION_BASED:         'POSITION_BASED',
  INCREMENTALITY_WEIGHTED: 'INCREMENTALITY_WEIGHTED',
});

// Where a number came from — the first half of the honesty contract.
export const ATTRIBUTION_SOURCE = Object.freeze({
  PLATFORM:      'PLATFORM',      // last-click, as the ad platform reported it
  BLENDED:       'BLENDED',       // P3 blended truth (GA4/Shopify reconciled)
  MODEL:         'MODEL',         // a rules-based redistribution — NOT causal
  INCREMENTALITY: 'INCREMENTALITY', // measured holdout lift — the only causal source
});

// The second half — how much to trust it.
export const CONFIDENCE_LEVEL = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });

export const ATTRIBUTION_STATUS = Object.freeze({ OK: 'OK', INSUFFICIENT_DATA: 'INSUFFICIENT_DATA' });

// Position-based (U-shaped) credit split: first + last get the lion's share.
export const POSITION_WEIGHTS = Object.freeze({ first: 0.4, last: 0.4, middle: 0.2 });

// Caveats stated on every model's output — uncertainty labelled everywhere.
export const MODEL_CAVEAT = Object.freeze({
  LAST_TOUCH:  'last-click — ignores assisting touches',
  RULES_BASED: 'rules-based redistribution, NOT causal',
  INCREMENTALITY_WEIGHTED: 'causal, weighted by measured holdout lift — NOT Google-style DDA / path-based',
  NO_HOLDOUT:  'no holdout test on this channel — claimed, not proven causal',
});

/**
 * Wraps a numeric attribution value with provenance and trust metadata.
 *
 * @param {?number} value - Numeric value to attribute; normalized to `null` if `null` or `undefined`.
 * @param {string} source - Origin of the value (use values from `ATTRIBUTION_SOURCE`).
 * @param {string} confidence - Confidence level for the value (use values from `CONFIDENCE_LEVEL`).
 * @param {Object} [opts] - Optional metadata.
 * @param {?string} [opts.modelName=null] - Attribution model name (use values from `ATTRIBUTION_MODEL`) or `null`.
 * @param {?[number,number]} [opts.band=null] - Optional confidence interval expressed as `[lo, hi]`, or `null`.
 * @param {?string} [opts.caveat=null] - Optional human-readable caveat explaining limitations, or `null`.
 * @returns {{value: number|null, source: string, confidence: string, modelName: string|null, band: [number,number]|null, caveat: string|null}} An object containing the normalized value and its provenance/trust metadata.
 */
export function attributed(value, source, confidence, { modelName = null, band = null, caveat = null } = {}) {
  return { value: value == null ? null : value, source, confidence, modelName, band, caveat };
}
