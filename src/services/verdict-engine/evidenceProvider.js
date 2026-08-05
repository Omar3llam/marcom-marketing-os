// ============================================================
// evidenceProvider — Stage 1 evidence, ranked and severity-graded
// ============================================================
// Public API: analyzeEvidence({ dimension, entities, baseline, objective, metric, now })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No DB, no LLM, no randomness, and NO CLOCK —
//   `now` is a parameter, exactly as confidenceEngine's daysSince takes it. A
//   Date.now() read inside would make a stored analysis irreproducible from its
//   own inputs, which is the property the whole verdict-engine directory holds.
//
// SCOPE — Stage 1 ONLY:
//   This ranks entities against a measured parent baseline and grades how far
//   each has fallen. It emits NO verdict, NO hypothesis, and NO counterfactual.
//   `dataConfidence` is named for what it is: input quality, not belief in a
//   conclusion. The reasoning confidence that Stage 3 produces composes with it
//   via confidenceEngine.composeConfidence — which is why this file does not
//   call that function.
//
// TWO KINDS OF EVIDENCE (why `kind` exists):
//   A null benchmark is ambiguous on its own — it can mean "this objective has
//   no bar for that stage" or "this figure is context, not a judgement". `kind`
//   disambiguates: BENCHMARK items were judged against an external standard;
//   CONTEXT items (spend share) are stated, never scored. Without it a consumer
//   would have to guess, and guessing here means asserting a campaign is failing
//   a bar that was never set.
//
// UNITS — the one trap this file exists to contain:
//   A MetricSnapshot `ctr` is a RATIO (0.0164). benchmarkProvider's bars and the
//   client's EVIDENCE_UNITS.CTR are PERCENT (1.64). Every CTR crossing that
//   boundary goes through toPct(), once, here. See the named test.
// ============================================================
// FATIGUE_FREQ comes from benchmarkProvider, NOT verdictEngine. Both re-export
// the same constant, but verdictEngine imports diagnoseSignals — so a
// verdictEngine edge here would close the cycle
//   diagnosis-engine → evidenceProvider → verdictEngine → diagnosis-engine
// and make computeSeverity unimportable from the diagnosis rules. Every module
// this file now touches (benchmarkProvider, confidenceEngine) imports nothing,
// so this leaf stays a leaf.
import { getBenchmarks, FATIGUE_FREQ } from './benchmarkProvider.js';
import { computeConfidence, daysSince } from './confidenceEngine.js';

/** PURE: stored CTR ratio → the percent every benchmark and consumer speaks. */
export const toPct = (ratio) => (ratio ?? 0) * 100;

/**
 * How far below its bar a figure has fallen. HEALTHY is a real grade, not the
 * absence of one — "at or above the bar" is a finding worth stating.
 */
export const SEVERITY = Object.freeze({
  CRITICAL: 'critical',  // more than 40% the wrong side of the bar
  HIGH:     'high',      // 20–40%
  MEDIUM:   'medium',    // 5–20%
  LOW:      'low',       // within 5% — measurably off, not meaningfully
  HEALTHY:  'healthy',   // at or past the bar, in the good direction
});

/**
 * Which way is good. Without this, one severity ladder cannot serve both CTR
 * and frequency: a frequency of 7.0 against a 3.5 ceiling is +100%, and a
 * direction-blind ladder grades the single most exhausted ad in the account as
 * HEALTHY — the most confident wrong answer this module could give.
 */
export const METRIC_DIRECTION = Object.freeze({
  HIGHER_IS_BETTER: 'higher',
  LOWER_IS_BETTER:  'lower',
});

/**
 * BENCHMARK — judged against an external standard (getBenchmarks, fatigue ceiling).
 * CONTEXT   — stated for scale, never scored. Carries no status and no severity.
 */
export const EVIDENCE_KIND = Object.freeze({
  BENCHMARK: 'benchmark',
  CONTEXT:   'context',
});

// Evidence metric keys are UPPERCASE and must match the client's EVIDENCE_UNITS
// map (verdictEvidence.js) exactly — that map is the unit contract, and an
// unrecognised key renders its raw number with no unit. They are deliberately
// NOT the same strings as the lowercase entity row FIELDS ('ctr', 'roas') the
// ranking reads; one is a display contract, the other a row shape.
export const EVIDENCE_METRIC = Object.freeze({
  CTR:         'CTR',
  SPEND_SHARE: 'SPEND_SHARE',
  FREQUENCY:   'FREQUENCY',
});

/**
 * PURE: grade a figure against its bar, in the direction that makes it good.
 * null when there is no bar — an ungraded figure, never a passing one.
 */
export function computeSeverity(value, benchmark, direction = METRIC_DIRECTION.HIGHER_IS_BETTER) {
  if (benchmark == null || benchmark === 0) return null;
  if (!Number.isFinite(value) || !Number.isFinite(benchmark)) return null;
  const raw = (value - benchmark) / benchmark;
  // Flip for ceilings (frequency): being 40% ABOVE a 3.5 ceiling is as bad as
  // being 40% below a CTR floor, and one ladder should say so.
  const signed = direction === METRIC_DIRECTION.LOWER_IS_BETTER ? -raw : raw;
  // Rounded before laddering. (0.95 - 1) / 1 is -0.050000000000000044 in IEEE
  // 754, so an EXACT 5% gap would fall past the -0.05 boundary and grade MEDIUM
  // while exact 20% and 40% gaps land correctly — the band a figure earns would
  // depend on float representation rather than on the figure. 4dp is 0.01%
  // resolution, far finer than any band edge.
  const delta = Math.round(signed * 10_000) / 10_000;
  if (delta >= 0)     return SEVERITY.HEALTHY;
  if (delta >= -0.05) return SEVERITY.LOW;
  if (delta >= -0.20) return SEVERITY.MEDIUM;
  if (delta >= -0.40) return SEVERITY.HIGH;
  return SEVERITY.CRITICAL;
}

/**
 * PURE: one evidence row.
 *
 * `value` arrives ALREADY in the unit its EVIDENCE_METRIC declares — the same
 * contract funnelDiagnosis's ev() honours (`ev('CTR', ctrPct, …)`). The client's
 * formatEvidenceValue trusts that unit absolutely; handing it a raw 0.0164 under
 * the CTR key renders "0.02%" and silently understates every ad by 100×.
 *
 * A CONTEXT item carries status null and severity null. The alternative — the
 * falsy-benchmark branch defaulting to 'weak' — would label a spend share as
 * failing a bar that was never set.
 */
export function evidenceItem(metric, value, {
  benchmarkValue = null,
  kind           = EVIDENCE_KIND.BENCHMARK,
  direction      = METRIC_DIRECTION.HIGHER_IS_BETTER,
} = {}) {
  const scored   = kind === EVIDENCE_KIND.BENCHMARK && benchmarkValue != null;
  const severity = scored ? computeSeverity(value, benchmarkValue, direction) : null;

  return {
    metric,
    value,
    benchmark: scored ? benchmarkValue : null,
    // Derived FROM severity, never computed alongside it: two independent
    // comparisons could disagree, and a row reading status 'healthy' beside
    // severity 'critical' is worse than either alone. The client whitelists
    // exactly 'healthy'|'weak', so anything else must be null, not a new word.
    status: severity == null ? null : (severity === SEVERITY.HEALTHY ? 'healthy' : 'weak'),
    // The OBSERVED gap, sign un-flipped: a frequency 100% over its ceiling reads
    // +100, because that is what the number did. Direction is expressed by
    // `severity`, and lying about the sign to make the two agree would make the
    // figure uncheckable against the row it came from.
    deltaPercent: scored && benchmarkValue !== 0 && Number.isFinite(value)
      ? Math.round(((value - benchmarkValue) / benchmarkValue) * 100)
      : null,
    severity,
    kind,
  };
}

/**
 * Per-metric outlier floors. Deliberately not one shared MIN_GAP: a 15% ROAS
 * gap is money, while a 15% CTR spread is ordinary variance between creatives.
 * `direction` also drives the sort and the outlier predicate, so a metric can
 * never be graded one way and ranked the other.
 */
export const METRIC_THRESHOLDS = Object.freeze({
  ctr:       Object.freeze({ minGap: -0.20, direction: METRIC_DIRECTION.HIGHER_IS_BETTER }),
  roas:      Object.freeze({ minGap: -0.15, direction: METRIC_DIRECTION.HIGHER_IS_BETTER }),
  frequency: Object.freeze({ minGap:  0.30, direction: METRIC_DIRECTION.LOWER_IS_BETTER }),
});

export const DEFAULT_THRESHOLD = Object.freeze({
  minGap: -0.20, direction: METRIC_DIRECTION.HIGHER_IS_BETTER,
});

/**
 * Delivery floor for INCLUSION IN A RANKING — deliberately NOT confidenceEngine's
 * MIN_IMPRESSIONS (1000), which gates whether a VERDICT may be emitted at all.
 * The two answer different questions: 1000 is "may we tell someone to act on
 * this", 100 is "is this row worth placing in a list beside its siblings".
 * Ranking an entity is not deciding about it, and excluding everything under
 * 1000 would empty the list on exactly the small accounts that need it. The
 * spread between the two numbers is why they are separate constants rather than
 * one shared import.
 */
export const MIN_IMPRESSIONS_FOR_RANKING = 100;

/**
 * PURE: rank entities against a measured parent baseline and grade the gaps.
 *
 * @param {object} opts
 * @param {string} opts.dimension — 'AD' | 'ADSET' (extensible: PLACEMENT, KEYWORD…)
 * @param {Array}  opts.entities  — rows from toAdRow() / toAdSetRow()
 * @param {object} opts.baseline  — the parent's OWN measured snapshot row. Never a
 *   mean of `entities`: an unweighted average of ratios is a number no snapshot
 *   contains, and it weighs a 100-impression row equally with a 100,000 one.
 * @param {string|null} [opts.objective] — selects the CTR bars
 * @param {string} [opts.metric='ctr'] — the entity ROW FIELD to rank on
 * @param {number} [opts.now=Date.now()] — injected for determinism; the only
 *   default that reads a clock, and it is the caller's to override.
 * @returns {{dimension,metric,ranked,summary,evidence,dataConfidence}|null}
 *   null when the data cannot support a ranking — fewer than two comparable
 *   entities, no baseline to divide by, or no gap past the metric's floor.
 *   null is a real answer here, never a fallback.
 */
export function analyzeEvidence({
  dimension,
  entities,
  baseline,
  objective = null,
  metric = 'ctr',
  now = Date.now(),
} = {}) {
  if (!Array.isArray(entities) || !entities.length || !baseline) return null;

  const b         = getBenchmarks(objective);
  const threshold = METRIC_THRESHOLDS[metric] ?? DEFAULT_THRESHOLD;
  const isPenalty = threshold.direction === METRIC_DIRECTION.LOWER_IS_BETTER;
  const baseValue = baseline[metric];
  if (!(baseValue > 0)) return null; // null / 0 / NaN all fail — nothing to divide by

  const scored = entities
    .filter((e) => e && e[metric] != null && (e.impressions ?? 0) >= MIN_IMPRESSIONS_FOR_RANKING)
    .map((e) => ({
      ...e,
      // Ratio of two figures in the SAME unit, so no conversion is needed here —
      // a percent-vs-percent gap and a ratio-vs-ratio gap are the same number.
      // The unit only matters where a figure meets a benchmark, below.
      _gap: (e[metric] - baseValue) / baseValue,
      _evidence: [
        // Normative: the objective's own CTR floor. toPct is the ONLY place the
        // stored ratio becomes the percent the bar and the client both speak.
        evidenceItem(EVIDENCE_METRIC.CTR, toPct(e.ctr), {
          benchmarkValue: b.ctr.weak,
          kind:           EVIDENCE_KIND.BENCHMARK,
          direction:      METRIC_DIRECTION.HIGHER_IS_BETTER,
        }),
        // Context: how much money rides on this row. Stated, never scored —
        // there is no benchmark for "share of parent spend", and inventing one
        // would turn a fact into an accusation.
        baseline.spendMinor > 0 && e.spendMinor != null
          ? evidenceItem(EVIDENCE_METRIC.SPEND_SHARE, e.spendMinor / baseline.spendMinor, {
            kind: EVIDENCE_KIND.CONTEXT,
          })
          : null,
        // Normative, but a CEILING: the verdict engine's own saturation number,
        // imported rather than re-typed so the two can never drift apart.
        e.frequency != null
          ? evidenceItem(EVIDENCE_METRIC.FREQUENCY, e.frequency, {
            benchmarkValue: FATIGUE_FREQ,
            kind:           EVIDENCE_KIND.BENCHMARK,
            direction:      METRIC_DIRECTION.LOWER_IS_BETTER,
          })
          : null,
      ].filter(Boolean),
    }));

  // One reporting entity is not a comparison — it is trivially both the best and
  // the worst. Same gate as findWorstAdSet, for the same reason.
  if (scored.length < 2) return null;

  // Index 0 is always the WORST, whichever way the metric runs.
  const sorted = [...scored].sort((x, y) => (isPenalty ? y._gap - x._gap : x._gap - y._gap));

  const isOutlier = isPenalty
    ? (e) => e._gap >= threshold.minGap
    : (e) => e._gap <= threshold.minGap;
  const outliers = sorted.filter(isOutlier);
  if (!outliers.length) return null; // ordinary variance is not a finding

  const bottom = sorted[0];
  const top    = sorted[sorted.length - 1];

  // Input quality for the row this analysis is ABOUT. Not the final confidence:
  // Stage 3's reasoning strength multiplies into it via composeConfidence.
  const dataConfidence = computeConfidence({
    impressions:   bottom.impressions,
    daysRunning:   daysSince(bottom.platformCreatedTime, now),
    actionMetrics: bottom.actionMetrics,
    objective,
    createdTime:   bottom.platformCreatedTime,
  });

  return {
    dimension,
    metric,
    ranked: sorted,
    summary: { top, bottom, outliers },
    evidence: bottom._evidence,
    dataConfidence,
  };
}
