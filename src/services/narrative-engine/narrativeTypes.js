// ============================================================
// Narrative engine — shared types + the honesty primitive
// ============================================================
// Sibling module so services/routes/contracts import the enums + the
// evidence-bound figure helpers without pulling the engine (ESM link
// hygiene — the Phase-5 lesson).
//
// THE GUARD (the design's first principle):
//   A Marketing OS reporting layer drifts into "a weaker Looker" the moment
//   it shows a number it can't defend. So Phase 8's honesty primitive is the
//   EVIDENCE-BOUND FIGURE: every number in a narrative is { value, unit,
//   evidenceRef } where evidenceRef is the id of a REAL row. `figure()` THROWS
//   if asked to emit a number without one — "zero hallucinated numbers"
//   becomes structural, not aspirational. No LLM ever touches these numbers.
// ============================================================

export const NARRATIVE_PERIOD = Object.freeze({ WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' });

export const NARRATIVE_AUDIENCE = Object.freeze({
  STRATEGIST: 'STRATEGIST',
  BUYER:      'BUYER',
  LEADERSHIP: 'LEADERSHIP',
});

// What kind of real row backs a figure — so a reader can trace it home.
export const EVIDENCE_KIND = Object.freeze({
  DECISION:       'DECISION',
  OUTCOME:        'OUTCOME',
  ALLOCATION:     'ALLOCATION',
  INCREMENTALITY: 'INCREMENTALITY',
  GOAL:           'GOAL',
  BLENDED:        'BLENDED',
});

// The narrative's sections, in reading order.
export const SECTION = Object.freeze({
  DID:       'DID',       // what we did
  ALLOCATED: 'ALLOCATED', // where the money went
  CHANGED:   'CHANGED',   // what it changed (blended truth)
  PROVED:    'PROVED',    // what we proved (incrementality — the only causal claims)
  GOAL:      'GOAL',      // against the north-star
});

export const SECTION_TITLE = Object.freeze({
  DID:       'What we did',
  ALLOCATED: 'Where it went',
  CHANGED:   'What it changed',
  PROVED:    'What we proved',
  GOAL:      'Against the goal',
});

// Which sections each audience sees. LEADERSHIP gets the outcome story but
// not per-entity execution minutiae (claims tagged tier:'detail' are dropped)
// and no unproven claims (proven:false dropped). BUYER is execution-focused.
export const SECTION_BY_AUDIENCE = Object.freeze({
  STRATEGIST: [SECTION.DID, SECTION.ALLOCATED, SECTION.CHANGED, SECTION.PROVED, SECTION.GOAL],
  LEADERSHIP: [SECTION.DID, SECTION.ALLOCATED, SECTION.CHANGED, SECTION.PROVED, SECTION.GOAL],
  BUYER:      [SECTION.DID, SECTION.ALLOCATED],
});

/**
 * THE HONESTY PRIMITIVE. No number appears in a narrative as a bare value —
 * it is bound to the real row it came from. THROWS if evidenceRef is missing,
 * so a hallucinated figure cannot be constructed in the first place.
 *
 * @param {number} value
 * @param {string} unit — e.g. 'EGP', '%', 'x', 'count'
 * @param {string} evidenceRef — id of a real Decision/Outcome/AllocationPlan/
 *                 IncrementalityTest/NorthStarGoal/blended-channel row
 * @param {{kind?:string}} [opts]
 */
export function figure(value, unit, evidenceRef, { kind = null } = {}) {
  if (evidenceRef == null || evidenceRef === '') {
    throw new Error('figure: every narrative number must carry an evidenceRef (a real row id) — refusing to emit a hallucinated figure');
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error('figure: value must be a finite number');
  }
  return { value, unit, evidenceRef, kind };
}

/**
 * A sentence + the figures it cites. `tier` is 'exec' (leadership-safe) or
 * 'detail' (execution minutiae, dropped for leadership); `proven` gates
 * causal claims for leadership.
 */
export function claim(text, figures = [], { tier = 'exec', proven = true } = {}) {
  return { text, figures, tier, proven };
}

// Report-confidence bands — the label a CEO reads next to the score.
export const CONFIDENCE_BANDS = Object.freeze({ HIGH: 80, MODERATE: 55 });

// How the four coverage signals weight into one report-confidence score.
// Causal (incrementality) and memory coverage carry the most — they are what
// make the reasoning defensible. Sums to 1.0.
export const CONFIDENCE_WEIGHTS = Object.freeze({
  memoryCoverage:         0.30,
  incrementalityCoverage: 0.30,
  blendedConfidence:      0.25,
  attributionConfidence:  0.15,
});

const clamp01 = (n) => (typeof n === 'number' && !Number.isNaN(n) ? Math.max(0, Math.min(1, n)) : 0);

/**
 * The band label a CEO reads next to a 0–100 report-confidence score. The single
 * source of the banding — reused by confidenceScore() and by NarrativeService's
 * serializer (which rebuilds reportConfidence from a persisted row that stores
 * only the score + components, never the derived label).
 */
export function confidenceLabel(score) {
  return score >= CONFIDENCE_BANDS.HIGH ? 'HIGH' : score >= CONFIDENCE_BANDS.MODERATE ? 'MODERATE' : 'LOW';
}

/**
 * Report-level confidence — and it is ITSELF defensible: it returns the
 * component breakdown, never a bare "91%". Partial data → an honestly LOWER
 * score, never a falsely confident one. The direct extension of Phase 7's
 * "label uncertainty everywhere" into the boardroom.
 *
 * @param {{memoryCoverage?, incrementalityCoverage?, blendedConfidence?, attributionConfidence?}} coverage
 *        each a 0..1 ratio derived from real rows
 * @returns {{ score:number, label:string, components:Array<{key,weight,value}> }}
 */
export function confidenceScore(coverage = {}) {
  const components = Object.entries(CONFIDENCE_WEIGHTS).map(([key, weight]) => ({
    key,
    weight,
    value: clamp01(coverage[key]),
  }));
  const score = Math.round(100 * components.reduce((s, c) => s + c.weight * c.value, 0));
  return { score, label: confidenceLabel(score), components };
}
