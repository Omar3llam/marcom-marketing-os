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
  return {
    ctr:         impressions > 0 ? (clicks / impressions) * 100 : 0, // percent
    cpc:         clicks > 0 ? spend / clicks : 0,
    cpm:         impressions > 0 ? (spend / impressions) * 1000 : 0,
    frequency:   agg.frequency ?? 0,
    spend,
    conversions,
    roas:        agg.spendMinor > 0 ? agg.revenueMinor / agg.spendMinor : 0,
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
 * @returns {{ verdict, confidence, rationale, signalType, recommendationTypes }}
 */
export function evaluateVerdict({ level, metrics, diagnosis, guardrailHits = [] }) {
  if (!metrics || typeof metrics !== 'object') {
    throw new Error('evaluateVerdict: metrics is required');
  }
  const dx = diagnosis ?? diagnoseSignals(metrics);
  const { roas = 0, frequency = 0, ctr = 0 } = metrics;

  let verdict;
  let confidence;
  let rationale;

  // Critical decline: losing money AND saturated → KILL (overrides signal).
  if (roas < V.BREAKEVEN_ROAS && frequency >= V.FATIGUE_FREQ) {
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
  const result = evaluateVerdict({ level: node.level, metrics: signalInput, guardrailHits });

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
