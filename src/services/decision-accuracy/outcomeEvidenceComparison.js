// ============================================================
// outcomeEvidenceComparison — what Lumi OBSERVED around an intervention
// ============================================================
// B5-01X' — the read side of outcome review. It answers one question:
//
//     over the policy's baseline and observation windows, what do Lumi's own
//     daily observations say, and how complete is that evidence?
//
// IT IS NOT AN OUTCOME. Nothing here scores, grades, judges or concludes, and
// nothing here writes. `OutcomeSnapshot` keeps exactly one author — an operator
// through POST /lumi/accuracy/decisions/:id/outcome — and this module cannot
// reach it: there is no create, update or upsert anywhere in the file, and a
// test asserts that structurally.
//
//     OBSERVED PERFORMANCE  is not  DECISION CORRECTNESS
//     EVIDENCE              is not  CAUSALITY
//
// The operator reads what follows, brings what Lumi cannot see, and records
// their own judgement through the route that already exists.
//
// IT DOES NOT RE-IMPLEMENT THE READER
// -----------------------------------
// Population selection, row rejection, duplicate reduction, boundary straddling
// and the I20 comparability contract all belong to daily-observations and are
// used from there. This module adds exactly three things the product question
// needs and the reader deliberately does not have: the window POLICY (which days
// are compared), AGGREGATION over those windows, and the application states that
// tell an operator why a comparison is missing.
//
// WHY THE READER'S OWN `pair` IS NOT USED
// ---------------------------------------
// `readDailyObservations` pairs the last day before the boundary with the first
// day after it, and says so: "Any other pairing is the caller's to make." That
// pair is a correct one-day comparison and the wrong product answer — measured
// against 7 clean days and 7 killed days it reports one day's spend, which an
// operator reading "the week after the kill" would take for the week. The
// policy's windows are the pairing this caller makes.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { readDailyObservations } from '../daily-observations/dailyObservationReader.js';
import { areComparable, COMPARABILITY } from '../daily-observations/observationComparability.js';
import { ADDITIVE_METRICS } from '../verdict-engine/metricWindow.js';
import { ENTITY_LEVEL } from '../connectors/connectorTypes.js';
import { resolve as resolveConnector } from '../connectors/connectorRegistry.js';
import { interventionAt, PROVENANCE_SELECT } from '../execution/decisionProvenance.js';
import { comparisonWindows, COMPARISON_WINDOW_DAYS } from './comparisonWindow.js';

/**
 * What the evidence read could establish. Seven states, and the four that mean
 * "no comparison" are deliberately NOT one state: each has a different cause, a
 * different fix, and a different sentence an operator needs to read. Collapsing
 * any pair of them is how a product tells someone their campaign had no
 * performance when in fact Lumi never looked.
 *
 *     0 rows            is not  unsupported platform
 *     partial rows      is not  complete evidence
 *     query failure     is not  no observations
 *     ambiguous rows    is not  missing rows
 */
export const EVIDENCE_STATUS = Object.freeze({
  MEASURABLE:            'MEASURABLE',            // both windows complete and comparable
  NOT_OBSERVED:          'NOT_OBSERVED',          // supported, read fine, nothing observed
  AMBIGUOUS:             'AMBIGUOUS',             // a contributing day did not reduce to one reading
  NOT_MEASURABLE:        'NOT_MEASURABLE',        // the comparability contract refused the windows
  INSUFFICIENT_COVERAGE: 'INSUFFICIENT_COVERAGE', // some days observed, not all of them
  UNSUPPORTED:           'UNSUPPORTED',           // no daily population can answer this decision
  UNAVAILABLE:           'UNAVAILABLE',           // the read itself failed
});

/**
 * WHY a decision has no daily population. Named because "unsupported" alone
 * sends an operator looking for a data problem that does not exist — two of
 * these are answered by building a connector, not by investigating an account.
 */
export const UNSUPPORTED_REASON = Object.freeze({
  LEVEL_NOT_INGESTED:            'LEVEL_NOT_INGESTED',
  ENTITY_NOT_IN_GRAPH:           'ENTITY_NOT_IN_GRAPH',
  CHANNEL_HAS_NO_DAILY_CAPABILITY: 'CHANNEL_HAS_NO_DAILY_CAPABILITY',
});

/** Refusals about the SUBJECT, not about the evidence. Mirrors OUTCOME_ERROR. */
export const EVIDENCE_ERROR = Object.freeze({
  DECISION_NOT_FOUND: 'DECISION_NOT_FOUND',
  NOT_EXECUTED:       'NOT_EXECUTED',
});

/**
 * The metrics summed over a window.
 *
 * Both are in ADDITIVE_METRICS, which is what makes Σ exact over disjoint days
 * — a test pins that rather than a comment, so the day either stops being
 * additive this file fails instead of quietly producing a number that is not a
 * quantity. ROAS is NOT here: it is DERIVED and is recomputed from these totals
 * below, never summed and never averaged.
 */
export const SUMMED_METRICS = Object.freeze(['spendMinor', 'revenueMinor']);

const evidenceError = (code, message) => Object.assign(new Error(message), { code });

/**
 * Is there a daily population that can answer a decision about this entity?
 *
 * Answered from the connector registry's own capability test — the identical
 * predicate ConnectorSyncService uses to decide DAILY_STATE.UNIMPLEMENTED — so
 * there is one definition of "this channel can report days". The moment a
 * Google daily provider is implemented this returns supported for Google with
 * no edit here, and until then it must never be NOT_OBSERVED, which would tell
 * an operator their Google campaign delivered nothing.
 *
 * DAILY_INGESTION_ENABLED is deliberately NOT consulted. It is a deployment
 * switch, not a capability: a workspace with real historical daily rows must
 * still be able to read them, and one with none is honestly NOT_OBSERVED with
 * every missing day named.
 */
async function supportedPopulation(workspaceId, decision) {
  // Meta's daily normalizer emits `entityLevel: 'CAMPAIGN'` and nothing else,
  // so an ADSET or AD decision has no daily population to read at any spend.
  if (decision.entityLevel !== ENTITY_LEVEL.CAMPAIGN) {
    return { ok: false, reason: UNSUPPORTED_REASON.LEVEL_NOT_INGESTED };
  }
  const campaign = await prisma.campaign.findFirst({
    where: { id: decision.entityId, workspaceId },
    select: { channel: true },
  });
  // Without the entity we cannot name a source, and `readDailyObservations`
  // requires one for a reason: two sources measuring one day are two
  // measurements. Guessing one would be the exact thing it refuses.
  if (!campaign) return { ok: false, reason: UNSUPPORTED_REASON.ENTITY_NOT_IN_GRAPH };

  let connector = null;
  try {
    connector = resolveConnector(campaign.channel);
  } catch {
    return { ok: false, reason: UNSUPPORTED_REASON.CHANNEL_HAS_NO_DAILY_CAPABILITY };
  }
  const capable = typeof connector?.fetchDailyRaw === 'function'
    && typeof connector?.normalizeDaily === 'function';
  if (!capable) return { ok: false, reason: UNSUPPORTED_REASON.CHANNEL_HAS_NO_DAILY_CAPABILITY };

  // Channel and DataSource share their names for every ad platform (a Meta row
  // is written `channel: META, source: META` by the same normalizer), so the
  // channel IS the source to read by.
  return { ok: true, source: campaign.channel };
}

/**
 * PURE: one window's totals from the days that were actually observed.
 *
 * COVERAGE IS PART OF THE ANSWER, not a footnote. `required` is what the policy
 * asked for, `observed` is what existed, and `missing` names the exact dates —
 * a count alone cannot tell an operator which Tuesday to go and look at.
 *
 * A day nobody reported contributes NOTHING. It is never a zero: absence is not
 * a measurement of no delivery, and the whole daily track exists to refuse that
 * substitution.
 */
export function aggregateWindow(requiredDays, byDay) {
  const observedDays = requiredDays.filter((d) => byDay.has(d));
  const missing = requiredDays.filter((d) => !byDay.has(d));
  const rows = observedDays.map((d) => byDay.get(d));

  const totals = {};
  for (const key of SUMMED_METRICS) {
    let sum = 0;
    let usable = rows.length > 0;
    for (const r of rows) {
      const v = r[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) { usable = false; break; }
      sum += v;
    }
    totals[key] = usable ? sum : null;
  }

  // ONE currency or none. Two currencies across a window is not a window total,
  // and picking the first would silently add piastres to cents.
  const currencies = new Set(rows.map((r) => r.currency).filter((c) => c != null));

  return {
    days: requiredDays,
    ...totals,
    // Ratio of the SUMMED parts (§1.4), never Σ(row.roas) and never the mean of
    // daily ratios — averaging weights a 100-impression day equally with a
    // 100,000-impression one, which is a number no row contains. Undefined at
    // zero spend rather than Infinity or 0.
    roas: (totals.spendMinor != null && totals.revenueMinor != null && totals.spendMinor > 0)
      ? totals.revenueMinor / totals.spendMinor
      : null,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    coverage: {
      required: requiredDays.length,
      observed: observedDays.length,
      missing,
      complete: missing.length === 0,
    },
    refs: rows.map((r) => ({ id: r.id, day: r.day, observedAt: r.observedAt })),
  };
}

/** The shape returned when there is nothing to compare. Every number null. */
function refusal(status, reason, base) {
  return {
    ...base,
    status,
    reason,
    baseline: null,
    observation: null,
    delta: { spendMinor: null, revenueMinor: null, roas: null },
  };
}

const NULL_DELTA = Object.freeze({ spendMinor: null, revenueMinor: null, roas: null });

/**
 * A window with its coverage and provenance intact and every total removed.
 * For a window whose numbers cannot be stated reproducibly — see the AMBIGUOUS
 * branch. Withholding a number is honest; publishing an unstable one is not.
 */
const withoutTotals = (w) => ({
  ...w,
  ...Object.fromEntries(SUMMED_METRICS.map((k) => [k, null])),
  roas: null,
  currency: null,
});

/**
 * Read the observed evidence around one decision's intervention.
 *
 * @param {string} workspaceId — from trusted context, NEVER a request field (I2)
 * @param {string} decisionId
 * @returns {Promise<object>} the comparison contract — see EVIDENCE_STATUS
 */
export async function readOutcomeEvidence(workspaceId, decisionId) {
  if (!workspaceId) throw new Error('readOutcomeEvidence: workspaceId required');
  if (!decisionId) throw new Error('readOutcomeEvidence: decisionId required');

  // Subject resolution, outside the evidence try: a decision that is not there
  // or was never acted on is a refusal about the REQUEST, and answering it with
  // an evidence state would say something about the account instead.
  const decision = await prisma.decision.findFirst({
    where: { id: decisionId, workspaceId },
    select: { id: true, entityId: true, entityLevel: true, verdict: true, ...PROVENANCE_SELECT },
  });
  if (!decision) {
    throw evidenceError(EVIDENCE_ERROR.DECISION_NOT_FOUND, 'readOutcomeEvidence: decision not found');
  }
  const actedAt = interventionAt(decision);
  if (actedAt == null) {
    // Nothing was done, so there is no boundary to compare across. The same
    // refusal recordOutcome makes, for the same reason.
    throw evidenceError(
      EVIDENCE_ERROR.NOT_EXECUTED,
      `readOutcomeEvidence: decision ${decisionId} has not been executed — there is no intervention to measure around`,
    );
  }

  const windows = comparisonWindows(actedAt);
  if (windows == null) {
    throw evidenceError(
      EVIDENCE_ERROR.NOT_EXECUTED,
      `readOutcomeEvidence: decision ${decisionId} carries an unusable intervention instant`,
    );
  }

  const base = {
    decisionId: decision.id,
    entityId: decision.entityId,
    entityLevel: decision.entityLevel,
    verdict: decision.verdict,
    interventionAt: new Date(actedAt).toISOString(),
    interventionDay: windows.interventionDay,
    policy: {
      comparisonWindowDays: COMPARISON_WINDOW_DAYS,
      baselineWindow: { start: windows.baseline.windowStart, end: windows.baseline.windowEnd },
      observationWindow: { start: windows.observation.windowStart, end: windows.observation.windowEnd },
      // Stated so a reader never has to infer it from the dates.
      interventionDayExcluded: true,
    },
    source: null,
  };

  let source = null;
  let read = null;
  try {
    const capability = await supportedPopulation(workspaceId, decision);
    if (!capability.ok) {
      return refusal(EVIDENCE_STATUS.UNSUPPORTED, capability.reason, base);
    }
    source = capability.source;
    read = await readDailyObservations(workspaceId, {
      entityId: decision.entityId,
      entityLevel: decision.entityLevel,
      source,
      interventionAt: new Date(actedAt),
      ...windows.readerSpan,
    });
  } catch (err) {
    // "We could not look" is never "there was nothing". The operator's form is
    // untouched and they can retry; a zero here would be a claim about their
    // account made by a read that never happened.
    logger.warn(
      { err: err.message, workspaceId, decisionId },
      '[outcomeEvidence] evidence read failed',
    );
    return refusal(EVIDENCE_STATUS.UNAVAILABLE, null, { ...base, source });
  }

  const withSource = { ...base, source };

  // Each window draws ONLY from the side of the boundary the reader put the day
  // on. Selecting by date alone would let a mis-sorted day cross the boundary
  // silently; this way the reader's classification stays load-bearing.
  const beforeByDay = new Map(read.before.map((o) => [o.day, o]));
  const afterByDay = new Map(read.after.map((o) => [o.day, o]));

  const baseline = aggregateWindow(windows.baseline.days, beforeByDay);
  const observation = aggregateWindow(windows.observation.days, afterByDay);

  // A day that did not reduce to one reading is not a measurement, so a window
  // containing one cannot be totalled. Checked over the days this comparison
  // actually uses — an ambiguous day elsewhere in the fetched span is not this
  // comparison's problem.
  const usedDays = [...baseline.refs, ...observation.refs].map((r) => r.day);
  const ambiguousDays = [...beforeByDay.values(), ...afterByDay.values()]
    .filter((o) => o.ambiguous && usedDays.includes(o.day))
    .map((o) => o.day)
    .sort();
  if (ambiguousDays.length > 0) {
    // THE TOTALS OF AN AFFECTED WINDOW ARE WITHDRAWN, not merely unused.
    // `reduceDay` returns `tied[0]` for a disagreeing tie — a row it FLAGS
    // rather than ranks, chosen by a sort that does not order equal instants —
    // so a sum containing that day is not reproducible: two reads of unchanged
    // data could publish two different numbers. Coverage and row provenance
    // survive, because those are facts about what exists.
    //
    // Only the affected window loses its totals. A clean baseline is still a
    // real, deterministic total and the operator may want it; what they may not
    // have is a comparison, and `delta` is null for exactly that reason.
    const affected = (w) => w.refs.some((r) => ambiguousDays.includes(r.day));
    return {
      ...refusal(EVIDENCE_STATUS.AMBIGUOUS, COMPARABILITY.AMBIGUOUS_OBSERVATION, withSource),
      baseline: affected(baseline) ? withoutTotals(baseline) : baseline,
      observation: affected(observation) ? withoutTotals(observation) : observation,
      ambiguousDays,
    };
  }

  if (baseline.coverage.observed === 0 && observation.coverage.observed === 0) {
    return { ...refusal(EVIDENCE_STATUS.NOT_OBSERVED, null, withSource), baseline, observation };
  }

  // The I20 contract, applied across the seam the policy actually compares: the
  // last observed baseline day against the first observed observation day. Both
  // sides exist here, so a refusal is structural rather than a coverage gap, and
  // it is the module that owns comparability that decides — not this one.
  if (baseline.coverage.observed > 0 && observation.coverage.observed > 0) {
    const lastBaseline = beforeByDay.get(baseline.refs[baseline.refs.length - 1].day);
    const firstObservation = afterByDay.get(observation.refs[0].day);
    const verdict = areComparable(lastBaseline, firstObservation);
    if (!verdict.ok
      && verdict.reason !== COMPARABILITY.MISSING_OBSERVATION
      && verdict.reason !== COMPARABILITY.AMBIGUOUS_OBSERVATION) {
      return { ...refusal(EVIDENCE_STATUS.NOT_MEASURABLE, verdict.reason, withSource), baseline, observation };
    }
  }

  // A partial window is not a window. The totals stay — they are real sums of
  // real rows and the operator may want them — but no delta is derived from
  // them, because a 4-of-7 baseline subtracted from a 7-of-7 observation is a
  // number that describes neither period.
  if (!baseline.coverage.complete || !observation.coverage.complete) {
    return {
      ...withSource,
      status: EVIDENCE_STATUS.INSUFFICIENT_COVERAGE,
      reason: null,
      baseline,
      observation,
      delta: { ...NULL_DELTA },
    };
  }

  const delta = {};
  for (const key of SUMMED_METRICS) {
    delta[key] = (baseline[key] != null && observation[key] != null)
      ? observation[key] - baseline[key]
      : null;
  }
  // observed − baseline, each side's ROAS being a ratio of ITS OWN summed parts.
  // Null when either side had no spend to divide by; a fabricated 0 would read
  // as "ROAS did not move".
  delta.roas = (baseline.roas != null && observation.roas != null)
    ? observation.roas - baseline.roas
    : null;

  logger.debug(
    { workspaceId, decisionId, source, baseline: baseline.coverage, observation: observation.coverage },
    '[outcomeEvidence] comparison read',
  );

  return {
    ...withSource,
    status: EVIDENCE_STATUS.MEASURABLE,
    reason: null,
    baseline,
    observation,
    delta,
  };
}

// A defensive re-export so a caller can check the family without importing
// metricWindow itself — and so the additive claim above has one place to break.
export { ADDITIVE_METRICS };
