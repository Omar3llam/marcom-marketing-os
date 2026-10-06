// ============================================================
// DecisionAccuracyEngine — the Proof Engine (pure, deterministic)
// ============================================================
// Public API: calculateDecisionAccuracy({ decisions, outcomes, now, config })
//   → { accountLift, calibration, velocity, coverage }
//
// DETERMINISM CONTRACT:
//   Same input + injected `now` → byte-identical output. No DB, no clock, no
//   randomness inside the engine. A Proof Engine that isn't reproducible can't
//   prove anything (it's the proof itself that has to be testable).
//
// ISOLATION CONTRACT:
//   DecisionAccuracyService loads the real rows (Decisions EXECUTED|DISMISSED +
//   their OutcomeSnapshots, workspace-scoped) and feeds this engine; nothing
//   here reads the DB or the clock.
//
// THE HEADLINE IS CALIBRATION, NOT ACCURACY:
//   A model can be 72% accurate and badly miscalibrated. Only calibration
//   proves that `confidence` itself means something — that a 90%-confidence call
//   actually succeeds ~90% of the time. ECE is the headline; Brier is the
//   binning-free backstop (when they disagree, trust Brier and widen the bins).
//   The LEARNING-VELOCITY curve (calibration error falling as the account ages)
//   is the flagship claim — accountLift is its one-number summary. Both are
//   gated: below minSample they return INSUFFICIENT_DATA, never a bare %.
//
// DEFERRED (documented so it isn't rediscovered):
//   §5.3 — recalibrating future Decision.confidence toward observed rates (the
//     loop-closing step) is OUT OF SCOPE; do it only once velocity shows the
//     estimate is stable, and NEVER into report-confidence (§2.4 boundary).
//   §8  — Decision Regret (magnitude layer) is V2, verdict-relative like §2.1.
// ============================================================
import {
  COVERAGE_VERDICT, LIFT_STATUS, CALIBRATION_DIRECTION, MATURITY,
  DEFAULT_CONFIG, SUCCESS_PREDICATES, SCORABLE_VERDICT,
} from './accuracyTypes.js';
// B4-A — the one definition of "when was this acted on". Pure; no DB, no clock,
// so the engine's determinism contract above is untouched.
import { interventionAt } from '../execution/decisionProvenance.js';

const r4 = (n) => Math.round(n * 1e4) / 1e4;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object}   args
 * @param {Array}    args.decisions — the engine's INPUT contract, built by
 *   DecisionAccuracyService.buildAccuracyInputs. Not raw Decision rows:
 *   [{ id, verdict, confidence, accuracyStatus, createdAt,
 *      humanExecutedAt?, platformExecutedAt?, outcome? }]
 *   `accuracyStatus` is DERIVED from the provenance timestamps and is not the
 *   stored Decision.status. The two timestamps are read by `windowStart` via
 *   decisionProvenance.interventionAt; the deprecated `executedAt` is not an
 *   input here and passing it anchors every window to `createdAt` instead.

 * @param {Array}   [args.outcomes] — optional [{ decisionId, ... }] joined by id if `outcome` absent
 * @param {Date}     args.now       — injected; the engine never reads the clock
 * @param {object}  [args.config]
 */
export function calculateDecisionAccuracy({ decisions = [], outcomes = null, now = new Date(), config = {} } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();

  // Optional separate outcomes array → index by decisionId.
  const outcomeById = new Map();
  if (Array.isArray(outcomes)) {
    for (const o of outcomes) if (o && o.decisionId) outcomeById.set(o.decisionId, o);
  }

  // ── 1. Classify maturity + score each decision ──────────────────
  const scored = [];          // { id, confidence, success(0|1), createdAt }
  let pendingMaturation = 0;
  let unscorable = 0;
  let dismissed = 0;
  let notAPrediction = 0;

  for (const d of decisions) {
    if (d.accuracyStatus === 'DISMISSED') { dismissed += 1; continue; } // survivorship: counted, never scored
    if (d.accuracyStatus !== 'EXECUTED') continue;                      // PROPOSED is not a realized prediction

    if (!SCORABLE_VERDICT[d.verdict]) { notAPrediction += 1; continue; }

    const outcome = d.outcome ?? outcomeById.get(d.id) ?? null;
    const m = classifyMaturity(d, outcome, nowMs, cfg);

    if (m === MATURITY.PENDING_MATURATION) { pendingMaturation += 1; continue; }
    if (m === MATURITY.UNSCORABLE) { unscorable += 1; continue; }

    // SCORED candidate — apply the per-verdict predicate.
    const predicate = SUCCESS_PREDICATES[d.verdict];
    const ok = predicate ? predicate(outcome, cfg) : null;
    if (ok == null) { unscorable += 1; continue; } // mature but missing the field the predicate needs

    // C-16 — a calibration measures a STATED probability against reality. A
    // decision with no measured confidence states none, so it is UNSCORABLE:
    // the same bucket, and the same meaning — mature, but missing the field
    // this measurement needs. Before C-16 the column was NOT NULL, so clamp01's
    // `: 0` fallback was unreachable; now it is not, and admitting the row
    // would enter the Brier score and the bins as a CLAIM of 0% confidence — a
    // maximally-wrong prediction Lumi never made, on the surface that is the
    // moat. It stays in the coverage denominator, so the account reads as less
    // measured rather than better calibrated.
    if (!Number.isFinite(d.confidence)) { unscorable += 1; continue; }

    // Prisma supplies a non-null DateTime, but the pure input seam can be
    // called directly. Refuse malformed issuance evidence without changing
    // scored membership or substituting an execution/outcome/current instant.
    const issuedAt = d.createdAt == null ? NaN : new Date(d.createdAt).getTime();
    if (!Number.isFinite(issuedAt)) throw new RangeError('Scored decision requires a valid issuance timestamp');

    scored.push({
      id: d.id,
      confidence: clamp01(d.confidence),
      success: ok ? 1 : 0,
      createdAt: issuedAt,
    });
  }

  // Chronological order — load-bearing for windows + velocity.
  scored.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ── 2. Coverage (the UI reads this first) ───────────────────────
  const scoredCount = scored.length;
  const matureEligible = scoredCount + unscorable; // executed-and-mature
  const scoredFraction = matureEligible > 0 ? r4(scoredCount / matureEligible) : 0;
  let verdict;
  if (scoredCount < cfg.minSample) verdict = COVERAGE_VERDICT.INSUFFICIENT_DATA;
  else if (scoredFraction < cfg.reliableFraction) verdict = COVERAGE_VERDICT.THIN;
  else verdict = COVERAGE_VERDICT.RELIABLE;

  const coverage = {
    totalDecisions: decisions.length,
    scored: scoredCount,
    unscorable,
    pendingMaturation,
    dismissed,
    notAPrediction,
    scoredFraction,
    verdict,
    note: dismissed > 0
      ? `calibration measured on executed decisions only; ${dismissed} dismissed calls are not represented`
      : 'calibration measured on executed decisions only',
  };

  // ── 3. Calibration (the real proof) ─────────────────────────────
  const calibration = computeCalibration(scored, cfg);

  // ── 4. Account lift (the headline → a sales sentence) ───────────
  const accountLift = computeAccountLift(scored, cfg);

  // ── 5. Learning velocity (the flagship curve) ───────────────────
  const velocity = computeVelocity(scored, cfg);

  return { accountLift, calibration, velocity, coverage };
}

// ── Maturity classification (§2.2) ────────────────────────────────
/**
 * The instant the outcome window opens.
 *
 * `interventionAt` when SOMEONE acted, `createdAt` otherwise. The distinction is
 * causal, not cosmetic: measuring from issuance charges the result for however
 * long the verdict sat unread in a queue, so a call acted on three weeks late
 * reads as mature when its intervention is three days old.
 *
 * B4-A — the field is named for the QUESTION, not for a column. It is projected
 * at the seam (buildAccuracyInputs) as the earliest of `humanExecutedAt` and
 * `platformExecutedAt`, because the window opens when the campaign first
 * changed and it does not matter here who changed it. The old name was
 * `executedAt`, which after the provenance split would have forced every reader
 * of this engine to ask which kind of execution it meant.
 *
 * The fallback is for LEGACY rows only — every decision written before the
 * human-signal routes existed has no intervention instant and never will. It measures a
 * window that includes unread time and is the less causally honest of the two;
 * it is here because the alternative is dropping those rows entirely, and their
 * issuance date is a real fact even if it answers a slightly different question.
 *
 * Deliberately NOT applied to the velocity curve, which bins by `createdAt` on
 * purpose: that axis is "when did the engine make calls", and re-anchoring it to
 * execution would reorder the learning curve by how fast the operator responded.
 */
const windowStart = (decision) => interventionAt(decision) ?? decision.createdAt;

// EXPORTED for R10 (I53), semantics untouched. The Pattern Engine needs the same
// answer to "is this outcome mature enough to score" that the Proof Engine uses,
// and the only two ways to give it one are to export this function or to write a
// second copy of it. A second copy is precisely the duplicate definition I53
// forbids — and the copy would drift, because this one is the version with the
// tests. Adding `export` changes no behaviour and no caller here.
export function classifyMaturity(decision, outcome, nowMs, cfg) {
  const ageMs = nowMs - new Date(windowStart(decision)).getTime();
  const matured = ageMs >= cfg.maturationDays * DAY_MS;

  if (!outcome) {
    // No outcome row captured. Too young → pending; past the deadline → a gap.
    return matured ? MATURITY.UNSCORABLE : MATURITY.PENDING_MATURATION;
  }
  // Outcome window explicitly still open.
  if (outcome.windowEnd != null && nowMs < new Date(outcome.windowEnd).getTime()) {
    return MATURITY.PENDING_MATURATION;
  }
  // sustained still unresolved — pending if young, a data gap if past the deadline.
  if (outcome.sustained == null) {
    return matured ? MATURITY.UNSCORABLE : MATURITY.PENDING_MATURATION;
  }
  return MATURITY.SCORED;
}

// ── Reliability binning + ECE + Brier ─────────────────────────────
function computeCalibration(scored, cfg) {
  const n = scored.length;
  if (n === 0) {
    return {
      bins: [], binEdges: [0, 1], expectedCalibrationError: null, brierScore: null,
      accuracy: null, direction: CALIBRATION_DIRECTION.CALIBRATED, sampleSize: 0, populationSpan: null,
    };
  }

  // Brier — binning-free proper scoring rule.
  const brier = r4(scored.reduce((s, d) => s + (d.confidence - d.success) ** 2, 0) / n);

  // Choose the finest bin count whose every NON-EMPTY bin has ≥ minBinCount,
  // collapsing down the ladder otherwise (never show a bin too small to mean
  // anything). Fall back to a single bin.
  let chosen = 1;
  for (const b of cfg.binFallbacks) {
    const counts = binCounts(scored, b);
    const ok = counts.every((c) => c === 0 || c >= cfg.minBinCount);
    if (ok) { chosen = b; break; }
  }

  const { bins, edges } = buildBins(scored, chosen);
  // ECE = Σ (count/N) · |observed − predicted|
  const ece = r4(bins.reduce((s, bin) => s + (bin.count / n) * Math.abs(bin.observed - bin.predicted), 0));

  const meanPredicted = mean(scored.map((d) => d.confidence));
  const meanObserved = mean(scored.map((d) => d.success));
  const gap = meanPredicted - meanObserved;
  const direction = gap > cfg.liftEpsilon ? CALIBRATION_DIRECTION.OVERCONFIDENT
    : gap < -cfg.liftEpsilon ? CALIBRATION_DIRECTION.UNDERCONFIDENT
      : CALIBRATION_DIRECTION.CALIBRATED;

  return {
    bins,
    binEdges: edges,
    expectedCalibrationError: ece,
    brierScore: brier,
    accuracy: r4(meanObserved), // raw success rate — reported, but SECONDARY to ECE
    direction,
    sampleSize: n,
    populationSpan: {
      basis: 'DECISION_ISSUED_AT',
      from: new Date(scored[0].createdAt).toISOString(),
      to: new Date(scored[n - 1].createdAt).toISOString(),
    },
  };
}

function binIndex(confidence, b) {
  const idx = Math.floor(confidence * b);
  return idx >= b ? b - 1 : idx < 0 ? 0 : idx; // confidence===1 lands in the top bin
}

function binCounts(scored, b) {
  const counts = new Array(b).fill(0);
  for (const d of scored) counts[binIndex(d.confidence, b)] += 1;
  return counts;
}

function buildBins(scored, b) {
  const buckets = Array.from({ length: b }, () => []);
  for (const d of scored) buckets[binIndex(d.confidence, b)].push(d);
  const edges = Array.from({ length: b + 1 }, (_, i) => r4(i / b));
  // Edges describe the entire chosen grid. Public rows describe observations
  // only: a grid hole has no prediction, observed rate or calibration gap.
  const bins = buckets.flatMap((items, i) => {
    const count = items.length;
    if (count === 0) return [];
    const predicted = r4(mean(items.map((d) => d.confidence)));
    const observed = r4(mean(items.map((d) => d.success)));
    return [{
      band: `${Math.round(edges[i] * 100)}-${Math.round(edges[i + 1] * 100)}%`,
      predicted, observed, count, gap: r4(Math.abs(observed - predicted)),
    }];
  });
  return { bins, edges };
}

// ── Account lift: early window vs recent window (§3) ───────────────
function computeAccountLift(scored, cfg) {
  const n = scored.length;
  const insufficient = () => ({
    earlyWindow: null, recentWindow: null,
    calibrationImprovementPct: null, status: LIFT_STATUS.INSUFFICIENT_DATA,
  });
  if (n < cfg.minSample * 2) return insufficient();

  let early, recent;
  if (n >= cfg.fullWindowMin) {
    early = scored.slice(0, cfg.earlyRecentSplit);
    recent = scored.slice(n - cfg.earlyRecentSplit);
  } else {
    const third = Math.floor(n / 3);
    early = scored.slice(0, third);
    recent = scored.slice(n - third);
  }
  if (early.length < cfg.minSample || recent.length < cfg.minSample) return insufficient();

  const earlyWindow = windowStats(early, cfg);
  const recentWindow = windowStats(recent, cfg);

  // Improvement = how much ECE fell from early to recent (positive = better).
  const improvementPct = earlyWindow.calibrationError > 0
    ? r4((earlyWindow.calibrationError - recentWindow.calibrationError) / earlyWindow.calibrationError)
    : null;
  // P7-06A — a zero baseline has no relative percentage, but its measured
  // direction is known: zero stays flat; any positive recent error is worse.
  const status = earlyWindow.calibrationError === 0 && recentWindow.calibrationError > 0
    ? LIFT_STATUS.DEGRADING
    : improvementPct == null ? LIFT_STATUS.FLAT
    : improvementPct > cfg.liftEpsilon ? LIFT_STATUS.IMPROVING
      : improvementPct < -cfg.liftEpsilon ? LIFT_STATUS.DEGRADING
        : LIFT_STATUS.FLAT;

  return { earlyWindow, recentWindow, calibrationImprovementPct: improvementPct, status };
}

function windowStats(items, cfg) {
  const cal = computeCalibration(items, cfg);
  return {
    // R13-C — null, never 0. 0 is the BEST possible ECE ("perfectly
    // calibrated"), so coercing an absent measurement into it states the
    // strongest claim the metric can make about a window nothing was measured
    // on.
    //
    // CURRENTLY UNREACHABLE, and kept anyway. computeCalibration returns a null
    // ECE on exactly one path — an EMPTY input — and windowStats is only ever
    // called with a slice that already passed the minSample floor. So this is a
    // latent fabrication, not a live one: it activates the day computeCalibration
    // gains a second null path (a bin ladder that collapses to nothing, a future
    // predicate that scores nothing in-window). The unreachability is pinned in
    // calibrationNullSemantics.test.js rather than assumed, so a change that
    // opens that path fails there instead of shipping a perfect score.
    calibrationError: cal.expectedCalibrationError ?? null,
    accuracy: cal.accuracy ?? null,
    sampleSize: items.length,
    span: {
      from: new Date(items[0].createdAt).toISOString(),
      to: new Date(items[items.length - 1].createdAt).toISOString(),
    },
  };
}

// ── Learning velocity: ECE per calendar period + slope (§3) ────────
function computeVelocity(scored, cfg) {
  const empty = { periods: [], trend: LIFT_STATUS.INSUFFICIENT_DATA, slope: null };
  if (scored.length < cfg.minSample) return empty;

  const byPeriod = new Map();
  for (const d of scored) {
    const label = periodLabel(d.createdAt, cfg.velocityPeriod);
    if (!byPeriod.has(label)) byPeriod.set(label, []);
    byPeriod.get(label).push(d);
  }

  const rawPeriods = [...byPeriod.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([label, items]) => ({
      label,
      // R13-C — null, never 0, for the same reason as windowStats above, and
      // with the same status: a period group is built from at least one item, so
      // computeCalibration's only null path (empty input) is not reachable from
      // here today. Latent, not live. The renderer decides how to show a period
      // that could not be measured; it must never be handed a perfect score
      // standing in for one.
      calibrationError: computeCalibration(items, cfg).expectedCalibrationError ?? null,
      sampleSize: items.length,
    }));

  return calculateVelocityTrend(rawPeriods, cfg);
}

// Pure seam for the nullable-period contract: ordinary non-empty cohorts still
// produce numeric ECE. Membership is published once, and the fit consumes that
// exact authority. With fewer than two qualifying periods no fit is possible,
// but their membership remains visible beside INSUFFICIENT_DATA / null slope.
export function calculateVelocityTrend(rawPeriods, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const periods = rawPeriods.map((period) => ({
    ...period,
    includedInTrend: period.sampleSize >= cfg.minSample && period.calibrationError != null,
  }));
  const fit = periods.filter((period) => period.includedInTrend);
  if (fit.length < 2) return { periods, trend: LIFT_STATUS.INSUFFICIENT_DATA, slope: null };

  const slope = r4(linregSlope(fit.map((p, i) => [i, p.calibrationError])));
  const trend = slope < -cfg.velocitySlopeEps ? LIFT_STATUS.IMPROVING
    : slope > cfg.velocitySlopeEps ? LIFT_STATUS.DEGRADING
      : LIFT_STATUS.FLAT;
  return { periods, trend, slope };
}

function periodLabel(ms, period) {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  if (period === 'WEEKLY') {
    const day = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }
  return `${y}-${mo}`; // MONTHLY default
}

// ── Small deterministic numeric helpers ───────────────────────────
function clamp01(n) { return typeof n === 'number' && !Number.isNaN(n) ? Math.max(0, Math.min(1, n)) : 0; }
function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }
function linregSlope(points) {
  const n = points.length;
  const sx = points.reduce((s, p) => s + p[0], 0);
  const sy = points.reduce((s, p) => s + p[1], 0);
  const sxx = points.reduce((s, p) => s + p[0] * p[0], 0);
  const sxy = points.reduce((s, p) => s + p[0] * p[1], 0);
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}
