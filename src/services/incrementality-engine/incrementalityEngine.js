// ============================================================
// IncrementalityEngine — holdout design + causal lift readout
// ============================================================
// Public API:
//   designHoldout({ baselineCvr, mde, dailyEligible, holdoutPct, alpha, power })
//   readIncrementality({ exposed, holdout, aovMinor })
//
// DETERMINISM CONTRACT:
//   Pure. Same input → same output. No DB/LLM/randomness/timestamps.
//
// ISOLATION CONTRACT:
//   IncrementalityService persists the design + reads counters and feeds
//   this engine; nothing here touches the DB.
//
// THE GUARD:
//   A holdout is the ONLY causal signal we have. Its readout is a lift with
//   a CONFIDENCE INTERVAL — never a point. And it REFUSES to call a result
//   when the CI crosses zero or the sample is below the floor, no matter how
//   big the raw lift. Incremental revenue is an `attributed()` figure
//   (source INCREMENTALITY) carrying the CI as its band.
// ============================================================
import { logger } from '../../utils/logger.js';
import { attributed, ATTRIBUTION_SOURCE, CONFIDENCE_LEVEL } from '../attribution-engine/attributionTypes.js';
import { Z_ALPHA, Z_POWER, Z_HIGH, Z_MODERATE, MIN_CONVERSIONS_PER_ARM } from './incrementalityTypes.js';

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10_000) / 10_000;

/**
 * Compute a two-arm holdout sampling design to detect a relative conversion-rate lift.
 *
 * @param {Object} params
 * @param {number} params.baselineCvr - Baseline conversion rate (must be > 0 and < 1).
 * @param {number} params.mde - Minimum detectable relative lift (e.g., 0.10 for 10%).
 * @param {number} params.dailyEligible - Average number of eligible users per day (must be > 0).
 * @param {number} [params.holdoutPct=0.1] - Fraction of daily eligible assigned to the holdout arm.
 * @param {number} [params.alpha] - Z-score for significance; when omitted a default constant is used.
 * @param {number} [params.power] - Z-score for power; when omitted a default constant is used.
 * @returns {Object} Design object containing:
 *  - sampleSizePerArm: required users per arm,
 *  - durationDays: holdout duration in days (clamped to guardrails),
 *  - holdoutPct: fraction assigned to holdout,
 *  - guardrails: object with min/max duration and holdout-share limits,
 *  - assumptions: human-readable array describing the baseline, target, alpha/power, and holdout share.
 * @throws {Error} If baselineCvr is not a number in (0,1), if mde is not a number > 0, or if dailyEligible is not a number > 0.
 */
export function designHoldout({ baselineCvr, mde, dailyEligible, holdoutPct = 0.1, alpha, power } = {}) {
  if (typeof baselineCvr !== 'number' || baselineCvr <= 0 || baselineCvr >= 1) {
    throw new Error('designHoldout: baselineCvr must be a rate in (0,1)');
  }
  if (typeof mde !== 'number' || mde <= 0) throw new Error('designHoldout: mde (relative lift) must be > 0');
  if (typeof dailyEligible !== 'number' || dailyEligible <= 0) throw new Error('designHoldout: dailyEligible must be > 0');

  const zA = typeof alpha === 'number' ? alpha : Z_ALPHA;
  const zB = typeof power === 'number' ? power : Z_POWER;
  const p1 = baselineCvr;
  const p2 = baselineCvr * (1 + mde); // the lifted (exposed) rate we want to detect
  const diff = p2 - p1;

  // n per arm = (zα + zβ)² · [p1(1−p1) + p2(1−p2)] / diff²
  const nPerArm = Math.ceil(((zA + zB) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (diff * diff));

  // Holdout arm gets `holdoutPct` of daily eligible; it is the smaller arm
  // and therefore the binding constraint on duration.
  const holdoutDaily = dailyEligible * holdoutPct;
  const durationDays = Math.ceil(nPerArm / holdoutDaily);

  const guardrails = {
    minDurationDays: 7,                                  // never trust a <1-week holdout
    maxDurationDays: 56,                                 // stop bleeding holdout opportunity cost
    maxHoldoutShare: 0.25,                               // never suppress >25% of a channel
    stopIfSpendBreachPct: 0.20,                          // abort if guardrail spend deviates >20%
  };

  return {
    sampleSizePerArm: nPerArm,
    durationDays: Math.min(Math.max(durationDays, guardrails.minDurationDays), guardrails.maxDurationDays),
    holdoutPct,
    guardrails,
    assumptions: [
      `baseline CVR ${round4(p1)}, target +${Math.round(mde * 100)}% relative lift → exposed CVR ${round4(p2)}`,
      `alpha=${zA} (95% two-sided), power z=${zB} (≈80%)`,
      `${holdoutPct * 100}% holdout of ${dailyEligible}/day eligible`,
    ],
  };
}

/**
 * Compute the z-statistic and standard error for the difference between two proportions.
 * @param {number} pe - Proportion in the exposed group (e.g., exposed conversions / exposed users).
 * @param {number} ph - Proportion in the holdout group (e.g., holdout conversions / holdout users).
 * @param {number} ne - Sample size for the exposed group (number of users).
 * @param {number} nh - Sample size for the holdout group (number of users).
 * @returns {{z: number, se: number}} The z-statistic for (pe − ph) and its standard error; if the standard error is non-finite or zero, returns `{ z: 0, se: 0 }`.
 */
function diffZ(pe, ph, ne, nh) {
  const se = Math.sqrt((pe * (1 - pe)) / ne + (ph * (1 - ph)) / nh);
  if (!Number.isFinite(se) || se === 0) return { z: 0, se: 0 };
  return { z: (pe - ph) / se, se };
}

/**
 * Read out a holdout — causal lift with a CONFIDENCE INTERVAL, honestly.
 *
 * @param {object} args
 * @param {{users:number, conversions:number}} args.exposed
 * @param {{users:number, conversions:number}} args.holdout
 * @param {number} [args.aovMinor] — to value incremental conversions (minor units)
 * @returns {{
 *   status, exposedCvr, holdoutCvr, absoluteLift, liftPct, ci:[lo,hi],
 *   confidenceLabel, conclusive, incrementalConversions:Attributed,
 *   incrementalRevenueMinor:Attributed, rationale
 * }}
 */
export function readIncrementality({ exposed, holdout, aovMinor = 0 } = {}) {
  if (!exposed || !holdout || !(exposed.users > 0) || !(holdout.users > 0)) {
    throw new Error('readIncrementality: exposed and holdout each need a positive user count');
  }
  const pe = exposed.conversions / exposed.users;
  const ph = holdout.conversions / holdout.users;
  const absoluteLift = pe - ph;
  const liftPct = ph > 0 ? (absoluteLift / ph) * 100 : 0;

  const { z, se } = diffZ(pe, ph, exposed.users, holdout.users);
  const ciLo = round4(absoluteLift - Z_ALPHA * se);
  const ciHi = round4(absoluteLift + Z_ALPHA * se);

  // Honesty gates: refuse below the conversion floor, or when the CI on the
  // lift crosses zero (we can't rule out "no effect"), regardless of raw lift.
  const minConv = Math.min(exposed.conversions, holdout.conversions);
  const belowFloor = minConv < MIN_CONVERSIONS_PER_ARM;
  const ciCrossesZero = ciLo <= 0 && ciHi >= 0;
  const conclusive = !belowFloor && !ciCrossesZero && absoluteLift > 0;

  let confidenceLabel = CONFIDENCE_LEVEL.LOW;
  if (conclusive) {
    confidenceLabel = Math.abs(z) >= Z_HIGH ? CONFIDENCE_LEVEL.HIGH
      : Math.abs(z) >= Z_MODERATE ? CONFIDENCE_LEVEL.MEDIUM
      : CONFIDENCE_LEVEL.LOW;
  }

  // Incremental conversions among the EXPOSED population (the actionable count).
  const incrementalConversions = conclusive ? Math.max(0, Math.round(absoluteLift * exposed.users)) : 0;
  const incrementalRevenueMinor = Math.round(incrementalConversions * aovMinor);

  const rationale = belowFloor
    ? `Only ${minConv} conversions on the smaller arm — too thin to call (need ${MIN_CONVERSIONS_PER_ARM}).`
    : ciCrossesZero
      ? `Lift CI [${round2(ciLo * 100)}%, ${round2(ciHi * 100)}%] includes zero — cannot rule out no effect. INCONCLUSIVE.`
      : `Exposed ${round4(pe)} vs holdout ${round4(ph)} CVR → +${round2(liftPct)}% incremental, ${confidenceLabel} confidence.`;

  const result = {
    status: conclusive ? 'CONCLUSIVE' : 'INCONCLUSIVE',
    exposedCvr: round4(pe),
    holdoutCvr: round4(ph),
    absoluteLift: round4(absoluteLift),
    liftPct: round2(liftPct),
    ci: [ciLo, ciHi],
    confidenceLabel,
    conclusive,
    incrementalConversions: attributed(incrementalConversions, ATTRIBUTION_SOURCE.INCREMENTALITY, confidenceLabel, { band: [ciLo, ciHi], caveat: 'measured holdout lift among exposed users' }),
    incrementalRevenueMinor: attributed(incrementalRevenueMinor, ATTRIBUTION_SOURCE.INCREMENTALITY, confidenceLabel, { band: null, caveat: 'incremental conversions × AOV' }),
    rationale,
  };
  logger.debug({ liftPct: result.liftPct, conclusive, confidenceLabel }, '[IncrementalityEngine] readout');
  return result;
}
