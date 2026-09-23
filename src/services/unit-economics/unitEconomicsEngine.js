// ============================================================
// UnitEconomicsEngine — LTV / payback / contribution margin
// ============================================================
// Public API: computeUnitEconomics({ aovMinor, grossMarginPct, repeatRate,
//   avgOrdersPerCustomer, cacMinor, now, config })
//
// DETERMINISM CONTRACT:
//   Pure arithmetic. Same input → same output. No DB/LLM/randomness.
//
// ISOLATION CONTRACT:
//   EconomicsService loads the AccountEconomics row + a CAC (possibly a
//   scenario range) and feeds this engine; nothing here reads the DB.
//
// THE HONESTY RULE:
//   `cacMinor` may be a single number OR a scenario range
//   { low, expected, high }. When it's a range the verdict is itself a
//   range — "HEALTHY at expected CAC, THIN at the pessimistic end" — so
//   sustainability is never a single overconfident stamp. Money is integer
//   minor units throughout.
// ============================================================
import { logger } from '../../utils/logger.js';
import { SUSTAINABILITY_BAND, DEFAULT_TARGET_LTV_TO_CAC } from './unitEconomicsTypes.js';

function validate(aovMinor, grossMarginPct) {
  if (typeof aovMinor !== 'number' || !Number.isFinite(aovMinor) || aovMinor <= 0) {
    throw new Error('computeUnitEconomics: aovMinor must be a positive number');
  }
  if (typeof grossMarginPct !== 'number' || grossMarginPct < 0 || grossMarginPct > 1) {
    throw new Error('computeUnitEconomics: grossMarginPct must be a ratio in [0,1]');
  }
}

/** A CAC value (minor units) → band by LTV:CAC vs target. */
function bandFor(ltvToCac, target) {
  if (ltvToCac >= target) return SUSTAINABILITY_BAND.HEALTHY;
  if (ltvToCac >= 1)      return SUSTAINABILITY_BAND.THIN;
  return SUSTAINABILITY_BAND.UNDERWATER;
}

/** Normalize a number-or-range CAC into { low, expected, high }. */
function normalizeCac(cacMinor) {
  if (cacMinor && typeof cacMinor === 'object') {
    const { low, expected, high } = cacMinor;
    return { low: low ?? expected, expected, high: high ?? expected };
  }
  return { low: cacMinor, expected: cacMinor, high: cacMinor };
}

/**
 * Compute unit economics. CAC may be a point or a range.
 *
 * @param {object} args
 * @param {number} args.aovMinor — average order value (minor units)
 * @param {number} args.grossMarginPct — gross margin as a ratio [0,1]
 * @param {number} [args.repeatRate=0] — informational; folded into avgOrders by the caller
 * @param {number} [args.avgOrdersPerCustomer=1] — lifetime orders per customer
 * @param {(number|{low,expected,high})} args.cacMinor — acquisition cost (minor units)
 * @param {object} [args.config] — { targetLtvToCac }
 * @returns {{
 *   contributionPerOrderMinor, ltvMinor, paybackOrders,
 *   ltvToCac:{low,expected,high}, sustainabilityBand:{low,expected,high},
 *   sustainable, assumptions, currency
 * }}
 */
export function computeUnitEconomics({
  aovMinor, grossMarginPct, repeatRate = 0, avgOrdersPerCustomer = 1,
  cacMinor, now, config = {},
} = {}) {
  validate(aovMinor, grossMarginPct);
  void now;
  const target = config.targetLtvToCac ?? DEFAULT_TARGET_LTV_TO_CAC;

  const contributionPerOrderMinor = Math.round(aovMinor * grossMarginPct);
  const ltvMinor = Math.round(contributionPerOrderMinor * Math.max(1, avgOrdersPerCustomer));

  const cac = normalizeCac(cacMinor);
  const ratioAt = (c) => (c > 0 ? Math.round((ltvMinor / c) * 100) / 100 : null);

  // CAC and LTV:CAC move inversely — a HIGH CAC is the LOW (worst) ratio.
  const ltvToCac = {
    low:      ratioAt(cac.high),
    expected: ratioAt(cac.expected),
    high:     ratioAt(cac.low),
  };
  const sustainabilityBand = {
    low:      ltvToCac.low      != null ? bandFor(ltvToCac.low, target)      : null,
    expected: ltvToCac.expected != null ? bandFor(ltvToCac.expected, target) : null,
    high:     ltvToCac.high     != null ? bandFor(ltvToCac.high, target)     : null,
  };

  // Payback measured in ORDERS (channel-agnostic; days needs a velocity we
  // don't model here). ceil — you only pay back on whole contribution units.
  const paybackOrders = contributionPerOrderMinor > 0 && cac.expected > 0
    ? Math.ceil(cac.expected / contributionPerOrderMinor)
    : null;

  const assumptions = [
    `contribution margin = AOV × ${Math.round(grossMarginPct * 100)}% gross margin`,
    `LTV = contribution × ${Math.max(1, avgOrdersPerCustomer)} lifetime orders/customer (repeat rate ${Math.round(repeatRate * 100)}%)`,
    `target LTV:CAC = ${target}`,
  ];

  logger.debug({ ltvToCac, sustainabilityBand }, '[UnitEconomicsEngine] computed');
  return {
    contributionPerOrderMinor,
    ltvMinor,
    paybackOrders,
    ltvToCac,
    sustainabilityBand,
    sustainable: sustainabilityBand.expected === SUSTAINABILITY_BAND.HEALTHY,
    assumptions,
    currency: config.currency ?? null,
  };
}
