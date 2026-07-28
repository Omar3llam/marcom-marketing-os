// ============================================================
// MARCOM / Lumi — executionContext (pure)
// ------------------------------------------------------------
// A campaign verdict says WHETHER to act. This says WHERE to look first: the
// ad set inside a KILL/REALLOCATE campaign whose click-through is dragging
// hardest on the campaign's own measured rate.
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

// Below this, the gap is not worth pointing a marketer at. A 12% spread across
// ad sets is ordinary variance, and naming a "worst" one implies a problem the
// data does not support.
export const MIN_MEANINGFUL_GAP = -0.20;

// The verdicts that ask for an intervention. HOLD/SCALE/WATCH/REFRESH do not —
// pointing at a "worst" ad set under a healthy campaign invents an alarm.
export const ACTIONABLE_VERDICTS = Object.freeze(['KILL', 'REALLOCATE']);

/**
 * PURE: the ad set most worth inspecting first, or null when the data cannot
 * support naming one. Never throws, never mutates the input.
 *
 * Returns null when:
 *   • fewer than 2 ad sets exist            — nothing to compare
 *   • fewer than 2 report a CTR             — "lowest" needs a comparison; the
 *                                             sole reporter is trivially both
 *                                             the min AND the max
 *   • the campaign has no measured CTR (null / 0) — no baseline to divide by
 *   • the widest gap is shallower than 20%  — ordinary variance, not a finding
 *
 * The returned row is a COPY carrying two derived fields:
 *   gap           — signed fraction vs the campaign rate (-0.80 = 80% below)
 *   comparedCount — how many ad sets actually had a CTR to compare, so the UI
 *                   can state the strength of its own evidence
 */
export function findWorstAdSet(adSets, campaignCtr) {
  if (!Array.isArray(adSets) || adSets.length < 2) return null;
  if (!(campaignCtr > 0)) return null; // null / 0 / NaN all fail this

  const scored = adSets
    .filter((a) => a && a.ctr != null)
    .map((a) => ({ ...a, gap: (a.ctr - campaignCtr) / campaignCtr }));

  // One reporting ad set is not a comparison. Calling it "the lowest" would be
  // true only in the sense that it is also the highest.
  if (scored.length < 2) return null;

  const worst = scored.reduce((a, b) => (a.gap < b.gap ? a : b));
  if (worst.gap > MIN_MEANINGFUL_GAP) return null;

  return { ...worst, comparedCount: scored.length };
}

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
 * PURE: would ExecutionContext render anything for this campaign? The component
 * answers this itself, but the table needs the same answer BEFORE it commits a
 * <tr> — an empty bordered row under every expansion is worse than no row.
 * One predicate so the two can never disagree.
 */
export function hasExecutionContext(campaign, adSets, verdict) {
  if (!campaign || !ACTIONABLE_VERDICTS.includes(verdict)) return false;
  return findWorstAdSet(adSets, campaign.ctr) != null;
}
