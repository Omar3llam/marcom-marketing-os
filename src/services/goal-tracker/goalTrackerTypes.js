// ============================================================
// Goal-tracker engine — shared types
// ============================================================
// Sibling module so services/routes import the status enum without the
// engine (ESM link hygiene — the Phase-5 lesson).
// ============================================================

// North-star tracking status. AT_RISK can come from the lagging trend OR
// from a LEADING signal (fatigue) breaching before period end — the final
// status is the WORSE of the two, so Lumi warns before the headline breaks.
export const GOAL_STATUS = Object.freeze({
  ON_TRACK:  'ON_TRACK',
  AT_RISK:   'AT_RISK',
  OFF_TRACK: 'OFF_TRACK',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
});

// Standing honesty caveat on every estimate: CAC/ROAS/MER are not linear,
// so a linear-trend landing is an ESTIMATE, never a guaranteed projection.
export const NON_LINEARITY_ASSUMPTION =
  'linear-trend estimate; real CAC/ROAS curves bend — treat as a direction, not a guarantee';
