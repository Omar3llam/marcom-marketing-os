// ============================================================
// Decision-Accuracy — shared types, per-verdict success predicates,
// the coverage/lift/calibration enums, and the gated surface helper.
// ============================================================
// THE PROOF DISCIPLINE (the design's first principle):
//   This engine answers the one unproven question in the whole architecture —
//   does "Learn" actually improve decision quality, or just store memories?
//   A Proof Engine that overstates learning is WORSE than none: it turns a
//   measurable thesis back into a confident story — the exact failure the
//   product exists to avoid. So every choice here takes the honest reading:
//   calibration (not accuracy) is the headline, immature outcomes are EXCLUDED
//   (never counted as failures), survivorship is made VISIBLE (not papered
//   over), and a claim is SUPPRESSED unless coverage is RELIABLE.
//
// THE BOUNDARY (§2.4 — load-bearing, enforced by a test):
//   This module must NEVER import from narrative-engine/narrativeTypes.js.
//   `confidenceScore()` there is REPORT-confidence — how much evidence backs a
//   narrative. `Decision.confidence` here is DECISION-confidence — P(this call
//   succeeds). They are different quantities; mixing them destroys the metric.
//   This file reads only Decision.confidence and OutcomeSnapshot fields.
// ============================================================

// ── Enums ────────────────────────────────────────────────────────
export const COVERAGE_VERDICT = Object.freeze({
  RELIABLE:          'RELIABLE',
  THIN:              'THIN',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
});

export const LIFT_STATUS = Object.freeze({
  IMPROVING:         'IMPROVING',
  FLAT:              'FLAT',
  DEGRADING:         'DEGRADING',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
});

export const CALIBRATION_DIRECTION = Object.freeze({
  OVERCONFIDENT:  'OVERCONFIDENT',
  UNDERCONFIDENT: 'UNDERCONFIDENT',
  CALIBRATED:     'CALIBRATED',
});

// Three-state maturity — NEVER two. Treating an immature null as "failure"
// would make recent decisions score worse purely because they're recent,
// manufacturing a fake "degrading" signal (§2.2).
export const MATURITY = Object.freeze({
  SCORED:             'SCORED',             // window closed, sustained known → counts
  PENDING_MATURATION: 'PENDING_MATURATION', // not yet due → excluded from every num/denom
  UNSCORABLE:         'UNSCORABLE',          // past deadline, no usable outcome → data-quality gap
  NOT_A_PREDICTION:   'NOT_A_PREDICTION',    // WATCH — "not deciding yet", out of accuracy entirely
});

// ── Config ───────────────────────────────────────────────────────
export const DEFAULT_CONFIG = Object.freeze({
  maturationDays:    7,    // outcome window; a decision younger than this with no result is pending
  minSample:         30,   // floor below which lift/velocity refuse to emit a claim
  minBinCount:       20,   // a reliability bin below this is collapsed, never shown raw
  bins:              10,    // start at deciles
  binFallbacks:      Object.freeze([10, 5, 4, 2, 1]), // collapse ladder
  earlyRecentSplit:  50,   // first-50 vs latest-50 windows; fall back to thirds under 100 scored
  fullWindowMin:     100,  // ≥ this many scored → use fixed-size windows, else thirds
  holdTolerance:     0.10, // a HOLD is "right" if |roasDelta| ≤ this (no material adverse move)
  reliableFraction:  0.50, // scoredFraction ≥ this (and ≥ minSample scored) → RELIABLE, else THIN
  liftEpsilon:       0.05, // |improvementPct| ≤ this → FLAT
  velocitySlopeEps:  0.005,// |slope| ≤ this → FLAT trend
  velocityPeriod:    'MONTHLY',
});

// ── Per-verdict success predicates (§2.1) ────────────────────────
// The single most important correctness decision in the service. "Success" is
// VERDICT-RELATIVE: a successful KILL produces LESS spend and often less revenue
// — scoring all verdicts by one rule (e.g. roasDelta > 0) makes Lumi look worst
// exactly where it is most decisive. Each predicate takes a MATURE outcome and
// returns boolean (right/wrong) or null (missing the field it needs → UNSCORABLE).
const isNum = (v) => typeof v === 'number' && !Number.isNaN(v);

export const SUCCESS_PREDICATES = Object.freeze({
  // The bleed stopped and stayed stopped. Revenue falling is EXPECTED, not failure.
  KILL: (o) => (isNum(o.spendDeltaMinor) ? (o.spendDeltaMinor < 0 && o.sustained !== false) : null),

  // It returned at higher spend AND held (not a one-day spike).
  SCALE: (o) => (isNum(o.roasDelta) ? (o.roasDelta >= 0 && o.sustained === true) : null),

  // No material adverse move — stayed inside the tolerance band.
  //
  // HOLD IS A PREDICTION, WHICH IS WHY IT HAS A PREDICATE AT ALL. It asks for no
  // intervention, but it does make a falsifiable claim: "this is stable, leave
  // it." Reality can contradict that, so it is scorable. Contrast WATCH below,
  // which claims nothing ("I am not deciding yet") and is therefore a category
  // error to score. Executability is NOT the axis here — neither verdict has a
  // Meta action. The axis is whether the engine asserted something checkable.
  //
  // Scored on |roasDelta| rather than direction: a HOLD is not "right" because
  // things got better, only because nothing materially bad happened. A big move
  // in EITHER direction means the call to leave it alone was wrong — an upside
  // surprise is a missed SCALE.
  //
  // CURRENTLY UNREACHABLE, DELIBERATELY KEPT. No HOLD can enter this population
  // today. The population is decisions carrying humanExecutedAt,
  // platformExecutedAt or dismissedAt (DecisionAccuracyService.ACTIONED); the
  // human ones come only from
  // DecisionLifecycle's buttons, that component mounts only inside ActionBar,
  // and ActionBar returns null when nextActionFor(verdict) is null — which it is
  // for HOLD. The Overview mount is gated on ACTIONABLE_VERDICTS
  // (KILL/REALLOCATE), so it does not reach HOLD either.
  //
  // So this predicate is correct and never runs. It is not dead code to delete:
  // deleting it would assert that HOLD is not a prediction, which is false, and
  // would have to be rebuilt the day intentional non-action becomes recordable.
  // Whether a marketer should be able to say "I let this ride" is an open
  // PRODUCT question (#355 discovery), not a code cleanup.
  HOLD: (o, cfg) => (isNum(o.roasDelta) ? Math.abs(o.roasDelta) <= cfg.holdTolerance : null),

  // Portfolio-level: the freed budget's new home outperformed its old one.
  REALLOCATE: (o) => (isNum(o.roasDelta) ? o.roasDelta >= 0 : null),

  // Post-swap recovery vs pre-swap (roasDelta/sustained proxy until a CTR series is wired).
  REFRESH: (o) => {
    if (!isNum(o.roasDelta) && o.sustained == null) return null;
    return (isNum(o.roasDelta) && o.roasDelta > 0) || o.sustained === true;
  },

  // A WATCH is "I'm not deciding yet" — scoring it as a prediction is a category error.
  WATCH: () => null,
});

// Verdicts that are predictions at all (WATCH is not).
//
// HOLD true / WATCH false is the one line here that looks like an oversight and
// is not. Both are non-executable; they differ on whether a claim was made.
// HOLD predicts stability and can be wrong; WATCH says "I am not deciding yet"
// and cannot be. MATURITY.NOT_A_PREDICTION exists for exactly the second case.
// See SUCCESS_PREDICATES.HOLD above for why HOLD's entry is currently unreachable
// and kept anyway.
export const SCORABLE_VERDICT = Object.freeze({
  KILL: true, SCALE: true, HOLD: true, REALLOCATE: true, REFRESH: true, WATCH: false,
});

// ── The gated surface helper (§5.1 / §6 — the highest-stakes line) ─
/**
 * Turn an accuracy result into a surface payload. THE HARD GATE: a calibration
 * claim is emitted ONLY when coverage.verdict === RELIABLE. Below that the
 * surface carries no lift claim and no calibration number — only an honest
 * "still learning" line (the N/M are sample counts, not a calibration figure).
 * Suppression is enforced by a test, not by the politeness of a default.
 *
 * @param {object} result — the calculateDecisionAccuracy() contract
 * @returns {{ gated:boolean, headline:string, status:string|null,
 *             calibrationErrorPct:number|null, improvementPct:number|null,
 *             scored:number, needed:number }}
 */
export function accuracySurface(result, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const coverage = result?.coverage ?? {};
  // R13-C — a count we do not have is not a count of zero. `scored` is a real
  // number on every result the engine produces; it is missing only when there is
  // no result at all, and "0 decisions scored" is a claim about the account that
  // nothing measured.
  const scored = typeof coverage.scored === 'number' ? coverage.scored : null;

  if (coverage.verdict !== COVERAGE_VERDICT.RELIABLE) {
    return {
      gated: true,
      headline: scored == null
        ? 'Still learning this account'
        : `Still learning this account (${scored} decisions scored, need ${cfg.minSample})`,
      status: null,
      calibrationErrorPct: null, // SUPPRESSED — no calibration number below RELIABLE
      improvementPct: null,
      scored,
      needed: cfg.minSample,
    };
  }

  const lift = result.accountLift ?? {};
  // R13-C — the second gate, and the one that was missing.
  //
  // `coverage.verdict === RELIABLE` needs minSample scored decisions.
  // computeAccountLift needs minSample * 2 before it will split into an early
  // and a recent window, and returns BOTH as null below that. So every account
  // between those two thresholds reached this branch with no windows at all —
  // and `?? 0` turned that into the headline "calibration error 0% (was 0% in
  // your first window) — holding steady". An ECE of 0% is PERFECT calibration.
  // The surface was telling accounts with no measurable lift that Lumi had never
  // been wrong, on Home and on Proof, and returning 0 in `calibrationErrorPct`
  // one branch after the gated path deliberately suppressed it to null.
  //
  // Coverage says the account has enough scored decisions to talk about; lift
  // says whether there is enough to talk about CHANGE. They are different
  // questions and now have different answers.
  const recentEce = lift.recentWindow?.calibrationError ?? null;
  const earlyEce = lift.earlyWindow?.calibrationError ?? null;
  const pctOf = (v) => (v == null ? null : Math.round(v * 100));
  const recentEcePct = pctOf(recentEce);
  const earlyEcePct = pctOf(earlyEce);
  const improvementPct = lift.calibrationImprovementPct == null
    ? null
    : Math.round(lift.calibrationImprovementPct * 100);
  const verb = lift.status === LIFT_STATUS.IMPROVING ? 'improving'
    : lift.status === LIFT_STATUS.DEGRADING ? 'degrading' : 'holding steady';

  // No recent window ⇒ no calibration number and no trend verb. The account IS
  // reliably covered, which is worth saying; what cannot be said is how the
  // error is moving.
  if (recentEcePct == null) {
    return {
      gated: false,
      headline: scored == null
        ? 'Lumi\'s calls on this account are being scored — not enough history yet to measure whether calibration is improving'
        : `Lumi's calls on this account are being scored (${scored} decisions) — not enough history yet to measure whether calibration is improving`,
      status: LIFT_STATUS.INSUFFICIENT_DATA,
      calibrationErrorPct: null,
      improvementPct: null,
      scored,
      needed: cfg.minSample,
    };
  }

  return {
    gated: false,
    headline: `Lumi's calls on this account: calibration error ${recentEcePct}% `
      // The first window can be absent while the recent one is not. Saying
      // "was 0%" there would invent the best possible starting point and turn a
      // real improvement into a fabricated regression.
      + (earlyEcePct == null ? '' : `(was ${earlyEcePct}% in your first window) `)
      + `— ${verb}`,
    status: lift.status ?? null,
    calibrationErrorPct: recentEcePct,
    improvementPct,
    scored,
    needed: cfg.minSample,
  };
}
