// ============================================================
// MARCOM / Lumi — Content recommendations (verdict → creative action)
// ------------------------------------------------------------
// PURE + DETERMINISTIC: maps the engine's verdict (+ its diagnosis signalType,
// when available) to specific Content-Lab actions. No AI, no fabrication — the
// verdict and signalType are already decided by the deterministic verdict engine
// (judgeMetrics → diagnoseSignals); this only translates them into creative
// guidance the operator can act on.
//
// signalType is a HINT: a relatively-ranked verdict keeps its absolute-pass
// signal, so an exact match isn't guaranteed → every verdict has a `default`
// bucket the lookup falls back to. An unknown/absent verdict → no recommendations
// (honest empty), never a generic filler.
// ============================================================

const RECS = {
  KILL: {
    LOW_CTR: [
      'New hook — the current copy isn\'t stopping the scroll',
      'Fresh visual — the audience has seen this ad',
      'New angle — test a different message',
    ],
    CREATIVE_FATIGUE: [
      'Rotate the creative — the audience is saturated',
      'New hook + visual — reset the fatigue',
      'Rebuild before spending more',
    ],
    default: [
      'Rebuild the creative — new hook, visual, and angle',
      'Test a new offer angle',
      'Test a different audience',
    ],
  },
  REFRESH: {
    CREATIVE_FATIGUE: [
      'New hook — frequency is rising',
      'Fresh visual — same message, new look',
      'Test an urgency CTA',
    ],
    default: [
      'Refresh the hook',
      'New visual format',
      'Test shorter copy',
    ],
  },
  REALLOCATE: {
    AUDIENCE_MISMATCH: [
      'New angle for a tighter audience',
      'Test different interest targeting',
    ],
    INEFFICIENT_SCALING: [
      'Narrow the audience before scaling',
      'Test a lookalike audience',
    ],
    default: [
      'New angle',
      'Test an audience segment',
    ],
  },
  WATCH: {
    default: [
      'Monitor performance — one more sync',
      'Optional: test a single variant',
    ],
  },
  HOLD: {
    default: [
      'Hold steady',
      'Test one variant if CTR drops',
    ],
  },
  SCALE: {
    HEALTHY: [
      'Duplicate this creative',
      'Expand to a lookalike audience',
      'Test more variants of the winner',
    ],
    default: [
      'Duplicate and scale',
      'Test more variants of the winner',
    ],
  },
};

/**
 * @param {string|null|undefined} verdict     - engine verdict (KILL/SCALE/HOLD/WATCH/REALLOCATE/REFRESH)
 * @param {string|null|undefined} signalType  - diagnosis signal (LOW_CTR/CREATIVE_FATIGUE/…); optional
 * @returns {string[]} deterministic content recommendations (empty when no verdict)
 */
export function getContentRecommendations(verdict, signalType) {
  if (!verdict) return [];
  const byVerdict = RECS[verdict];
  if (!byVerdict) return []; // unknown verdict → honest empty, never filler
  return byVerdict[signalType] ?? byVerdict.default ?? [];
}
