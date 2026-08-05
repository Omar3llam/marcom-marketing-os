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
import { logger }                        from '../../utils/logger.js';

// Verdict thresholds (frozen for auditability).
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
  MIN_DAYS: 3,
});

export { MIN_IMPRESSIONS };
export const MIN_DAYS = V.MIN_DAYS;
// The saturation ceiling, exported so evidenceProvider grades frequency against
// the SAME number this engine judges it by. A re-typed 3.5 there would drift the
// first time this one is tuned.
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
 *   rootCause, signalType, funnel, recommendationTypes }}
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
    switch (dx.signalType) {
      case SIGNAL_TYPE.CREATIVE_FATIGUE:
        verdict = VERDICT.REFRESH; confidence = dx.confidence;
        rationale = 'Creative fatigue detected — refresh the creative to reset engagement.';
        break;
      case SIGNAL_TYPE.LOW_CTR:
        verdict = VERDICT.REFRESH; confidence = dx.confidence;
        rationale = 'Weak hook — refresh creative to lift CTR.';
        break;
      case SIGNAL_TYPE.INEFFICIENT_SCALING:
        verdict = VERDICT.REALLOCATE; confidence = dx.confidence;
        rationale = 'Budget is not converting efficiently — reallocate to a stronger entity.';
        break;
      case SIGNAL_TYPE.AUDIENCE_MISMATCH:
        verdict = VERDICT.REALLOCATE; confidence = dx.confidence;
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
    rationale: result.rationale,
    rootCause: result.rootCause,
    signalType: result.signalType,
    funnel: result.funnel,
    recommendationTypes: result.recommendationTypes,
  };
}
