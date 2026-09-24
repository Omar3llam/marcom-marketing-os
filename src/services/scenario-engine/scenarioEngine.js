// ============================================================
// ScenarioEngine — forward-looking what-if projection (RANGES)
// ============================================================
// Public API: projectScenario({ baseline, change, economics, memory, now, config })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no Monte Carlo, no LLM, no
//   DB, no timestamps (`now` injected but unused for math — reserved for
//   future seasonal terms). Mirrors AllocationEngine / FatigueForecaster.
//
// ISOLATION CONTRACT:
//   Never writes to DB / executes. ScenarioService loads blended truth +
//   economics + memory accuracy and feeds this engine; nothing here reads
//   the DB.
//
// THE HONESTY RULE (the through-line of the whole product):
//   NO projection is ever a bare point. Every output metric is a RANGE
//   { low, expected, high } plus an explicit `assumptions[]` list. The
//   range comes from projecting the RISKY spend (moved/added) under three
//   named retention assumptions (70/85/100% of marginal efficiency),
//   widened by the Phase-5 memory accuracy band.
//
// THE CEO LENS:
//   CAC/Volume/MER answer the media-buyer question; a founder thinks in
//   revenue and gross profit. A scenario where CAC ↑15% but revenue ↑80%
//   is GOOD — so revenue + grossProfit are first-class outputs. Money is
//   integer minor units throughout. Identity used: CAC = AOV / ROAS,
//   volume = revenue / AOV.
// ============================================================
import { logger } from '../../utils/logger.js';
import {
  SCENARIO_TYPE, RETENTION_BANDS, BAND_LABEL,
  DIMINISHING_RETURNS_KNEE, DIMINISHING_RETURNS_SLOPE, DIMINISHING_RETURNS_FLOOR,
  DEFAULT_MEMORY_ACCURACY, MEMORY_WIDEN_MAX,
} from './scenarioTypes.js';

function validate(baseline, economics, change) {
  if (!Array.isArray(baseline) || baseline.length === 0) {
    throw new Error('projectScenario: baseline must be a non-empty array of channels');
  }
  for (const c of baseline) {
    if (!c || typeof c !== 'object') throw new Error('projectScenario: each channel must be an object');
    if (typeof c.spendMinor !== 'number' || !Number.isFinite(c.spendMinor) || c.spendMinor < 0) {
      throw new Error('projectScenario: channel.spendMinor must be a non-negative finite number');
    }
    if (typeof c.blendedRoas !== 'number' || !Number.isFinite(c.blendedRoas) || c.blendedRoas < 0) {
      throw new Error('projectScenario: channel.blendedRoas must be a non-negative finite number');
    }
  }
  if (!economics || typeof economics.aovMinor !== 'number' || economics.aovMinor <= 0) {
    throw new Error('projectScenario: economics.aovMinor must be a positive number');
  }
  if (typeof economics.grossMarginPct !== 'number' || economics.grossMarginPct < 0 || economics.grossMarginPct > 1) {
    throw new Error('projectScenario: economics.grossMarginPct must be a ratio in [0,1]');
  }
  const type = change?.type;
  if (!Object.values(SCENARIO_TYPE).includes(type)) {
    throw new Error(`projectScenario: change.type must be one of ${Object.values(SCENARIO_TYPE).join(', ')}`);
  }
}

/** Aggregate memory accuracy → a single prior in [0,1]. Empty ⇒ default. */
function memoryAccuracy(memory) {
  const accs = (memory ?? [])
    .map((m) => m?.accuracy)
    .filter((a) => typeof a === 'number' && Number.isFinite(a));
  if (accs.length === 0) return { accuracy: DEFAULT_MEMORY_ACCURACY, hasMemory: false };
  return { accuracy: accs.reduce((s, a) => s + a, 0) / accs.length, hasMemory: true };
}

/** Diminishing returns: incremental spend above the knee buys worse efficiency. */
function diminish(swingPct) {
  if (swingPct <= DIMINISHING_RETURNS_KNEE) return 1;
  return Math.max(DIMINISHING_RETURNS_FLOOR, 1 - (swingPct - DIMINISHING_RETURNS_KNEE) * DIMINISHING_RETURNS_SLOPE);
}

/** Resolve the post-change spend per channel for the given change. */
function newSpendByChannel(baseline, change) {
  const cur = new Map(baseline.map((c) => [c.channelId, c.spendMinor]));
  const next = new Map(cur);
  const currentTotal = baseline.reduce((s, c) => s + c.spendMinor, 0);

  if (change.type === SCENARIO_TYPE.CHANNEL_REALLOCATION) {
    for (const sh of change.shifts ?? []) {
      const fromSpend = cur.get(sh.fromChannelId) ?? 0;
      const moved = Math.round(fromSpend * (sh.pct ?? 0));
      next.set(sh.fromChannelId, (next.get(sh.fromChannelId) ?? 0) - moved);
      next.set(sh.toChannelId,   (next.get(sh.toChannelId)   ?? 0) + moved);
    }
    return { next, currentTotal };
  }

  // Expansion / contraction: resolve the new total, distribute the delta
  // proportional to current share (a channel with 0 current spend gets 0).
  const newTotal = typeof change.newTotalBudgetMinor === 'number'
    ? change.newTotalBudgetMinor
    : Math.round(currentTotal * (1 + (change.deltaPct ?? 0)));
  const delta = newTotal - currentTotal;
  for (const c of baseline) {
    const share = currentTotal > 0 ? c.spendMinor / currentTotal : 1 / baseline.length;
    next.set(c.channelId, c.spendMinor + Math.round(delta * share));
  }
  return { next, currentTotal };
}

/**
 * Revenue for ONE retention band r. The retained (existing) spend earns its
 * own blended ROAS; the RISKY spend (added/received) earns a discounted ROAS
 * per the scenario type. Returns { totalSpendMinor, totalRevenueMinor }.
 */
function revenueForBand(baseline, change, r) {
  const byId = new Map(baseline.map((c) => [c.channelId, c]));
  const { next } = newSpendByChannel(baseline, change);

  let totalSpend = 0;
  let totalRevenue = 0;

  if (change.type === SCENARIO_TYPE.CHANNEL_REALLOCATION) {
    // Start every channel at its post-shift spend × own ROAS (source channels
    // simply have less money at the same efficiency), then credit each
    // destination for the RECEIVED budget at a transfer-discounted ROAS.
    for (const c of baseline) {
      const spend = Math.max(0, next.get(c.channelId) ?? 0);
      totalSpend += spend;
    }
    // Base revenue: each channel keeps min(new,cur) at its own ROAS; the
    // moved money is re-credited per shift so it never double-counts.
    for (const c of baseline) {
      const newSpend = Math.max(0, next.get(c.channelId) ?? 0);
      const retained = Math.min(c.spendMinor, newSpend);
      totalRevenue += retained * c.blendedRoas;
    }
    for (const sh of change.shifts ?? []) {
      const from = byId.get(sh.fromChannelId);
      const to   = byId.get(sh.toChannelId);
      if (!from) continue;
      const moved = Math.round(from.spendMinor * (sh.pct ?? 0));
      // Received budget earns at the DESTINATION's efficiency when known,
      // else anchors on the SOURCE (a brand-new channel like TikTok has no
      // history) — discounted by the retention band (transfer/ramp risk).
      const destRoas = (to && to.blendedRoas > 0) ? to.blendedRoas : from.blendedRoas;
      totalRevenue += moved * destRoas * r;
    }
    return { totalSpendMinor: totalSpend, totalRevenueMinor: Math.round(totalRevenue) };
  }

  // Expansion / contraction: intra-channel added/removed spend.
  for (const c of baseline) {
    const newSpend = Math.max(0, next.get(c.channelId) ?? 0);
    const retained = Math.min(c.spendMinor, newSpend);
    const added    = Math.max(0, newSpend - c.spendMinor);
    const removed  = Math.max(0, c.spendMinor - newSpend);
    totalSpend += newSpend;

    // Retained spend earns full ROAS. Added spend (expansion) retains r of
    // own efficiency, further decayed past the diminishing-returns knee.
    let rev = retained * c.blendedRoas;
    if (added > 0) {
      const swingPct = c.spendMinor > 0 ? added / c.spendMinor : 1;
      rev += added * c.blendedRoas * r * diminish(swingPct);
    }
    // Contraction removes the worst marginal units first, so the cut forgoes
    // only average-efficiency revenue (retained holds) — modelled as a plain
    // ROAS loss on the removed units (CAC stays ~flat). `removed` is implicit
    // in `newSpend` already; no extra term needed.
    void removed;
    totalRevenue += rev;
  }
  return { totalSpendMinor: totalSpend, totalRevenueMinor: Math.round(totalRevenue) };
}

/** Per-band derived metrics from spend+revenue and economics. */
function bandMetrics(spendMinor, revenueMinor, economics) {
  const volume = revenueMinor / economics.aovMinor;                 // orders
  const blendedCacMinor = volume > 0 ? Math.round(spendMinor / volume) : null;
  const grossProfitMinor = Math.round(revenueMinor * economics.grossMarginPct);
  const blendedRevenueEfficiencyAfter = spendMinor > 0 ? revenueMinor / spendMinor : null;
  return { blendedCacMinor, volume, revenueMinor, grossProfitMinor, blendedRevenueEfficiencyAfter };
}

/** Collapse three band values into a {low, expected, high} range, memory-widened. */
function toRange(values, expectedVal, widen, { higherIsWorse = false } = {}) {
  const finite = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (finite.length === 0 || !Number.isFinite(expectedVal)) return { low: null, expected: null, high: null };
  let low = Math.min(...finite);
  let high = Math.max(...finite);
  // Memory uncertainty pushes the bounds outward symmetrically.
  low  = low  * (1 - widen);
  high = high * (1 + widen);
  const round = (v) => (Number.isInteger(expectedVal) ? Math.round(v) : Math.round(v * 100) / 100);
  void higherIsWorse;
  return { low: round(low), expected: round(expectedVal), high: round(high) };
}

/**
 * Project a budget change as ranges, not points.
 *
 * @param {object} args
 * @param {Array<{channelId, channel?, spendMinor, blendedRoas, currency?}>} args.baseline
 * @param {object} args.change — { type, shifts?|newTotalBudgetMinor?|deltaPct? }
 * @param {{aovMinor:number, grossMarginPct:number, currency?:string}} args.economics
 * @param {Array<{cohort?:string, accuracy:number}>} [args.memory]
 * @returns {{ scenarioType, change, currency, projections, assumptions, confidence, basis }}
 */
export function projectScenario({ baseline, change, economics, memory = [], now, config = {} } = {}) {
  validate(baseline, economics, change);
  void now;

  const bands = { ...RETENTION_BANDS, ...(config.retentionBands ?? {}) };
  const { accuracy, hasMemory } = memoryAccuracy(memory);
  const widen = Math.max(0, Math.min(1, (1 - accuracy) * MEMORY_WIDEN_MAX));
  const currency = config.monetaryCurrency ?? null;

  // Compute metrics at each retention band.
  const perBand = {};
  for (const [label, r] of Object.entries(bands)) {
    const { totalSpendMinor, totalRevenueMinor } = revenueForBand(baseline, change, r);
    perBand[label] = bandMetrics(totalSpendMinor, totalRevenueMinor, economics);
  }
  const exp = perBand[BAND_LABEL.expected] ?? Object.values(perBand)[0];

  const collect = (key) => Object.values(perBand).map((b) => b[key]);
  const projections = {
    blendedCacMinor:  toRange(collect('blendedCacMinor'),  exp.blendedCacMinor,  widen, { higherIsWorse: true }),
    volume:           toRange(collect('volume'),           exp.volume,           widen),
    revenueMinor:     toRange(collect('revenueMinor'),     exp.revenueMinor,     widen),
    grossProfitMinor: toRange(collect('grossProfitMinor'), exp.grossProfitMinor, widen),
    blendedRevenueEfficiencyAfter: toRange(collect('blendedRevenueEfficiencyAfter'), exp.blendedRevenueEfficiencyAfter, widen),
  };

  // ── Assumptions: every named driver of the range, stated plainly ──
  const assumptions = [];
  for (const [label, r] of Object.entries(bands)) {
    const verb = change.type === SCENARIO_TYPE.CHANNEL_REALLOCATION ? 'moved' : 'added';
    assumptions.push(`${label}: ${verb} budget retains ${Math.round(r * 100)}% of marginal efficiency`);
  }
  if (change.type === SCENARIO_TYPE.BUDGET_EXPANSION) {
    assumptions.push(`diminishing returns above +${Math.round(DIMINISHING_RETURNS_KNEE * 100)}% per-channel spend swing`);
  }
  assumptions.push(
    hasMemory
      ? `memory accuracy ${Math.round(accuracy * 100)}% widened the band by ±${Math.round(widen * 100)}%`
      : `no learned memory yet — assumed ${Math.round(accuracy * 100)}% prior (band widened ±${Math.round(widen * 100)}%)`,
  );

  // Confidence: memory accuracy is the dominant term, dampened when the
  // baseline is thin (few channels carrying spend).
  const spendingChannels = baseline.filter((c) => c.spendMinor > 0).length;
  const depth = Math.min(1, spendingChannels / 3);
  const confidence = Math.max(0, Math.min(1, Math.round((0.4 + 0.5 * accuracy) * depth * 100) / 100));

  // Basis: surface the CAC↔profit trade-off explicitly (the CEO lens).
  const cacWorse    = projections.blendedCacMinor.expected != null && exp.blendedCacMinor != null;
  const profitBetter = projections.grossProfitMinor.expected > 0;
  let basis = `${change.type}: projected as a range under ${Object.keys(bands).length} retention assumptions`;
  if (change.type === SCENARIO_TYPE.BUDGET_EXPANSION && profitBetter) {
    basis += ' — CAC may rise, but gross profit grows (CAC worse / profit better)';
  }
  void cacWorse;

  logger.debug({ type: change.type, confidence, widen }, '[ScenarioEngine] projected');
  return { scenarioType: change.type, change, currency, projections, assumptions, confidence, basis };
}
