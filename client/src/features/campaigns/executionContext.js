// ============================================================
// MARCOM / Lumi — executionContext (pure)
// ------------------------------------------------------------
// A campaign verdict says WHETHER to act. The server says WHICH ad set to look
// at first. This module DESCRIBES that pick: the gap, the spend share, the
// evidence bullets and the working hypothesis, all computed from the row the
// ranking named.
//
// It does not choose the row. Ranking lives on the server — one ranker, so the
// panel can never point at an ad set the engine did not pick, and so the
// thresholds that decide "measurably behind" move in one place.
//
// Governing law, same as verdictEvidence.js: every figure here is arithmetic on
// two real MetricSnapshot fields (the ad set's ctr/spendMinor and the
// campaign's). Nothing is inferred, ranked by a model, or filled in.
//
// The baseline is the CAMPAIGN's own `ctr` — a measured figure from its own
// campaign-level snapshot. It is deliberately NOT the mean of the ad sets'
// CTRs: an unweighted average of ratios is a number no snapshot contains, and
// it is arithmetically wrong besides (a 10-impression ad set would weigh the
// same as a 100,000-impression one). Both levels are read in ONE fetchRaw call
// sharing ONE datePreset, so the two rates cover the same window and the
// comparison is sound.
// ============================================================

import { FATIGUE_FREQ } from './verdictEvidence.js';
import { formatCurrency } from '@/lib/money';

// ── Units ────────────────────────────────────────────────────────────────────
// A MetricSnapshot `ctr` is a RATIO (snapshotSink.js: clicks / impressions), so
// 1.64% arrives as 0.0164. The verdict ENGINE's own ctr is a PERCENT (it
// multiplies by 100 first), which is why its AWARENESS_FATIGUE_CTR reads 1.0.
// Lifting that 1.0 onto a snapshot row would mean "CTR below 100%" — true of
// every row ever measured, so every ad set would read as fatigued. The name
// says THRESHOLD, and the value is written in the units this module receives.
const LOW_CTR_THRESHOLD = 0.01; // ratio — 1.00%

// Below this the ad set has not bought enough delivery to diagnose. Deliberately
// its own constant rather than borrowing relativeRanking's MIN_SPEND_MINOR
// (1000), whose comment scopes it to "skip roster-only / trivial rows" — a
// ranking guard, not a diagnostic floor. At ~10 currency units that one would
// let through ad sets that plainly are too early to read.
export const MIN_SPEND_FOR_DIAGNOSIS = 5_000; // ~50 currency units

// The verdicts that ask for an intervention. HOLD/SCALE/WATCH/REFRESH do not —
// pointing at a "worst" ad set under a healthy campaign invents an alarm.
export const ACTIONABLE_VERDICTS = Object.freeze(['KILL', 'REALLOCATE']);

/**
 * PURE: the ad set's share of the campaign's spend, as a fraction. The
 * denominator is the CAMPAIGN's own spendMinor, not the sum of its ad sets —
 * roster-only ad sets deliberately land no snapshot, so that sum is a subset of
 * the campaign total and dividing by it would overstate every share.
 *
 * Null (never 0) whenever either figure is absent, so the caller drops the line
 * rather than claiming a 0% share.
 */
export function spendConcentration(adSetSpendMinor, campaignSpendMinor) {
  if (adSetSpendMinor == null || campaignSpendMinor == null) return null;
  if (!(campaignSpendMinor > 0)) return null;
  return adSetSpendMinor / campaignSpendMinor;
}

/** PURE: signed percentage gap as a display string ("-80%"), or null. */
export function formatGap(adSetCtr, campaignCtr) {
  if (adSetCtr == null || campaignCtr == null) return null;
  if (!(campaignCtr > 0)) return null;
  const pct = Math.round(((adSetCtr - campaignCtr) / campaignCtr) * 100);
  return pct < 0 ? `${pct}%` : `+${pct}%`;
}

/** PURE: the same gap as an unsigned magnitude ("80"), for prose. Null-safe. */
export function gapMagnitude(adSetCtr, campaignCtr) {
  if (adSetCtr == null || campaignCtr == null) return null;
  if (!(campaignCtr > 0)) return null;
  return Math.abs(Math.round(((adSetCtr - campaignCtr) / campaignCtr) * 100));
}

/**
 * PURE: why THIS ad set was selected — at most three bullets, each a distinct
 * fact, each dropped entirely when its input is missing.
 *
 * The three are deliberately non-overlapping: the gap, the money behind it, and
 * how many ad sets it was actually compared against. Stating the gap twice in
 * different words would read as three reasons where there is one.
 */
export function buildEvidenceBullets(worst, campaignCtr, campaignSpendMinor) {
  if (!worst) return [];
  const bullets = [];

  const gap = formatGap(worst.ctr, campaignCtr);
  if (gap) bullets.push(`Lowest CTR in campaign (${gap} vs the campaign rate)`);

  const share = spendConcentration(worst.spendMinor, campaignSpendMinor);
  if (share != null) bullets.push(`${Math.round(share * 100)}% of campaign spend`);

  // The strength of the evidence, stated plainly: picked from 3 is a weaker
  // claim than picked from 30, and the reader deserves to know which.
  if (worst.comparedCount >= 2) {
    bullets.push(`Compared against ${worst.comparedCount} ad sets reporting CTR`);
  }

  return bullets;
}

/**
 * PURE: a working hypothesis for WHY this ad set is underperforming, or null
 * when the data cannot support one.
 *
 * A hypothesis is not a verdict. The three fields are kept apart on purpose and
 * the UI renders them under separate headings:
 *
 *   observed       — figures from the row. Checkable, no interpretation.
 *   interpretation — what the pattern is COMMONLY associated with. Hedged,
 *                    because a MetricSnapshot cannot see a learning phase, a
 *                    deliberate broad test, or a seasonal audience.
 *   caveat         — what to do before acting on it.
 *
 * Evaluated H0 → H3 → H1 → H2. The ordering is load-bearing: "creative fatigue"
 * on an ad set that spent 12 currency units would be a confident diagnosis of
 * noise, so the insufficient-data gate has to run BEFORE the pattern gates, not
 * alongside them.
 */
export function buildHypothesis(worst) {
  if (!worst) return null;

  // H0 — the ad set is not running, so there is nothing to explain. A stopped
  // ad set with a low CTR and a high frequency is not a tired creative; it is a
  // stopped ad set, and diagnosing it would be the most confident wrong answer
  // this engine could give.
  //
  // Only PAUSED/ARCHIVED are acted on. The status column is NOT NULL and
  // defaults to ACTIVE, so ACTIVE means "running, OR the connector was never
  // told" — it is not positive evidence of delivery, and the impressions proxy
  // below still has to catch the rest.
  if (worst.status === 'PAUSED' || worst.status === 'ARCHIVED') return null;

  // Fallback proxy for everything status cannot answer: nothing delivered.
  if (!worst.impressions) return null;

  // H3 — too little delivery to tell signal from noise. FIRST, so a thin ad set
  // can never collect a confident pattern label.
  if (worst.spendMinor != null && worst.spendMinor < MIN_SPEND_FOR_DIAGNOSIS) {
    return {
      label: 'Insufficient data',
      observed: `This ad set has spent ${formatCurrency(worst.spendMinor, worst.currency)}.`,
      interpretation: 'Too little delivery to distinguish signal from noise.',
      caveat: 'Wait for more delivery before acting.',
    };
  }

  const hasPair = worst.ctr != null && worst.frequency != null;
  if (!hasPair) return null;

  const lowCtr = worst.ctr < LOW_CTR_THRESHOLD;
  const fatigued = worst.frequency >= FATIGUE_FREQ;
  const ctrPct = `${(worst.ctr * 100).toFixed(2)}%`;
  const freq = worst.frequency.toFixed(1);

  // H1 — the engine's own fatigue signal: BOTH a saturated frequency and a low
  // click-through. Either alone is not fatigue.
  if (lowCtr && fatigued) {
    return {
      label: 'Creative fatigue',
      observed: `Frequency is ${freq}, above Lumi's fatigue threshold (${FATIGUE_FREQ}), while CTR is ${ctrPct}.`,
      interpretation: 'This combination is most commonly associated with an audience that has seen the creative too many times and stopped responding to it.',
      caveat: 'Refresh the creative before pausing the ad set.',
    };
  }

  // H2 — the fatigue signal was not met. The frequency clause states where the
  // figure ACTUALLY sits: a high frequency with a healthy CTR still fails the
  // pair, and saying "below the threshold" about a 4.0 would be a plain false
  // statement sitting under a heading that promises observed fact.
  const freqClause = fatigued
    ? `frequency is ${freq} (above the ${FATIGUE_FREQ} fatigue threshold), but CTR is not low enough to read as fatigue`
    : `frequency is ${freq} (below the ${FATIGUE_FREQ} fatigue threshold)`;

  return {
    label: 'No fatigue signal detected',
    observed: `CTR is ${ctrPct} and ${freqClause}.`,
    interpretation: 'This pattern is more commonly associated with audience fit, creative quality, or offer relevance.',
    caveat: 'Review the creative and audience targeting before pausing.',
  };
}

/**
 * PURE: is it worth ASKING the server whether this campaign has execution
 * context? Verdict only — the cheap half of the old `hasExecutionContext`.
 *
 * That predicate answered two questions at once: "does this verdict have
 * somewhere to drill into" (free, local) and "is one ad set measurably dragging"
 * (a ranking, now the server's). Only the first can stay synchronous, and
 * keeping it matters: it bounds evidence requests to actionable rows, so an
 * expanded HOLD costs nothing.
 *
 * The second question moves to GET /entities/:campaignId/adsets/evidence, whose
 * answer distinguishes "no meaningful gap" from "not enough reporting ad sets"
 * from "no campaign baseline yet" — three states this predicate collapsed into
 * one silent `false`.
 */
export function shouldRequestEvidence(campaign, verdict) {
  return Boolean(campaign) && ACTIONABLE_VERDICTS.includes(verdict);
}

/**
 * The refusals the evidence endpoint can return, as sentences. Keys are the
 * server's `reasonKey`s verbatim — the API deliberately carries no prose so the
 * wording (and its translation) lives here.
 *
 * Each names the missing INPUT, not a generic shortfall: an operator told their
 * ad sets are too thin will go split their audience, when the real gap may be a
 * campaign that has not synced a snapshot yet.
 *
 * ONE map, not one per level — the same discipline EVIDENCE_REASON keeps on the
 * server, which has exactly one enum for both dimensions. Two of these sentences
 * name the entities involved, and those NOUNS differ by level: the same
 * NO_MEANINGFUL_GAP under a list of ads means "no ad", and the baseline an ad is
 * compared against is its ad set, not the campaign. Rendering the ad-set wording
 * under an ad list would be a true refusal about the wrong entity, so the
 * level-dependent sentences are functions of the dimension while the key set
 * stays single.
 */
const AD_SET_NOUNS  = Object.freeze({ cohort: 'ad set', baseline: 'campaign' });
const AD_NOUNS      = Object.freeze({ cohort: 'ad',     baseline: 'ad set' });
const nounsFor = (dimension) => (dimension === 'ad' ? AD_NOUNS : AD_SET_NOUNS);

export const EVIDENCE_REFUSAL_LABELS = Object.freeze({
  INSUFFICIENT_REPORTING_ADSETS: () => 'Not enough reporting ad sets to compare',
  INSUFFICIENT_REPORTING_ADS:    () => 'Not enough reporting ads to compare',
  BASELINE_UNAVAILABLE:          (n) => `No ${n.baseline} performance data to compare against yet`,
  NO_MEANINGFUL_GAP:             (n) => `No ${n.cohort} is measurably behind the others`,
  INVALID_METRIC:                () => 'That ranking metric is not supported',
});

/**
 * PURE: a refusal sentence, with a general fallback for a key we do not know.
 * @param {string|null} reasonKey — the server's key, verbatim
 * @param {'adset'|'ad'} [dimension='adset'] — which level asked
 */
export const refusalLabel = (reasonKey, dimension = 'adset') => {
  const nouns = nounsFor(dimension);
  const build = EVIDENCE_REFUSAL_LABELS[reasonKey];
  return build ? build(nouns) : `Not enough data to compare ${nouns.cohort}s`;
};
