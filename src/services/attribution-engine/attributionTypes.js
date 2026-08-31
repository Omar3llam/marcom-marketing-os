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
  // B5-01T′: no source at all. The read that would have established one failed,
  // so there is nothing to name. NOT a weak source — the absence of one.
  UNAVAILABLE:   'UNAVAILABLE',
});

// The second half — how much to trust it.
//
// UNKNOWN is not a fourth grade below LOW. LOW says "we have a number and you
// should lean on it lightly"; UNKNOWN says "we have no number". Collapsing them
// would put an outage on the same axis as weak evidence (B5-01T′ · I5).
export const CONFIDENCE_LEVEL = Object.freeze({
  LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', UNKNOWN: 'UNKNOWN',
});

// The three states this result can be in, kept apart on purpose (B5-01T′),
// following the MEMORY_STATUS precedent in pattern-engine/institutionalMemory.js:
//   OK                   — we looked, and here is the answer
//   INSUFFICIENT_DATA    — we looked; this account does not have what the model needs
//   EVIDENCE_UNAVAILABLE — we could not look
// The middle one is a statement about the ACCOUNT. The last is a statement about
// US, and reporting it as the middle one is the defect this slice closes.
export const ATTRIBUTION_STATUS = Object.freeze({
  OK: 'OK',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  EVIDENCE_UNAVAILABLE: 'EVIDENCE_UNAVAILABLE',
});

/** Per-source evidence health, carried alongside the result. */
export const EVIDENCE_STATUS = Object.freeze({ OK: 'OK', UNAVAILABLE: 'UNAVAILABLE' });

/** WHICH read failed — named, because "attribution unavailable" pointed at the
 *  wrong half of the problem is worse than silence. */
export const EVIDENCE_REASON = Object.freeze({
  CONVERSIONS:    'CONVERSION_EVIDENCE_UNAVAILABLE',
  INCREMENTALITY: 'INCREMENTALITY_EVIDENCE_UNAVAILABLE',
  PATHS:          'PATH_EVIDENCE_UNAVAILABLE',
});

/**
 * The refusal a DECISION path raises when the evidence it was asked to reason
 * from could not be read (B5-01T′ · I4). Reporting may degrade; a budget move
 * may not. Machine-readable so the boundary can name it rather than flattening
 * it into a generic failure.
 */
export class AttributionEvidenceUnavailableError extends Error {
  constructor(reason, message) {
    super(message ?? `attribution evidence unavailable: ${reason}`);
    this.name = 'AttributionEvidenceUnavailableError';
    this.code = 'ATTRIBUTION_EVIDENCE_UNAVAILABLE';
    this.reason = reason;
  }
}

// Position-based (U-shaped) credit split: first + last get the lion's share.
export const POSITION_WEIGHTS = Object.freeze({ first: 0.4, last: 0.4, middle: 0.2 });

// Caveats stated on every model's output — uncertainty labelled everywhere.
export const MODEL_CAVEAT = Object.freeze({
  LAST_TOUCH:  'last-click — ignores assisting touches',
  RULES_BASED: 'rules-based redistribution, NOT causal',
  INCREMENTALITY_WEIGHTED: 'causal, weighted by measured holdout lift — NOT Google-style DDA / path-based',
  NO_HOLDOUT:  'no holdout test on this channel — claimed, not proven causal',
  // B5-01T′ · I6. The one above is a finding; this one is an outage. "No holdout
  // test on this channel" asserts we looked and there was none — a claim a failed
  // read never earns.
  HOLDOUT_UNAVAILABLE: 'holdout evidence could not be read — causality unknown, not disproven',
  CONVERSIONS_UNAVAILABLE: 'conversion evidence could not be read',
});

/**
 * THE HONESTY PRIMITIVE. No revenue/efficiency value leaves an engine as a
 * bare number — it is wrapped with where it came from and how much to trust
 * it. `band` optionally carries a confidence interval [lo, hi].
 *
 * `status`/`reason` default to OK/null, so every existing call site keeps its
 * exact meaning and its exact shape gains two honest fields rather than a new
 * parallel wrapper (B5-01T′).
 */
export function attributed(value, source, confidence, {
  modelName = null, band = null, caveat = null,
  status = EVIDENCE_STATUS.OK, reason = null,
} = {}) {
  return { value: value == null ? null : value, source, confidence, modelName, band, caveat, status, reason };
}

/**
 * The unavailable figure: no value, no source, no confidence, and a reason that
 * names which read failed.
 *
 * This exists so the three fields that must NOT lie cannot be filled in by hand
 * at a call site. A `0` labelled PLATFORM/MEDIUM was the B5-01T finding; it is
 * now impossible to write by accident because the honest form is one call.
 */
export function unavailable(reason, { caveat = null, modelName = null } = {}) {
  return attributed(null, ATTRIBUTION_SOURCE.UNAVAILABLE, CONFIDENCE_LEVEL.UNKNOWN, {
    modelName, caveat, status: EVIDENCE_STATUS.UNAVAILABLE, reason,
  });
}
