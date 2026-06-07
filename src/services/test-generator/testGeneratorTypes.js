// ============================================================
// Test Generator — stable vocabulary
// ============================================================
// The four testing dimensions a performance buyer actually runs
// each week. Mirrors the Prisma `TestDimension` enum. No dynamic
// labels — every dimension must appear here first.
// ============================================================

export const TEST_DIMENSION = Object.freeze({
  HOOK:           'HOOK',           // Hook A vs Hook B (first-frame / opening line)
  OFFER:          'OFFER',          // promo / offer angle
  AUDIENCE:       'AUDIENCE',       // broad vs interest vs lookalike %
  CREATIVE_ANGLE: 'CREATIVE_ANGLE', // UGC vs static, problem- vs aspiration-led
});

// The single signal each dimension's test is designed to move. This is
// the "expected signal to watch" surfaced on every suggestion, and the
// metric the readout engine reads when the test concludes.
export const DIMENSION_METRIC = Object.freeze({
  HOOK:           'CTR',
  OFFER:          'ROAS',
  AUDIENCE:       'CPA',
  CREATIVE_ANGLE: 'CTR',
});
