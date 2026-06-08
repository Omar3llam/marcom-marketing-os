// ============================================================
// Incrementality engine — shared types + frozen constants
// ============================================================
// Sibling module (ESM link hygiene — the Phase-5 lesson).
// ============================================================

// Holdout lifecycle. A holdout is "finished" only at CONCLUDED — when its
// lift is read out with a confidence interval and written to memory.
export const INCREMENTALITY_STATUS = Object.freeze({
  DESIGNED:  'DESIGNED',
  RUNNING:   'RUNNING',
  CONCLUDED: 'CONCLUDED',
  ABANDONED: 'ABANDONED',
});

// z for a two-sided alpha=0.05 test and 80% power (frozen defaults).
export const Z_ALPHA = Number(process.env.INCREMENTALITY_Z_ALPHA || 1.96); // two-sided 95%
export const Z_POWER = Number(process.env.INCREMENTALITY_Z_POWER || 0.84); // 80% power

// |z| thresholds → confidence (reuse the test-readout discipline).
export const Z_HIGH = 2.33;
export const Z_MODERATE = 1.64;

// Refuse to call a holdout below this many conversions on the smaller arm —
// the same refuse-below-floor ethic as the Testing OS readout.
export const MIN_CONVERSIONS_PER_ARM = Number(process.env.INCREMENTALITY_MIN_CONV || 25);
