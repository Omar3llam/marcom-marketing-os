// ============================================================
// Diagnosis Engine — signal rules
// ============================================================
// Rules are applied in declaration order.  First match wins.
// Priority (highest → lowest):
//   CREATIVE_FATIGUE > AUDIENCE_MISMATCH > INEFFICIENT_SCALING > LOW_CTR
//
// Thresholds are industry-standard paid-social benchmarks
// (Meta/Facebook context).  All values are constants — no
// runtime mutation, no learning loops.
// ============================================================
import { SIGNAL_TYPE, DIAGNOSIS } from './diagnosisTypes.js';

// All threshold constants in one place for auditability.
const T = Object.freeze({
  CTR_WEAK:        0.5,   // % — below this, hook is considered weak
  CTR_FATIGUE:     1.0,   // % — acceptable floor when frequency is elevated
  FREQUENCY_HIGH:  3.0,   // times — audience has seen the ad too often
  CPC_HIGH:        2.0,   // $ — elevated cost per click signals targeting issues
  SPEND_FLOOR:     50.0,  // $ — below this, efficiency signals are noise
  CPL_HIGH:        50.0,  // $ — cost per conversion above this = inefficient
  CONV_RATE_LOW:   0.02,  // ratio — < 2% click-to-conversion = poor audience fit
});

export { T as THRESHOLDS };

// ---------------------------------------------------------------------------
// Rule definitions
// Each rule: { signalType, diagnosis, confidence, match(input), reasons(input) }
// ---------------------------------------------------------------------------

export const SIGNAL_RULES = [
  // 1. CREATIVE_FATIGUE — audience has seen this creative too many times
  {
    signalType: SIGNAL_TYPE.CREATIVE_FATIGUE,
    diagnosis:  DIAGNOSIS.CREATIVE_FATIGUE,
    confidence: 0.85,
    match({ frequency, ctr }) {
      return frequency > T.FREQUENCY_HIGH && ctr < T.CTR_FATIGUE;
    },
    reasons({ frequency, ctr }) {
      return [
        `frequency ${frequency.toFixed(1)} exceeds saturation threshold ${T.FREQUENCY_HIGH}`,
        `CTR ${ctr.toFixed(2)}% below healthy floor ${T.CTR_FATIGUE}%`,
      ];
    },
  },

  // 2. AUDIENCE_MISMATCH — targeting the wrong people (high CPC, few convert)
  {
    signalType: SIGNAL_TYPE.AUDIENCE_MISMATCH,
    diagnosis:  DIAGNOSIS.AUDIENCE_MISMATCH,
    confidence: 0.80,
    match({ cpc, spend, conversions }) {
      if (spend < T.SPEND_FLOOR || cpc <= 0) return false;
      const clicks = spend / cpc;
      const convRate = clicks > 0 ? conversions / clicks : 0;
      return cpc > T.CPC_HIGH && convRate < T.CONV_RATE_LOW;
    },
    reasons({ cpc, spend, conversions }) {
      const clicks = cpc > 0 ? spend / cpc : 0;
      const convRate = clicks > 0 ? conversions / clicks : 0;
      return [
        `CPC $${cpc.toFixed(2)} exceeds threshold $${T.CPC_HIGH.toFixed(2)}`,
        `conversion rate ${(convRate * 100).toFixed(2)}% below target ${T.CONV_RATE_LOW * 100}%`,
      ];
    },
  },

  // 3. INEFFICIENT_SCALING — budget is growing faster than results
  {
    signalType: SIGNAL_TYPE.INEFFICIENT_SCALING,
    diagnosis:  DIAGNOSIS.INEFFICIENT_SCALING,
    confidence: 0.75,
    match({ spend, conversions }) {
      if (spend < T.SPEND_FLOOR || conversions <= 0) return false;
      return (spend / conversions) > T.CPL_HIGH;
    },
    reasons({ spend, conversions }) {
      const cpl = spend / conversions;
      return [
        `cost per conversion $${cpl.toFixed(2)} exceeds target $${T.CPL_HIGH.toFixed(2)}`,
        `${conversions} conversion${conversions !== 1 ? 's' : ''} on $${spend.toFixed(2)} spend`,
      ];
    },
  },

  // 4. LOW_CTR — creative hook is not capturing attention
  {
    signalType: SIGNAL_TYPE.LOW_CTR,
    diagnosis:  DIAGNOSIS.LOW_CTR,
    confidence: 0.70,
    match({ ctr }) {
      return ctr < T.CTR_WEAK;
    },
    reasons({ ctr }) {
      return [
        `CTR ${ctr.toFixed(2)}% below weak-hook threshold ${T.CTR_WEAK}%`,
      ];
    },
  },
];

// Returned when no rule fires — all signals within healthy parameters.
export const HEALTHY_RESULT = Object.freeze({
  signalType: SIGNAL_TYPE.HEALTHY,
  diagnosis:  DIAGNOSIS.HEALTHY,
  confidence: 1.0,
  reasons:    Object.freeze(['all metrics within healthy parameters']),
});
