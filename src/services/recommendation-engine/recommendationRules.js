// ============================================================
// Recommendation Engine — rules
// ============================================================
// Maps each diagnosis type to an ordered list of recommendations.
// Rules are applied by exact match (no priority cascade here —
// one diagnosis → one rule set).
//
// build(metrics) receives the metrics object from the caller.
// Individual metric fields are optional; rationale strings use
// nullish-safe defaults so no build() call ever throws.
//
// SPEND_FOR_DUPLICATION is the only conditional threshold:
//   spend >= 100 on a HEALTHY campaign → suggest duplication.
// ============================================================
import { SIGNAL_TYPE }       from '../diagnosis-engine/index.js';
import { REC_TYPE, PRIORITY } from './recommendationTypes.js';

const SPEND_FOR_DUPLICATION = 100;

export const RECOMMENDATION_RULES = [
  // ── CREATIVE_FATIGUE ────────────────────────────────────────
  {
    diagnosisType: SIGNAL_TYPE.CREATIVE_FATIGUE,
    build(metrics) {
      const ctr  = metrics.ctr       ?? 0;
      const freq = metrics.frequency ?? 0;
      return [
        {
          type:      REC_TYPE.REFRESH_HOOK,
          priority:  PRIORITY.HIGH,
          rationale: `CTR ${ctr.toFixed(2)}% dropped while frequency ${freq.toFixed(1)} exceeded fatigue threshold`,
        },
        {
          type:      REC_TYPE.ROTATE_CREATIVE,
          priority:  PRIORITY.HIGH,
          rationale: 'Audience overexposure requires a new creative variant',
        },
        {
          type:      REC_TYPE.TEST_NEW_ANGLE,
          priority:  PRIORITY.MEDIUM,
          rationale: 'Validate whether a new message angle resets engagement',
        },
      ];
    },
  },

  // ── AUDIENCE_MISMATCH ────────────────────────────────────────
  {
    diagnosisType: SIGNAL_TYPE.AUDIENCE_MISMATCH,
    build(metrics) {
      const cpc = metrics.cpc ?? 0;
      return [
        {
          type:      REC_TYPE.TEST_NEW_ANGLE,
          priority:  PRIORITY.HIGH,
          rationale: `CPC $${cpc.toFixed(2)} with low conversion rate indicates wrong audience`,
        },
        {
          type:      REC_TYPE.ROTATE_CREATIVE,
          priority:  PRIORITY.MEDIUM,
          rationale: 'Creative may not resonate with current targeting',
        },
      ];
    },
  },

  // ── INEFFICIENT_SCALING ──────────────────────────────────────
  {
    diagnosisType: SIGNAL_TYPE.INEFFICIENT_SCALING,
    build(metrics) {
      const spend = metrics.spend ?? 0;
      return [
        {
          type:      REC_TYPE.REDUCE_BUDGET,
          priority:  PRIORITY.HIGH,
          rationale: `$${spend.toFixed(2)} spend not converting efficiently — reduce until CPL stabilizes`,
        },
        {
          type:      REC_TYPE.TEST_NEW_ANGLE,
          priority:  PRIORITY.MEDIUM,
          rationale: 'Identify a better-performing audience before scaling again',
        },
      ];
    },
  },

  // ── LOW_CTR ──────────────────────────────────────────────────
  {
    diagnosisType: SIGNAL_TYPE.LOW_CTR,
    build(metrics) {
      const ctr = metrics.ctr ?? 0;
      return [
        {
          type:      REC_TYPE.REFRESH_HOOK,
          priority:  PRIORITY.HIGH,
          rationale: `CTR ${ctr.toFixed(2)}% indicates creative hook is not capturing attention`,
        },
        {
          type:      REC_TYPE.TEST_NEW_ANGLE,
          priority:  PRIORITY.MEDIUM,
          rationale: 'Alternative message angle may improve initial engagement',
        },
      ];
    },
  },

  // ── HEALTHY ──────────────────────────────────────────────────
  {
    diagnosisType: SIGNAL_TYPE.HEALTHY,
    build(metrics) {
      const spend = metrics.spend ?? 0;
      if (spend >= SPEND_FOR_DUPLICATION) {
        return [
          {
            type:      REC_TYPE.DUPLICATE_WINNER,
            priority:  PRIORITY.MEDIUM,
            rationale: `$${spend.toFixed(2)} spend performing efficiently — scale by duplicating this ad set`,
          },
          {
            type:      REC_TYPE.HOLD_STEADY,
            priority:  PRIORITY.LOW,
            rationale: 'Continue monitoring current trajectory',
          },
        ];
      }
      return [
        {
          type:      REC_TYPE.HOLD_STEADY,
          priority:  PRIORITY.HIGH,
          rationale: 'All metrics within healthy parameters',
        },
      ];
    },
  },
];

export { SPEND_FOR_DUPLICATION };
