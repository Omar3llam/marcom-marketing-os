// ============================================================
// VerdictEngine — multi-level marketing verdicts
// ============================================================
// Public API:
//   evaluateVerdict({ level, metrics, diagnosis?, guardrailHits? })
//   rollupVerdicts(entityTree)
//
// DETERMINISM CONTRACT:
//   Same input → same output. No randomness, no LLM, no DB, no
//   timestamps. (Mirrors DiagnosisEngine / RecommendationEngine.)
//
// ISOLATION CONTRACT:
//   Never writes to DB / enqueues / calls routes. Callers own
//   persistence (see VerdictService → Decision rows).
//
// The core idea: a verdict is computed at EVERY entity level from
// that level's ROLLED-UP metrics. Because every level derives from
// the same rolled-up numbers, the verdicts are consistent with the
// rollup yet independent — a campaign can be SCALE while a child ad
// set is KILL.
// ============================================================
import { diagnoseSignals, SIGNAL_TYPE } from '../diagnosis-engine/index.js';
import { fromMinor }                     from '../../lib/money.js';
import { VERDICT, VERDICT_TO_REC_TYPES, ROOT_CAUSE } from './verdictTypes.js';
// ALIASED ON PURPOSE — do not "tidy" this back to a plain FATIGUE_FREQ import.
// This module also EXPORTS a binding of that name for readers outside the
// verdict engine, and an import plus a same-named const in one module is a
// load-time SyntaxError ("Identifier 'FATIGUE_FREQ' has already been declared").
// The two land in different regions of the file, so git merges them without a
// conflict and nothing catches it until the server fails to boot.
import { getBenchmarks, FATIGUE_FREQ as SATURATION_CEILING } from './benchmarkProvider.js';
import { diagnoseFunnel }                from './funnelDiagnosis.js';
import { computeConfidence, composeConfidence, MIN_IMPRESSIONS } from './confidenceEngine.js';
import { projectHypotheses }             from './signalProjector.js';
import { buildCounterfactuals }          from './counterfactualEngine.js';
import { logger }                        from '../../utils/logger.js';

// Verdict thresholds (frozen for auditability).
//
// ── WINDOW (canonical contract, see metricWindow.js) ────────────────────────
// Every threshold below judges a metric measured over the CANONICAL VERDICT
// WINDOW — 30 days (CANONICAL_VERDICT_WINDOW_DAYS). Not the sync preset, not
// the newest row's period.
//
// CALIBRATION: UNKNOWN. None of these values was derived from a study against a
// 30-day population — or against any population. They predate the window
// contract and are recorded here as-is on purpose: adopting a canonical window
// must not silently become a threshold change (see metricWindow.js Phase G,
// where the regression suite forces every changed verdict to be explained).
// So these numbers are NOT evidence for what the window should be, and the
// window is not evidence that they are right. Both are open questions; only the
// first has now been answered.
//
// The window is documented here rather than imported because these constants
// need no runtime value from it — an import for a comment's sake would add a
// module edge that buys nothing.
//
// NOTE on CTR: the CTR bars used to live here as global constants, so a lead-gen
// campaign and a reach campaign were judged against the same 0.5% floor — and a
// 0.9% CTR was called a "weak hook" on a campaign whose objective makes 0.9%
// strong. CTR thresholds now come from benchmarkProvider, keyed on the campaign
// objective the connector already threads through. What remains here is
// genuinely objective-independent.
const V = Object.freeze({
  BREAKEVEN_ROAS:   1.0, // ROAS below this is losing money
  // Saturation ceiling — the SINGLE source now lives in benchmarkProvider, so
  // the diagnosis engine grades frequency by the same number this one judges it
  // by. Kept on V so every existing V.FATIGUE_FREQ reader is unchanged.
  FATIGUE_FREQ: SATURATION_CEILING,
  SCALE_ROAS:       3.0, // strong enough to scale
  // Awareness track — used ONLY when revenue was never measured (roas null). These
  // judge reach/engagement campaigns on frequency + CTR alone; they NEVER emit a
  // revenue verdict (KILL/SCALE) from data that doesn't exist.
  AWARENESS_SATURATION_FREQ: 3.0, // × — frequency rising toward saturation → WATCH
  // Minimum days on the platform before a verdict is worth emitting. Layer 7:
  // "< 3 days = too early (even with good numbers)".
  //
  // The ONE threshold on this object that is NOT window-dependent: it measures
  // campaign AGE from platformCreatedTime, not a metric over a period. It means
  // the same thing whatever the canonical window is, and a window change must
  // not touch it.
  MIN_DAYS: 3,
});

export { MIN_IMPRESSIONS };
export const MIN_DAYS = V.MIN_DAYS;
// The saturation ceiling. The CANONICAL source is benchmarkProvider, and every
// current reader goes there directly — the diagnosis engine and evidenceProvider
// both must, since neither can import this module without closing a cycle. This
// binding is a convenience re-export for a reader already holding verdictEngine;
// it has no importers today. It is also the reason the import above is aliased,
// and why removing that alias breaks the boot.
export const FATIGUE_FREQ = V.FATIGUE_FREQ;

/**
 * Aggregate raw metrics for a node from its annotated children, or
 * return the node's own leaf metrics. Money sums; ratios derive from
 * the rolled-up totals; frequency is impression-weighted.
 *
 * @param {object} node
 * @param {Array<{metrics:object}>} children — already-annotated children
 * @returns {{spendMinor,revenueMinor,impressions,clicks,conversions,frequency}}
 */
export function aggregateMetrics(node, children = []) {
  if (!children.length) {
    const m = node.metrics ?? {};
    return {
      spendMinor:   m.spendMinor   ?? 0,
      revenueMinor: m.revenueMinor ?? 0,
      impressions:  m.impressions  ?? 0,
      clicks:       m.clicks       ?? 0,
      conversions:  m.conversions  ?? 0,
      frequency:    m.frequency    ?? 0,
    };
  }

  const agg = { spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0, frequency: 0 };
  let freqWeight = 0;
  for (const child of children) {
    const cm = child.metrics;
    agg.spendMinor   += cm.spendMinor;
    agg.revenueMinor += cm.revenueMinor;
    agg.impressions  += cm.impressions;
    agg.clicks       += cm.clicks;
    agg.conversions  += cm.conversions;
    // impression-weighted frequency (frequency is per-audience, not additive)
    agg.frequency += (cm.frequency ?? 0) * (cm.impressions ?? 0);
    freqWeight    += (cm.impressions ?? 0);
  }
  agg.frequency = freqWeight > 0 ? agg.frequency / freqWeight : 0;
  return agg;
}

/**
 * Convert aggregated raw metrics into the signal-input shape that
 * diagnoseSignals + the verdict thresholds consume.
 */
export function toSignalInput(agg, currency = 'USD') {
  const spend       = fromMinor(agg.spendMinor, currency);
  const impressions = agg.impressions ?? 0;
  const clicks      = agg.clicks ?? 0;
  const conversions = agg.conversions ?? 0;
  // revenueMeasured = a positive CLAIMED revenue against real spend. Otherwise roas
  // is null ("not measured") — NOT 0. Forcing 0 would read as "terrible ROAS" and
  // fabricate a KILL from data that doesn't exist (the awareness/reach case). The
  // engine routes on this flag: revenue verdicts when true, the awareness track
  // when false.
  const revenueMeasured = agg.revenueMinor > 0 && agg.spendMinor > 0;
  return {
    ctr:         impressions > 0 ? (clicks / impressions) * 100 : 0, // percent
    cpc:         clicks > 0 ? spend / clicks : 0,
    cpm:         impressions > 0 ? (spend / impressions) * 1000 : 0,
    frequency:   agg.frequency ?? 0,
    spend,
    conversions,
    // Minor units + the account's real currency, for the diagnosis rules. The
    // major-unit `spend`/`cpc` above stay for the verdict thresholds that already
    // read them — these are ADDITIVE, not a replacement. Money thresholds belong
    // in minor units like the rest of the system; comparing a major-unit float
    // against a constant is how the diagnosis engine ended up calling 50 EGP
    // "$50". null (never 0) when the denominator was never measured, so a rule
    // that needs a real CPC declines rather than reading 0 as "free clicks".
    spendMinor:  agg.spendMinor ?? null,
    cpcMinor:    clicks > 0 && agg.spendMinor != null ? agg.spendMinor / clicks : null,
    currency,
    roas:        revenueMeasured ? agg.revenueMinor / agg.spendMinor : null,
    revenueMeasured,
    // Raw counts carried alongside the ratios. The minimum-sample gate needs the
    // DENOMINATOR, not just the rate: a 3.0% CTR off 40 impressions and off
    // 400,000 are the same number and completely different evidence. These also
    // feed the funnel rates, which are per-click, not per-impression.
    impressions,
    clicks,
  };
}

/**
 * Deterministically map a diagnosis signal + metrics → a verdict.
 *
 * @param {object} args
 * @param {string} args.level
 * @param {object} args.metrics — signal-input shape (incl. roas)
 * @param {object} [args.diagnosis] — diagnoseSignals() result; computed if absent
 * @param {Array}  [args.guardrailHits] — guardrail verdicts already raised for this entity
 * @param {boolean} [args.revenueExpected] — channel-agnostic flag (the connector
 *   derives it from the campaign objective): when a campaign with no measured
 *   revenue was SUPPOSED to convert, its no-revenue verdict is framed as a
 *   tracking gap, not awareness. Defaults false (legacy/awareness wording).
 * @param {string|null} [args.objective] — platform objective; selects the CTR
 *   benchmark band. null falls to DEFAULT (see benchmarkProvider).
 * @param {object|null} [args.actionMetrics] — the funnel bag; null = funnel-blind
 * @param {number|null} [args.daysRunning] — days since PLATFORM creation. null
 *   means unknown, which SKIPS the too-early gate rather than assuming day 0.
 * @returns {{ verdict, confidence, signalConfidence, dataConfidence, rationale,
 *   rootCause, signalType, funnel, declined, hypotheses, counterfactuals,
 *   recommendationTypes }}
 *   `declined`, `hypotheses` and `counterfactuals` are read-time reasoning
 *   artifacts — computed here, carried on the verdict, persisted nowhere.
 */
export function evaluateVerdict({
  level, metrics, diagnosis, guardrailHits = [], revenueExpected = false,
  objective = null, actionMetrics = null, daysRunning = null, createdTime = null,
}) {
  if (!metrics || typeof metrics !== 'object') {
    throw new Error('evaluateVerdict: metrics is required');
  }
  // revenueMeasured defaults TRUE: a direct caller passing a real roas keeps the
  // pre-awareness behavior; rollupVerdicts always sets it explicitly (toSignalInput).
  const { roas = 0, frequency = 0, ctr = 0, revenueMeasured = true, impressions, clicks } = metrics;
  const b = getBenchmarks(objective);

  // ── Data-quality confidence ─────────────────────────────────────────────────
  // Computable only when the sample size is actually known. A legacy direct
  // caller that passes ratios without impressions gets `null` here and keeps the
  // rule's own confidence unchanged — we do not manufacture a data-quality score
  // out of data we were never given. rollupVerdicts always supplies impressions,
  // so every connector-path verdict is composed.
  const sampleKnown = Number.isFinite(impressions);
  const dataConfidence = sampleKnown
    ? computeConfidence({ impressions, daysRunning, actionMetrics, objective, createdTime })
    : null;
  const finalise = (v, signalConfidence, why, extra = {}) => ({
    verdict: v,
    // The number callers act on: signal strength × input quality. NEVER a frozen
    // literal on the connector path — that was the defect. See confidenceEngine.
    confidence: dataConfidence == null ? signalConfidence : composeConfidence(signalConfidence, dataConfidence),
    // Both halves stay visible so a reader can tell "weak signal" from "thin data".
    // On the mechanism track `signalConfidence` is now the DERIVED reasoning
    // confidence (see the switch); on every other branch it is that branch's own
    // number, and on the gates below it is a literal 1.0.
    signalConfidence,
    dataConfidence,
    rationale: why,
    rootCause: extra.rootCause ?? null,
    signalType: extra.signalType ?? null,
    funnel: extra.funnel ?? null,
    // Rules that ran and declined, with their passing measurements — what a
    // counterfactual is built from. Empty on the early gates, which return
    // before any rule is evaluated.
    declined: extra.declined ?? [],
    // Candidate explanations, one per fired mechanism, each with its own
    // reasoning confidence. Re-derived from the same signals on every
    // evaluation, and — on the sweep that persists a verdict — frozen onto
    // Decision.hypotheses as the record of what was believed at that moment.
    // Empty on the early gates for the same reason `declined` is: no rule has
    // run yet, which is a real state and NOT the same as the null a row written
    // before that column existed carries.
    //
    // Read from `extra`, NEVER from the enclosing scope. `hypotheses` and
    // `counterfactuals` are declared BELOW the two gate returns, so a closure
    // reference here would throw "Cannot access before initialization" on every
    // campaign under 1 000 impressions or under 3 days — at runtime only, on the
    // paths a happy-path test never reaches. `dataConfidence` above is safe
    // because it is declared before this function.
    hypotheses: extra.hypotheses ?? [],
    // Why each alternative hypothesis was set aside. Empty whenever there is
    // fewer than one alternative to argue against.
    counterfactuals: extra.counterfactuals ?? [],
    recommendationTypes: [...VERDICT_TO_REC_TYPES[v]],
  });

  // ── GATE 1: minimum sample ─────────────────────────────────────────────────
  // Layer 7: "< 1000 impressions = no verdict possible". This runs BEFORE every
  // scoring branch, so a thin campaign can never be KILLed — previously the only
  // gate was impressions > 0, and a 12-impression row got a 0.9-confidence KILL.
  // Skipped when impressions is unknown (a legacy caller), never assumed zero.
  if (sampleKnown && impressions < MIN_IMPRESSIONS) {
    return finalise(
      VERDICT.WATCH, 1.0,
      // The COUNTS are the point, so they sit before the separator: an evidence
      // line reading only "Insufficient data" tells the user nothing they can
      // act on, while "120 of 1,000 impressions" tells them how far off they are.
      `Insufficient data: ${impressions.toLocaleString('en-US')} of ${MIN_IMPRESSIONS.toLocaleString('en-US')} impressions needed — too thin to judge yet.`,
      { rootCause: ROOT_CAUSE.INSUFFICIENT_DATA },
    );
  }

  // ── GATE 2: minimum days ───────────────────────────────────────────────────
  // Real traffic, but not enough elapsed time for it to mean anything — Meta's
  // own learning phase has not resolved. null daysRunning skips this honestly:
  // an unknown creation date is a gap in our ingestion, not evidence of youth.
  if (daysRunning != null && daysRunning < V.MIN_DAYS) {
    return finalise(
      VERDICT.WATCH, 1.0,
      `Too early to score: day ${daysRunning} of ${V.MIN_DAYS} minimum — early numbers move while delivery is still settling.`,
      { rootCause: ROOT_CAUSE.TOO_EARLY },
    );
  }

  // objective threads through so the rules judge CTR against THIS campaign's bar
  // rather than one global 0.5% floor — the same correction benchmarkProvider
  // already made for the verdict thresholds.
  //
  // diagnoseSignals now returns { signals[], declined[] }. `signals[0]` is the
  // highest-confidence fired rule — which reproduces the old first-match-wins
  // exactly, because the rule table is ordered by descending confidence. The
  // `diagnosis` override is still accepted in EITHER shape: a caller holding a
  // pre-picked singular signal keeps working.
  const dxResult = diagnosis ?? diagnoseSignals(metrics, { objective });
  const dx = Array.isArray(dxResult?.signals) ? dxResult.signals[0] : dxResult;
  // The counterfactual material — every rule that RAN and declined, carrying the
  // measurements that rule it out. Computed once by the diagnosis engine and
  // carried onto the verdict rather than discarded here: re-deriving it later
  // would mean re-running the rules against numbers that may have moved.
  const declined = Array.isArray(dxResult?.declined) ? dxResult.declined : [];

  // Stage 3: the fired mechanisms as candidate explanations, each scored on how
  // its own evidence converges rather than on the rule's frozen literal. The
  // switch below now takes its signal strength from here (see the four mechanism
  // cases) instead of from `dx.confidence`.
  //
  // `source` records WHICH PASS produced this reasoning. Everything built here is
  // the ABSOLUTE pass: one entity judged against its own thresholds. A later
  // relative upgrade re-decides the verdict from cohort rank and leaves these
  // untouched, so without the tag a consumer cannot tell reasoning that DECIDED a
  // verdict from reasoning that merely accompanied it.
  const hypotheses = projectHypotheses(dxResult, dataConfidence)
    .map((h) => ({ ...h, source: 'absolute' }));

  // Why the mechanisms below the primary were set aside. Built from the
  // hypotheses alone — every contradiction was already resolved against
  // MECHANISM_SUPPORT in the projector, and re-deriving it from `declined` here
  // would put a second copy of that predicate in the codebase.
  const counterfactuals = buildCounterfactuals(hypotheses);

  // Where in the funnel the money is going, when the funnel was measured at all.
  // Computed once and always attached, even when it does not decide the verdict —
  // a KILL is more useful when it also says the landing page was the reason.
  const funnel = diagnoseFunnel({ ctr, actionMetrics, clicks, objective });

  let verdict;
  let confidence;
  let rationale;

  if (!revenueMeasured) {
    // ── NO-REVENUE TRACK ───────────────────────────────────────────────────
    // Revenue was never measured (roas null). Judge on ENGAGEMENT only and NEVER
    // emit a revenue verdict (KILL/SCALE) — a roas threshold here would fabricate
    // a verdict from data that doesn't exist. The verdict TIERS below are
    // unchanged; only the framing differs: a genuine awareness/reach campaign has
    // no revenue by design, but a CONVERSION campaign (revenueExpected) with no
    // measured revenue is a TRACKING GAP — name it honestly instead of calling it
    // awareness. Every rationale still names its basis; roas stays null downstream.
    const noun = revenueExpected
      ? 'Conversion campaign — no conversion value measured (verify conversion tracking)'
      : 'Awareness campaign (no revenue measured)';
    // CTR bars are the objective's, not one global number: `b.ctr.strong` is the
    // "still performing" bar a fatigued creative has fallen below, `b.ctr.weak`
    // the floor. For an unknown objective these are DEFAULT (1.5 / 0.8), which
    // preserves the behaviour of the constants they replaced.
    if (frequency >= V.FATIGUE_FREQ && ctr < b.ctr.strong) {
      verdict = VERDICT.REFRESH; confidence = 0.7;
      rationale = `${noun}: frequency ${frequency.toFixed(1)} past the ${V.FATIGUE_FREQ} ceiling with CTR ${ctr.toFixed(2)}% below the ${b.ctr.strong}% bar for this objective — refresh the creative. Based on engagement only.`;
    } else if (frequency >= V.AWARENESS_SATURATION_FREQ) {
      verdict = VERDICT.WATCH; confidence = 0.6;
      rationale = `${noun}: audience frequency ${frequency.toFixed(1)} rising toward saturation — monitor. Based on engagement only.`;
    } else if (ctr < b.ctr.weak) {
      verdict = VERDICT.HOLD; confidence = 0.5;
      rationale = `${noun}: CTR ${ctr.toFixed(2)}% below the ${b.ctr.weak}% benchmark for this objective — hold and monitor. Based on engagement only.`;
    } else {
      verdict = VERDICT.HOLD; confidence = 0.5;
      rationale = `${noun}: engagement healthy — hold. Based on engagement only.`;
    }
  } else if (roas < V.BREAKEVEN_ROAS && frequency >= V.FATIGUE_FREQ) {
    // Critical decline: losing money AND saturated → KILL (overrides signal).
    verdict = VERDICT.KILL;
    confidence = 0.9;
    rationale = `ROAS ${roas.toFixed(2)} below break-even with frequency ${frequency.toFixed(1)} past the ${V.FATIGUE_FREQ} ceiling.`;
  } else if (funnel) {
    // ── FUNNEL TRACK ───────────────────────────────────────────────────────
    // A measured stage-to-stage drop-off beats the generic signal rules, which
    // see only CTR/CPC/conversions and therefore answer every shortfall with
    // "refresh the creative" or "reallocate". Both are the WRONG action when the
    // ads are working and the landing page, offer, or checkout is not — and a
    // creative refresh here destroys the one part that was performing.
    //
    // The verdict is WATCH, not REFRESH/REALLOCATE/KILL: none of the three
    // funnel faults is fixable by any action this system can take on the ad
    // platform. Saying so plainly, with the stage named, is the useful answer.
    verdict = VERDICT.WATCH;
    confidence = funnel.confidence;
    // ONE em-dash, and it is the separator. The Campaigns UI shows the clause
    // before the first ' — ' as its evidence line, so everything that must
    // survive on its own goes first. See the parser-safety block in
    // verdictEngine.gates.test.js, which pins this contract.
    rationale = `${funnel.diagnosis} (${funnel.stage}) — ${funnel.counterfactual} ${funnel.action}.`;
  } else {
    // ── THE MECHANISM TRACK ────────────────────────────────────────────────
    // The four cases below are the ONLY place the rule's frozen literal
    // (0.85 / 0.80 / 0.75 / 0.70) was ever the verdict's signal strength, and
    // therefore the only place the derived reasoning confidence replaces it.
    //
    // `mechanismConfidence` is hypotheses[0]'s — which IS the projection of `dx`:
    // dx is signals[0], and projectHypotheses drops only terminal states, so
    // whenever the switch lands on one of these four, signals[0] is non-terminal
    // and hypotheses[0] is its hypothesis. On HEALTHY / UNDIAGNOSABLE the list is
    // empty and the fallback stands.
    //
    // Every OTHER branch keeps its own number, deliberately. The awareness tiers
    // (0.7 / 0.6 / 0.5), the KILL at 0.9, and the funnel's own confidence are not
    // rule literals — they are that branch's measure of its own evidence, and the
    // funnel one is about a stage-to-stage drop-off the diagnosis rules never saw.
    // Overwriting them with a mechanism's score would attach a number derived from
    // CTR and frequency to a verdict decided by a broken checkout.
    const mechanismConfidence = hypotheses[0]?.confidence?.reasoning ?? dx.confidence;
    switch (dx.signalType) {
      case SIGNAL_TYPE.CREATIVE_FATIGUE:
        verdict = VERDICT.REFRESH; confidence = mechanismConfidence;
        rationale = 'Creative fatigue detected — refresh the creative to reset engagement.';
        break;
      case SIGNAL_TYPE.LOW_CTR:
        verdict = VERDICT.REFRESH; confidence = mechanismConfidence;
        rationale = 'Weak hook — refresh creative to lift CTR.';
        break;
      case SIGNAL_TYPE.INEFFICIENT_SCALING:
        verdict = VERDICT.REALLOCATE; confidence = mechanismConfidence;
        rationale = 'Budget is not converting efficiently — reallocate to a stronger entity.';
        break;
      case SIGNAL_TYPE.AUDIENCE_MISMATCH:
        verdict = VERDICT.REALLOCATE; confidence = mechanismConfidence;
        rationale = 'Targeting mismatch — reallocate budget toward a better audience.';
        break;
      // No rule could be evaluated — the fields they read were never reported.
      // WATCH, not HOLD: falling through to the healthy branch would have this
      // entity report "within healthy parameters", a claim about numbers we
      // never saw. Confidence is low on purpose — this is an admission, not a
      // finding. (Unreachable while toSignalInput zero-fills ctr/frequency;
      // wired now so it does not become live silently when that stops.)
      case SIGNAL_TYPE.UNDIAGNOSABLE:
        verdict = VERDICT.WATCH; confidence = 0.3;
        rationale = 'Not enough reported signal to diagnose this entity — monitoring without a diagnosis.';
        break;
      case SIGNAL_TYPE.HEALTHY:
      default:
        if (roas >= V.SCALE_ROAS && ctr >= b.ctr.strong) {
          verdict = VERDICT.SCALE; confidence = 0.8;
          rationale = `Strong ROAS ${roas.toFixed(2)} with CTR ${ctr.toFixed(2)}% above the ${b.ctr.strong}% bar for this objective — scale.`;
        } else {
          verdict = VERDICT.HOLD; confidence = 0.7;
          rationale = 'Within healthy parameters — hold and keep monitoring.';
        }
        break;
    }
  }

  // A guardrail hit on this entity never silences a stronger verdict, but it
  // can raise a HOLD to WATCH (a soft, user-defined flag worth a human look).
  if (guardrailHits.length && verdict === VERDICT.HOLD) {
    verdict = VERDICT.WATCH;
    rationale = `Guardrail flagged: ${guardrailHits.map((h) => h.rationale).join('; ')}`;
  }

  // rootCause carries the funnel stage when the funnel decided this, so the
  // learning query can group "WATCHes caused by a broken landing page" apart from
  // "WATCHes caused by thin data" — they have nothing in common but the label.
  return finalise(verdict, confidence, rationale, {
    rootCause: funnel?.signal ?? null,
    signalType: dx.signalType,
    funnel,
    declined,
    hypotheses,
    counterfactuals,
  });
}

/**
 * Walk an entity tree (Account → Campaign → AdSet → Ad → Creative)
 * and annotate EVERY node with a verdict computed from that node's
 * rolled-up metrics. Returns a new tree (input is not mutated).
 *
 * Node shape:
 *   { id, level, name?, currency?, metrics?, children? }
 *   - leaves carry `metrics` (spendMinor/revenueMinor/impressions/clicks/
 *     conversions/frequency); internal nodes derive theirs by rollup.
 *
 * @param {object} node
 * @param {object} [opts]
 * @param {string} [opts.currency='USD']
 * @param {Map<string,Array>} [opts.guardrailHitsByEntity]
 * @returns {object} annotated node (verdict, confidence, rationale, metrics, …)
 */
export function rollupVerdicts(node, opts = {}) {
  if (!node || typeof node !== 'object') {
    throw new Error('rollupVerdicts: node must be an object');
  }
  const currency = node.currency ?? opts.currency ?? 'USD';
  const hitsByEntity = opts.guardrailHitsByEntity;

  const children = Array.isArray(node.children)
    ? node.children.map((c) => rollupVerdicts(c, { ...opts, currency }))
    : [];

  const agg = aggregateMetrics(node, children);
  const signalInput = toSignalInput(agg, currency);
  const guardrailHits = hitsByEntity?.get(node.id) ?? [];
  // revenueExpected rides on the leaf (the connector derives it from the campaign
  // objective); internal/rollup nodes leave it undefined → default false wording.
  //
  // objective / actionMetrics / daysRunning ride on the leaf the same way. They
  // are deliberately NOT rolled up: a mixed-objective account has no single
  // objective, and summing two campaigns' funnels would invent a stage-to-stage
  // rate that no campaign actually had. An internal node therefore leaves them
  // null and is judged on the objective-agnostic rules — which is honest, and the
  // reason getConnectorVerdicts reads the CHILD rows, not the rollup.
  const result = evaluateVerdict({
    level: node.level,
    metrics: signalInput,
    guardrailHits,
    revenueExpected: node.revenueExpected,
    objective:     node.objective ?? null,
    actionMetrics: node.actionMetrics ?? null,
    daysRunning:   node.daysRunning ?? null,
    createdTime:   node.platformCreatedTime ?? null,
  });

  logger.debug({ id: node.id, level: node.level, verdict: result.verdict }, '[VerdictEngine] node verdict');

  return {
    ...node,
    children,
    metrics: agg,
    signalInput,
    verdict: result.verdict,
    verdictConfidence: result.confidence,
    // The data-quality half, kept on the node so a LATER pass (relativeRanking)
    // can compose its own signal strength against the same inputs instead of
    // stamping a frozen literal over a computed number.
    dataConfidence: result.dataConfidence,
    // The signal half. It had been computed on every verdict since the engine
    // existed and named in NEITHER allowlist, so the payload published a product
    // and one of its two factors — leaving a reader unable to tell a weak signal
    // from thin data, which is the exact distinction the two halves exist for.
    signalConfidence: result.signalConfidence,
    rationale: result.rationale,
    rootCause: result.rootCause,
    signalType: result.signalType,
    funnel: result.funnel,
    recommendationTypes: result.recommendationTypes,
    // ── The reasoning artifacts ──────────────────────────────────────────────
    // This return is a hand-picked allowlist over `result` (everything on the
    // INPUT node rides through `...node` above, but nothing on `result` does).
    // A field omitted here can never reach connectorVerdictService, which reads
    // these off the NODE — which is why `declined` and `hypotheses` existed on
    // the verdict for two PRs and were visible to nothing.
    //
    // These survive applyRelativeRanking untouched: that pass spreads `...c` and
    // overwrites only verdict / verdictConfidence / rationale /
    // recommendationTypes / relativeRank. So a campaign upgraded to a relative
    // KILL still carries the hypotheses the ABSOLUTE pass computed — exactly as
    // it already carries that pass's rootCause and signalType. Each hypothesis
    // now says so itself (`source: 'absolute'`).
    //
    // `signalConfidence` is the one field the upgrade DOES re-stamp, with the
    // cohort ranking's own strength — so the published triple multiplies out on
    // every row. See the golden test in decisionEngine.test.js.
    //
    // TODO: have the upgrade path stamp `source: 'relative'` on hypotheses it
    // did not derive, so a consumer can tell at the hypothesis level which pass
    // is speaking.
    declined:        result.declined        ?? [],
    hypotheses:      result.hypotheses      ?? [],
    counterfactuals: result.counterfactuals ?? [],
  };
}
