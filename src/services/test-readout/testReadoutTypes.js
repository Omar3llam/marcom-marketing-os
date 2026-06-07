// ============================================================
// Test Readout — stable vocabulary
// ============================================================
// Metrics a test can be read on, and the honest confidence bands
// the readout engine assigns. No dynamic labels.
// ============================================================

export const METRIC = Object.freeze({
  CTR:  'CTR',  // click-through rate (rate)
  CVR:  'CVR',  // conversion rate (rate)
  ROAS: 'ROAS', // return on ad spend (ratio, higher better)
  CPA:  'CPA',  // cost per acquisition (ratio, LOWER better)
});

export const CONFIDENCE_LABEL = Object.freeze({
  HIGH:         'HIGH',
  MODERATE:     'MODERATE',
  LOW:          'LOW',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

// Rate metrics get a real two-proportion z-test; ratio metrics get a
// lift+sample-floor read (capped at MODERATE — we don't fake a variance).
const _RATE = new Set([METRIC.CTR, METRIC.CVR]);

export const RATE_METRICS = Object.freeze({
  has:           (m) => _RATE.has(m),
  isLowerBetter: (m) => m === METRIC.CPA,
});
