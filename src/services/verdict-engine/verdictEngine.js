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
import { VERDICT, VERDICT_TO_REC_TYPES } from './verdictTypes.js';
import { logger }                        from '../../utils/logger.js';

// Verdict thresholds (frozen for auditability).
const V = Object.freeze({
  BREAKEVEN_ROAS:   1.0, // ROAS below this is losing money
  FATIGUE_FREQ:     3.5, // saturation ceiling
  SCALE_ROAS:       3.0, // strong enough to scale
  SCALE_CTR:        2.0, // % — healthy hook for scaling
  // Awareness track — used ONLY when revenue was never measured (roas null). These
  // judge reach/engagement campaigns on frequency + CTR alone; they NEVER emit a
  // revenue verdict (KILL/SCALE) from data that doesn't exist.
  AWARENESS_FATIGUE_CTR:     1.0, // % — CTR floor that, paired with FATIGUE_FREQ, = creative fatigue → REFRESH
  AWARENESS_SATURATION_FREQ: 3.0, // × — frequency rising toward saturation → WATCH
  AWARENESS_WEAK_CTR:        0.5, // % — CTR below benchmark → HOLD
});

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
    roas:        revenueMeasured ? agg.revenueMinor / agg.spendMinor : null,
    revenueMeasured,
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
 * @returns {{ verdict, confidence, rationale, signalType, recommendationTypes }}
 */
export function evaluateVerdict({ level, metrics, diagnosis, guardrailHits = [], revenueExpected = false }) {
  if (!metrics || typeof metrics !== 'object') {
    throw new Error('evaluateVerdict: metrics is required');
  }
  const dx = diagnosis ?? diagnoseSignals(metrics);
  // revenueMeasured defaults TRUE: a direct caller passing a real roas keeps the
  // pre-awareness behavior; rollupVerdicts always sets it explicitly (toSignalInput).
  const { roas = 0, frequency = 0, ctr = 0, revenueMeasured = true } = metrics;

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
    if (frequency >= V.FATIGUE_FREQ && ctr < V.AWARENESS_FATIGUE_CTR) {
      verdict = VERDICT.REFRESH; confidence = 0.7;
      rationale = `${noun}: frequency ${frequency.toFixed(1)} past the ${V.FATIGUE_FREQ} ceiling with CTR ${ctr.toFixed(2)}% below ${V.AWARENESS_FATIGUE_CTR}% — refresh the creative. Based on engagement only.`;
    } else if (frequency >= V.AWARENESS_SATURATION_FREQ) {
      verdict = VERDICT.WATCH; confidence = 0.6;
      rationale = `${noun}: audience frequency ${frequency.toFixed(1)} rising toward saturation — monitor. Based on engagement only.`;
    } else if (ctr < V.AWARENESS_WEAK_CTR) {
      verdict = VERDICT.HOLD; confidence = 0.5;
      rationale = `${noun}: CTR ${ctr.toFixed(2)}% below the ${V.AWARENESS_WEAK_CTR}% benchmark — hold and monitor. Based on engagement only.`;
    } else {
      verdict = VERDICT.HOLD; confidence = 0.5;
      rationale = `${noun}: engagement healthy — hold. Based on engagement only.`;
    }
  } else if (roas < V.BREAKEVEN_ROAS && frequency >= V.FATIGUE_FREQ) {
    // Critical decline: losing money AND saturated → KILL (overrides signal).
    verdict = VERDICT.KILL;
    confidence = 0.9;
    rationale = `ROAS ${roas.toFixed(2)} below break-even with frequency ${frequency.toFixed(1)} past the ${V.FATIGUE_FREQ} ceiling.`;
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
      case SIGNAL_TYPE.HEALTHY:
      default:
        if (roas >= V.SCALE_ROAS && ctr >= V.SCALE_CTR) {
          verdict = VERDICT.SCALE; confidence = 0.8;
          rationale = `Strong ROAS ${roas.toFixed(2)} with healthy CTR ${ctr.toFixed(2)}% — scale.`;
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

  return {
    verdict,
    confidence,
    rationale,
    signalType: dx.signalType,
    recommendationTypes: [...VERDICT_TO_REC_TYPES[verdict]],
  };
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
  const result = evaluateVerdict({ level: node.level, metrics: signalInput, guardrailHits, revenueExpected: node.revenueExpected });

  logger.debug({ id: node.id, level: node.level, verdict: result.verdict }, '[VerdictEngine] node verdict');

  return {
    ...node,
    children,
    metrics: agg,
    signalInput,
    verdict: result.verdict,
    verdictConfidence: result.confidence,
    rationale: result.rationale,
    signalType: result.signalType,
    recommendationTypes: result.recommendationTypes,
  };
}
