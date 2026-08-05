// ============================================================
// signalProjector — Stage 3: signals → hypotheses
// ============================================================
// Public API:
//   deriveReasoningConfidence({ observations, declined, signalType })
//   projectHypotheses(dxResult, dataConfidence)
//
// TWO functions, deliberately separate:
//   ReasoningEngine  — how strongly the evidence converges on ONE mechanism
//   SignalProjector  — turn the diagnosis envelope into hypotheses
// Separate because the first is a scoring policy that will be tuned, and the
// second is a shape. Folding the score into the mapper would make every
// recalibration a change to the projection contract.
//
// DETERMINISM CONTRACT:
//   Same input → same output. No DB, no LLM, no randomness, no clock.
//
// ISOLATION CONTRACT:
//   Never writes to DB / enqueues / calls routes. Emits no verdict.
//
// SCOPE — what this file deliberately does NOT do:
//   No composed confidence. `confidence` carries `reasoning` and `data` as two
//   separate numbers and no third. Multiplying them here would produce a figure
//   Stage 4 must then combine with urgency and timing — and a `composed` key
//   that means one thing today and another after Stage 4 lands is worse than an
//   absent one. confidenceEngine.composeConfidence is the only place two
//   confidences ever become one, and it is not called from here.
//
//   Nothing is persisted. Hypotheses are a READ-TIME artifact, re-derived from
//   the same signals every time. There is no Decision column for them.
// ============================================================
import { SIGNAL_TYPE, MECHANISM_SUPPORT } from '../diagnosis-engine/diagnosisTypes.js';
// The severity ladder — imported, not re-typed. NOTE there are three exported
// `SEVERITY` enums in this codebase with different members and different casing;
// this is evidenceProvider's critical/high/medium/low/healthy one, which is the
// ladder signalRules' obs() stamps onto every observation. evidenceProvider is a
// leaf (it imports only benchmarkProvider and confidenceEngine), so this edge
// closes no cycle.
import { SEVERITY } from './evidenceProvider.js';

// An observation's `status` vocabulary. Only two words are ever emitted, and the
// client whitelists exactly these; a null status (an ungraded figure, e.g. SPEND
// against no benchmark) is neither and must fall out of both filters.
const WEAK    = 'weak';
const HEALTHY = 'healthy';

/** Terminal states are not mechanisms — they can never become a hypothesis. */
const TERMINAL = Object.freeze([SIGNAL_TYPE.HEALTHY, SIGNAL_TYPE.UNDIAGNOSABLE]);

/**
 * PURE: does a healthy reading on `metric` argue against `signalType`?
 *
 * Only if the metric is one this mechanism is evidenced BY. An unknown signal
 * type has no support list, so nothing contradicts it — silence, not a throw:
 * a new enum member must not make the reasoning layer crash before anyone has
 * written its support map.
 */
export function isContradiction(metric, signalType) {
  return (MECHANISM_SUPPORT[signalType] ?? []).includes(metric);
}

/** PURE: the graded observations from every declined rule, flattened. */
const declinedObservations = (declined) =>
  (Array.isArray(declined) ? declined : []).flatMap((d) => d?.observations ?? []);

/**
 * PURE: how strongly the evidence converges on this mechanism.
 *
 * This is the SIGNAL half of confidence — the half that was a frozen literal
 * (0.85 / 0.80 / 0.75 / 0.70) attached to the rule rather than to what was
 * actually measured. A rule that fires on one marginal reading and a rule that
 * fires on two critical ones scored identically.
 *
 * Three inputs, in order of weight:
 *   supports    — this signal's own observations that came back weak
 *   contradicts — healthy readings left by DECLINED rules, on metrics
 *                 MECHANISM_SUPPORT says belong to THIS mechanism
 *   severity    — how far past its bar each supporting reading is
 *
 * Not wired into the verdict's confidence yet. `evaluateVerdict` still composes
 * the rule's literal with dataConfidence; swapping in this number changes every
 * stored confidence in the system and belongs in its own change, with its own
 * before/after. See PR#317's report.
 *
 * @returns {number} 0.10–0.95. Never 0 (a rule DID fire) and never 1.0 (the
 *   same reason confidenceEngine caps at MAX_CONFIDENCE: platform-reported
 *   numbers carry attribution error invisible from here).
 */
export function deriveReasoningConfidence({ observations, declined, signalType }) {
  const supports = (Array.isArray(observations) ? observations : [])
    .filter((o) => o?.status === WEAK);

  const contradicts = declinedObservations(declined)
    .filter((o) => o?.status === HEALTHY && isContradiction(o.metric, signalType));

  // A fired rule with nothing weak to show for it. Reachable through the legacy
  // singular-diagnosis shape, which carries no observations at all. The floor
  // says "something fired but we cannot show you why" rather than scoring it
  // like a well-evidenced finding.
  if (!supports.length) return 0.3;

  // Denominator is never 0: the early return guarantees at least one support.
  const supportRatio = supports.length / (supports.length + contradicts.length);

  // Capped: three critical readings are not three times the finding one is, and
  // an uncapped bonus would let severity alone reach the ceiling.
  const criticalCount = supports.filter((o) => o.severity === SEVERITY.CRITICAL).length;
  const severityBonus = Math.min(criticalCount * 0.08, 0.15);

  const contradictionPenalty = contradicts.length * 0.12;

  const raw = supportRatio + severityBonus - contradictionPenalty;
  return Math.min(Math.max(Math.round(raw * 100) / 100, 0.1), 0.95);
}

/**
 * PURE: accept either diagnosis shape.
 *
 * diagnoseSignals returns the { signals[], declined[] } envelope, but
 * evaluateVerdict's `diagnosis` override is documented to accept a singular
 * pre-picked signal too. Reading `.signals` off that shape yields undefined,
 * and destructuring it to `[]` would return NO hypotheses for a real diagnosis
 * — an empty array that looks exactly like "healthy", with nothing thrown.
 */
function toEnvelope(dxResult) {
  if (!dxResult || typeof dxResult !== 'object') return { signals: [], declined: [] };
  if (Array.isArray(dxResult.signals)) {
    return {
      signals:  dxResult.signals,
      declined: Array.isArray(dxResult.declined) ? dxResult.declined : [],
    };
  }
  // A singular signal carries no declined siblings — it was picked before we saw them.
  return dxResult.signalType ? { signals: [dxResult], declined: [] } : { signals: [], declined: [] };
}

/** PURE: an observation, stripped to the fields a hypothesis states. */
const stated = ({ metric, value, benchmark, severity }) => ({ metric, value, benchmark, severity });

/**
 * PURE: project a diagnosis envelope into ranked hypotheses.
 *
 * One hypothesis per FIRED mechanism, in the order diagnoseSignals ranked them.
 * HEALTHY and UNDIAGNOSABLE are dropped: they are terminal states, not
 * candidate explanations. "Nothing is wrong" and "we could not look" are both
 * real answers, and both are answers the VERDICT carries — a hypothesis list
 * containing them would invite a consumer to render "we could not look" as a
 * proposed explanation with a confidence attached to it.
 *
 * @param {object} dxResult — diagnoseSignals() output, or a singular signal.
 * @param {number|null} [dataConfidence=null] — input quality from
 *   confidenceEngine.computeConfidence. NULL, not 0.5, when unknown: 0.5 is a
 *   fabricated middle that reads as a real measurement, and `finalise` already
 *   carries null for exactly this case. Passed straight through, never scored.
 * @returns {Array<{id, labelKey, observed, supports, contradicts, confidence}>}
 *   `[]` when nothing fired — a real answer, not a failure.
 */
export function projectHypotheses(dxResult, dataConfidence = null) {
  const { signals, declined } = toEnvelope(dxResult);

  return signals
    .filter((s) => s && !TERMINAL.includes(s.signalType))
    .map((signal) => {
      const observations = Array.isArray(signal.observations) ? signal.observations : [];

      // What this hypothesis rests on: the readings that came back weak. An
      // ungraded figure (SPEND, which has no bar) is excluded — it is context,
      // and listing it as support would claim a number failed a bar nobody set.
      const observed = observations.filter((o) => o?.status === WEAK).map(stated);

      // What argues against it: healthy readings from rules that RAN and
      // declined, on this mechanism's own metrics.
      const contradicts = declinedObservations(declined)
        .filter((o) => o?.status === HEALTHY && isContradiction(o.metric, signal.signalType))
        .map(stated);

      return {
        // The enum key, never a rendered string — the taxonomy rule in
        // diagnosisTypes ("do not add dynamic labels") applies to anything that
        // crosses this boundary, and a localizable UI cannot key off prose.
        id:       signal.signalType,
        labelKey: signal.diagnosis,
        observed,
        // Metric names only. The rows are already in `observed`; this is the
        // at-a-glance list, and duplicating the figures in two shapes would let
        // them disagree.
        supports: observed.map((o) => o.metric),
        contradicts,
        confidence: {
          reasoning: deriveReasoningConfidence({
            observations,
            declined,
            signalType: signal.signalType,
          }),
          data: dataConfidence,
          // No `composed` key. See the scope note at the top of this file.
        },
      };
    });
}
