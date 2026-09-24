// ============================================================
// AllocationEngine — cross-channel capital allocation
// ============================================================
// Public API: allocate({ totalBudgetMinor, goal, channels, constraints })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no LLM, no DB, no
//   timestamps. (Mirrors VerdictEngine / GuardrailEngine.)
//
// ISOLATION CONTRACT:
//   Never writes to DB / executes. AllocationService runs this and
//   persists the result as an AllocationPlan + PROPOSED REALLOCATE
//   Decisions that flow through the existing confirm→execute guard.
//
// HONESTY:
//   `channels[].blendedRoas` / `blendedCpaMinor` MUST be the blended
//   truth (BlendedTruthEngine output), not the platform claim. The
//   allocator is goal-generic; only GROWTH_CEILING is implemented
//   today (max spend ceiling, maximize revenue under it, respecting
//   verdicts). Money stays in integer minor units.
// ============================================================
import { logger } from '../../utils/logger.js';
import { isSupportedCurrency } from '../../lib/currencyDetector.js';

export const GOAL_TYPE = Object.freeze({
  GROWTH_CEILING: 'GROWTH_CEILING',
  // Reserved (engine is goal-generic; not implemented this phase):
  // TARGET_CAC: 'TARGET_CAC', TARGET_ROAS: 'TARGET_ROAS',
});

// Verdict → appetite multiplier. A KILL channel is drained (0); a
// SCALE channel is favoured; REALLOCATE leaks budget away.
const VERDICT_APPETITE = Object.freeze({
  SCALE:      1.3,
  HOLD:       1.0,
  WATCH:      0.9,
  REFRESH:    0.8,
  REALLOCATE: 0.5,
  KILL:       0.0,
});

export const DEFAULT_CONSTRAINTS = Object.freeze({
  maxMoveShare: 0.25, // max share swing vs current allocation
  minShare:     0.0,  // allow draining a KILL channel to ~zero
  maxShare:     0.70, // never concentrate >70% in one channel
});

function validate(totalBudgetMinor, channels) {
  if (typeof totalBudgetMinor !== 'number' || !Number.isFinite(totalBudgetMinor) || totalBudgetMinor <= 0) {
    throw new Error('allocate: totalBudgetMinor must be a positive finite number');
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('allocate: channels must be a non-empty array');
  }
  for (const c of channels) {
    if (!c || typeof c !== 'object') throw new Error('allocate: each channel must be an object');
    if (typeof c.blendedRoas !== 'number' || !Number.isFinite(c.blendedRoas)) {
      throw new Error('allocate: channel.blendedRoas must be a finite number');
    }
  }
}

/**
 * Water-fill a set of weights to sum to 1.0 while honouring [minShare,
 * maxShare] as HARD bounds. Channels pinned at a bound are frozen and the
 * surplus/deficit is redistributed across the free channels in proportion
 * to their weight, iterating until stable. Guarantees no weight exceeds
 * maxShare even after redistribution (a plain normalize does not).
 */
function waterfillClamp(weights, channelIds, minShare, maxShare) {
  const w = { ...weights };
  const frozen = new Set();
  for (let pass = 0; pass < channelIds.length + 1; pass++) {
    // 1. Clamp any free channel that violates a bound; freeze it. This is
    //    what creates the slack to redistribute (a normalized set can still
    //    hold an over-cap weight).
    let newlyFrozen = false;
    for (const id of channelIds) {
      if (frozen.has(id)) continue;
      if (w[id] > maxShare)      { w[id] = maxShare; frozen.add(id); newlyFrozen = true; }
      else if (w[id] < minShare) { w[id] = minShare; frozen.add(id); newlyFrozen = true; }
    }

    // 2. Redistribute the remaining slack across the still-free channels.
    let freeSum = 0;
    for (const id of channelIds) if (!frozen.has(id)) freeSum += w[id];
    const total = channelIds.reduce((s, id) => s + w[id], 0);
    const slack = 1 - total;

    if (Math.abs(slack) < 1e-9 || freeSum <= 0) break;
    for (const id of channelIds) {
      if (frozen.has(id)) continue;
      w[id] += slack * (w[id] / freeSum);
    }
    if (!newlyFrozen && Math.abs(slack) < 1e-9) break;
  }
  return w;
}

/**
 * Constrain ideal weights: limit the swing vs current share, normalize,
 * then water-fill to [minShare,maxShare] as hard bounds. Mirrors the safety
 * shape of reinforcement-engine/budgetAllocator._applyWeightConstraints, but
 * enforces maxShare AFTER renormalization.
 */
function applyWeightConstraints(idealWeights, currentShares, channelIds, { maxMoveShare, minShare, maxShare }) {
  const out = {};
  for (const id of channelIds) {
    const ideal   = idealWeights[id] ?? 0;
    const current = currentShares[id] ?? 0;
    let w = Math.max(minShare, Math.min(maxShare, ideal));
    if (w > current)      w = Math.min(w, current + maxMoveShare);
    else if (w < current) w = Math.max(w, current - maxMoveShare);
    out[id] = w;
  }
  const total = channelIds.reduce((s, id) => s + out[id], 0);
  if (total > 0) for (const id of channelIds) out[id] /= total;
  return waterfillClamp(out, channelIds, minShare, maxShare);
}

/** Split totalBudgetMinor across weights as integers that sum EXACTLY to budget. */
function weightsToMinorBudget(weights, channelIds, totalBudgetMinor) {
  const raw = channelIds.map((id) => ({ id, exact: (weights[id] ?? 0) * totalBudgetMinor }));
  const floored = raw.map((r) => ({ id: r.id, value: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let remainder = totalBudgetMinor - floored.reduce((s, r) => s + r.value, 0);
  // Hand the leftover minor units to the largest fractional parts (stable, deterministic).
  floored.sort((a, b) => b.frac - a.frac || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < floored.length && remainder > 0; i++, remainder--) floored[i].value += 1;
  const byId = {};
  for (const r of floored) byId[r.id] = r.value;
  return byId;
}

/**
 * Allocate a fixed budget across channels toward a goal.
 *
 * @param {object} args
 * @param {number} args.totalBudgetMinor — the spend ceiling (minor units)
 * @param {object} args.goal — { type, value? }
 * @param {Array<object>} args.channels — each:
 *   { channelId, channel?, blendedRoas, blendedCpaMinor?, currentSpendMinor?,
 *     currentRevenueMinor?, verdict?, marginalEfficiency?, currency? }
 * @param {object} [args.constraints]
 * @returns {{ goal, totalBudgetMinor, currency, allocations, projected, reasoningTrail }}
 */
export function allocate({ totalBudgetMinor, totalBudgetCurrency, goal, channels, constraints } = {}) {
  validate(totalBudgetMinor, channels ?? []);
  const goalType = goal?.type ?? GOAL_TYPE.GROWTH_CEILING;
  if (goalType !== GOAL_TYPE.GROWTH_CEILING) {
    throw new Error(`allocate: unsupported goal type "${goalType}" (only GROWTH_CEILING is implemented)`);
  }
  const cons = { ...DEFAULT_CONSTRAINTS, ...(constraints ?? {}) };
  if (!isSupportedCurrency(totalBudgetCurrency)) throw new Error('allocate: totalBudgetCurrency must be an explicit supported currency');
  const currency = totalBudgetCurrency.trim().toUpperCase();
  if (channels.some((c) => c.currency !== currency || c.monetaryStatus !== 'MONETARY_VALID')) {
    throw new Error('allocate: channels require proven monetary eligibility in the budget currency');
  }
  const ids = channels.map((c) => c.channelId);

  // Current shares (reference frame for the move cap).
  const currentTotal = channels.reduce((s, c) => s + (c.currentSpendMinor ?? 0), 0);
  const currentShares = {};
  for (const c of channels) {
    currentShares[c.channelId] = currentTotal > 0 ? (c.currentSpendMinor ?? 0) / currentTotal : 1 / channels.length;
  }

  // Efficiency score: marginal efficiency (or blended ROAS as the proxy),
  // gated by verdict appetite. GROWTH_CEILING pushes budget to winners.
  const scores = {};
  for (const c of channels) {
    const eff       = Number.isFinite(c.marginalEfficiency) ? c.marginalEfficiency : c.blendedRoas;
    const appetite  = VERDICT_APPETITE[c.verdict] ?? 1.0;
    scores[c.channelId] = Math.max(0, eff) * appetite;
  }
  const scoreTotal = ids.reduce((s, id) => s + scores[id], 0);

  // Ideal weights ∝ score; if every channel is gated to zero, hold current.
  const idealWeights = {};
  for (const id of ids) {
    idealWeights[id] = scoreTotal > 0 ? scores[id] / scoreTotal : currentShares[id];
  }

  const weights = applyWeightConstraints(idealWeights, currentShares, ids, cons);
  const budgetById = weightsToMinorBudget(weights, ids, totalBudgetMinor);

  // Build per-channel allocations + projected impact (linear blended-ROAS hold).
  const reasoningTrail = [];
  let projectedRevenueMinor = 0;
  let projectedConversions  = 0;
  let currentRevenueMinor   = 0;

  const allocations = channels.map((c) => {
    const recommendedSpendMinor = budgetById[c.channelId];
    const currentSpendMinor     = c.currentSpendMinor ?? 0;
    const deltaMinor            = recommendedSpendMinor - currentSpendMinor;

    const curRev = Number.isFinite(c.currentRevenueMinor)
      ? c.currentRevenueMinor
      : Math.round(currentSpendMinor * c.blendedRoas);
    currentRevenueMinor   += curRev;
    projectedRevenueMinor += Math.round(recommendedSpendMinor * c.blendedRoas);
    if (Number.isFinite(c.blendedCpaMinor) && c.blendedCpaMinor > 0) {
      projectedConversions += recommendedSpendMinor / c.blendedCpaMinor;
    }

    const verdict = c.verdict ?? 'HOLD';
    const dir = deltaMinor > 0 ? 'increase' : deltaMinor < 0 ? 'decrease' : 'hold';
    const rationale =
      verdict === 'KILL'  ? `Drain ${c.channelId}: KILL verdict — pull budget out.`
      : dir === 'hold'    ? `Hold ${c.channelId}: already near its efficient share.`
      : `${dir === 'increase' ? 'Grow' : 'Trim'} ${c.channelId} by ${Math.abs(deltaMinor)} (${verdict}, blended revenue efficiency ${c.blendedRoas.toFixed(2)}x).`;
    reasoningTrail.push(rationale);

    return {
      channelId: c.channelId,
      channel:   c.channel ?? null,
      verdict,
      currentSpendMinor,
      recommendedSpendMinor,
      deltaMinor,
      blendedRoas: c.blendedRoas,
      rationale,
    };
  });

  const blendedRevenueEfficiencyBefore = currentTotal > 0 ? currentRevenueMinor / currentTotal : null;
  const blendedRevenueEfficiencyAfter = projectedRevenueMinor / totalBudgetMinor;
  const projectedCpaMinor = projectedConversions > 0 ? Math.round(totalBudgetMinor / projectedConversions) : null;

  reasoningTrail.unshift(
    `Goal GROWTH_CEILING: distribute ${totalBudgetMinor} (${currency}, minor units) toward marginal efficiency; ` +
    `projected blended revenue efficiency ${blendedRevenueEfficiencyBefore?.toFixed(2) ?? 'unavailable'}x → ${blendedRevenueEfficiencyAfter.toFixed(2)}x.`,
  );

  logger.debug(
    { goal: goalType, channels: channels.length, blendedRevenueEfficiencyBefore, blendedRevenueEfficiencyAfter },
    '[AllocationEngine] allocated',
  );

  return {
    goal: { type: goalType, value: goal?.value ?? null },
    totalBudgetMinor,
    currency,
    allocations,
    projected: {
      blendedRevenueMinor: projectedRevenueMinor,
      projectedCpaMinor,
      blendedRevenueEfficiencyBefore,
      blendedRevenueEfficiencyAfter,
    },
    reasoningTrail,
  };
}
