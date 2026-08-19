// ============================================================
// AccountAggregateService — the ONE account-level aggregate
// ============================================================
// Total spend, blended CPA, verdict counts and spend-by-verdict for a workspace,
// computed once, from one population, with the period stated on the answer.
//
// WHAT THIS REPLACES
// ------------------
// Every one of these numbers already existed — in React. Overview summed spend
// and divided for CPA; CampaignsView did it again with different rules; the
// legacy feed did it a third way, averaging per-campaign CPAs (which is not a
// blended CPA at all). None of them could say what period they covered, and one
// of them paired a canonical 30-day VERDICT with an operational LIFETIME SPEND
// and rendered the pair as a single "protected spend" figure.
//
// The frontend was a second analytics engine that disagreed with the first. This
// service is the first one, made authoritative: the backend owns the arithmetic
// and publishes the provenance, and a renderer renders.
//
// THE POPULATION, AND WHY IT IS THE ONLY ONE
// -------------------------------------------
// Canonical CUMULATIVE_30D campaign rows, via getCanonicalVerdictCampaigns —
// the same rows the verdicts are computed from. That identity is the point:
// spend-by-verdict is only meaningful when the spend and the verdict describe
// the same measurement. Handing this service operational rows would reproduce
// exactly the mixture it exists to end (see AccountHealthService's header for
// what that cost the last time).
//
// FOUR WAYS A NUMBER CAN BE ABSENT, AND THEY ARE NOT THE SAME
// ------------------------------------------------------------
//   no rows at all            → the whole aggregate is null (nothing to describe)
//   rows, nothing measured    → value null, `unavailable` names why
//   rows in two currencies    → value null, MIXED_CURRENCY — never a sum
//   measured, and it was zero → 0, which is a real answer and is reported as one
//
// A zero is a measurement. It is never produced by absence here.
//
// ── WHAT THIS MAKES OBSOLETE (B2 §20 — documented, NOT deleted) ─────────────
// The frontend keeps calculating these until the rebuild consumes this endpoint.
// Deleting them is the rebuild's job; naming them is this slice's, so nothing is
// quietly left behind as a second answer.
//
//   client/src/features/overview/overviewDerive.js
//     overviewKpis()          → spend, cpa      (operational rows, no period)
//     partitionDecisions()    → healthySpend    ← canonical VERDICT + operational
//                                                SPEND in one figure, the mix §12
//                                                names. Replaced by spendByVerdict.
//     countKillVerdicts()     → KILL count      → verdicts.KILL
//
//   client/src/features/campaigns/CampaignsView.jsx
//     connectorAgg            → spend, blendedCpa
//     totals                  → spend, kill/hold/scale spend lanes
//     currency (useMemo)      → "first non-USD currency wins", then sum
//                               everything under it. Replaced by an explicit
//                               refusal: two currencies, no number.
//
//   client/src/hooks/useCampaignFeed.js
//     summarize()             → blendedCpa as `cpaSum / cpaCount` — a MEAN OF
//                               PER-CAMPAIGN CPAs, which is a different quantity
//                               from a blended CPA and the reason two surfaces
//                               could both be "right" and disagree.
// ============================================================
import { VERDICT } from '../verdict-engine/verdictTypes.js';
import { getConnectorVerdicts, evaluateConnectorVerdicts } from '../verdict-engine/index.js';
import { CANONICAL_VERDICT_EVIDENCE_BASIS } from '../verdict-engine/canonicalVerdictEvidence.js';
import { logger } from '../../utils/logger.js';

/** Why a value that could have existed does not. Explicit beats a bare null. */
export const UNAVAILABLE = Object.freeze({
  // No contributing row reported the field at all. Distinct from a measured 0.
  NOT_MEASURED:    'NOT_MEASURED',
  // The rows are denominated in more than one currency and nothing in this
  // system converts between them. Summing would produce a number in no currency.
  MIXED_CURRENCY:  'MIXED_CURRENCY',
  // Spend is known, conversions are not (or are zero) — so the ratio has no
  // denominator. Reported separately from NOT_MEASURED because the fix differs:
  // one waits for a sync, the other waits for conversion tracking.
  NO_CONVERSIONS:  'NO_CONVERSIONS',
});

/** How well the contributing rows agree about the period they measured. */
export const BOUNDS_STATUS = Object.freeze({
  // Every contributing row reported the same start and end.
  REPORTED:    'REPORTED',
  // The rows report bounds, but not all the same ones. Every row is still a
  // CUMULATIVE_30D measurement — they are thirty-day windows ending on different
  // days, which is what a rolling per-campaign sync genuinely produces.
  //
  // The union is NOT reported in that case, and this is the whole reason the
  // status exists: a campaign measured 1–30 Jun plus one measured 1–30 Jul is
  // not "1 Jun → 30 Jul" of spend. Publishing that span would invent a period no
  // row measured — the exact fabrication this track exists to end.
  NON_UNIFORM: 'NON_UNIFORM',
  // At least one contributing row carried no bounds. The platform did not say,
  // and `date` (the sync timestamp) is not a substitute.
  NOT_REPORTED: 'NOT_REPORTED',
});

/** Currency agreement across the contributing rows. */
export const CURRENCY_STATUS = Object.freeze({
  SINGLE:  'SINGLE',
  MIXED:   'MIXED',
  UNKNOWN: 'UNKNOWN', // no row stated a currency
});

/**
 * THE AGGREGATION LEVEL, fixed and singular.
 *
 * Campaign. Not ad-set, not ad, and never two of them added together — an
 * ad-set's spend is a SUBSET of its campaign's, so summing both counts the same
 * money twice. The canonical selector reads `entityLevel: CAMPAIGN` and returns
 * nothing else, so this is enforced by the query rather than trusted here; the
 * constant exists so the contract is stated on the answer and can be asserted.
 */
export const AGGREGATION_LEVEL = 'CAMPAIGN';

/** PURE: is this a real, usable number? (null, undefined and NaN are not.) */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * PURE: reduce the contributing rows to one currency, or refuse.
 * @returns {{ currency: string|null, status: string }}
 */
export function resolveCurrency(campaigns = []) {
  const seen = new Set();
  for (const c of campaigns) if (c?.currency) seen.add(c.currency);
  if (seen.size === 0) return { currency: null, status: CURRENCY_STATUS.UNKNOWN };
  if (seen.size === 1) return { currency: [...seen][0], status: CURRENCY_STATUS.SINGLE };
  // No conversion contract exists anywhere in this system, and inventing one
  // inside an aggregate would be the worst possible place for it. The frontend's
  // old heuristic — "first non-USD currency wins", then sum everything under it
  // — is precisely what this refuses to do.
  return { currency: null, status: CURRENCY_STATUS.MIXED };
}

/**
 * PURE: what period do these rows describe?
 *
 * The window LABEL comes from the rows, not from the selector's constant — the
 * same rule B1 established at the verdict payload. Bounds are reported only when
 * every contributing row agrees on them.
 */
export function resolvePopulationWindow(campaigns = []) {
  const windows = new Set();
  let starts = new Set(); let ends = new Set();
  let anyMissing = false;

  for (const c of campaigns) {
    windows.add(c?.measurementWindow ?? null);
    const s = c?.windowStart ?? null;
    const e = c?.windowEnd ?? null;
    if (s == null || e == null) { anyMissing = true; continue; }
    starts.add(new Date(s).getTime());
    ends.add(new Date(e).getTime());
  }

  // One label or none. Rows disagreeing about their own window means the
  // population is not what it claims, and no single label can describe it.
  const measurementWindow = windows.size === 1 ? [...windows][0] : null;

  if (anyMissing || starts.size === 0) {
    return { measurementWindow, windowStart: null, windowEnd: null, boundsStatus: BOUNDS_STATUS.NOT_REPORTED };
  }
  if (starts.size > 1 || ends.size > 1) {
    return { measurementWindow, windowStart: null, windowEnd: null, boundsStatus: BOUNDS_STATUS.NON_UNIFORM };
  }
  return {
    measurementWindow,
    windowStart: new Date([...starts][0]),
    windowEnd:   new Date([...ends][0]),
    boundsStatus: BOUNDS_STATUS.REPORTED,
  };
}

/** PURE: an all-verdicts-zero shell, used ONLY once rows are known to exist. */
const emptyVerdictMap = (fill) => Object.fromEntries(Object.values(VERDICT).map((v) => [v, fill]));

/**
 * PURE: the authoritative account aggregate.
 *
 * @param {Array<object>} campaigns — canonical CUMULATIVE_30D campaign rows from
 *   getCanonicalVerdictCampaigns. NOT getConnectorCampaigns: those are
 *   operational aggregates of an unstated period, and mixing them with canonical
 *   verdicts is the defect this service was built to remove.
 * @param {Record<string, {verdict?: string}>} verdictMap — keyed by entityId,
 *   from getConnectorVerdicts. A campaign absent here has NO verdict (the engine
 *   gated it out for want of data) — its spend is reported as unverdicted rather
 *   than being quietly dropped into a bucket.
 * @returns {null|object} null when there are no rows at all — there is nothing
 *   to describe, and a shell of zeroes would be a claim about an account nothing
 *   was measured on.
 */
export function computeAccountAggregate(campaigns, verdictMap = {}) {
  if (!Array.isArray(campaigns) || campaigns.length === 0) return null;

  const { currency, status: currencyStatus } = resolveCurrency(campaigns);
  const mixed = currencyStatus === CURRENCY_STATUS.MIXED;

  let spendMinor = 0, sawSpend = false;
  let conversions = 0, sawConversions = false;
  // Counts are established for every verdict in the taxonomy the moment rows
  // exist: a 0 here means "we looked at N campaigns and none carried this
  // verdict", which is measured, not assumed.
  const verdicts = emptyVerdictMap(0);
  const spendByVerdict = emptyVerdictMap(0);
  let unverdicted = 0, unverdictedSpendMinor = 0;

  for (const c of campaigns) {
    const spend = isNum(c?.spendMinor) ? c.spendMinor : null;
    if (spend != null) { spendMinor += spend; sawSpend = true; }
    if (isNum(c?.conversions)) { conversions += c.conversions; sawConversions = true; }

    const verdict = verdictMap?.[c?.entityId]?.verdict ?? null;
    // An unknown verdict string is NOT silently bucketed — it would create a key
    // outside the taxonomy and make the counts unsummable against it.
    if (verdict != null && Object.prototype.hasOwnProperty.call(verdicts, verdict)) {
      verdicts[verdict] += 1;
      if (spend != null) spendByVerdict[verdict] += spend;
    } else {
      unverdicted += 1;
      if (spend != null) unverdictedSpendMinor += spend;
    }
  }

  // ── Blended CPA: ONE division, over the account's own totals ───────────────
  // Σspend / Σconversions. NOT the mean of per-campaign CPAs, which weights a
  // campaign that spent 50 the same as one that spent 50,000 and is simply a
  // different quantity — the legacy feed has been publishing that under this
  // name (useCampaignFeed.js), which is half of why two surfaces disagreed.
  const spendKnown = sawSpend && !mixed;
  const blendedCpaMinor = spendKnown && sawConversions && conversions > 0
    ? Math.round(spendMinor / conversions)
    : null;

  return {
    aggregationLevel: AGGREGATION_LEVEL,
    population: {
      ...resolvePopulationWindow(campaigns),
      // What the SELECTOR declared, beside what the rows said. Both, never one
      // standing in for the other — a disagreement between them is a fact worth
      // being able to see.
      declaredWindow: CANONICAL_VERDICT_EVIDENCE_BASIS.measurementWindow,
      campaignCount:  campaigns.length,
    },
    currency,
    currencyStatus,
    spend: {
      minor: spendKnown ? spendMinor : null,
      unavailable: spendKnown ? null
        : mixed ? UNAVAILABLE.MIXED_CURRENCY : UNAVAILABLE.NOT_MEASURED,
    },
    acquisition: {
      // Currency-free, so it survives MIXED_CURRENCY intact — a count is a count
      // whatever the money was denominated in.
      conversions: sawConversions ? conversions : null,
      blendedCpaMinor,
      unavailable: blendedCpaMinor != null ? null
        : mixed ? UNAVAILABLE.MIXED_CURRENCY
          : !sawSpend ? UNAVAILABLE.NOT_MEASURED
            : UNAVAILABLE.NO_CONVERSIONS,
    },
    // Counts, not money — unaffected by currency.
    verdicts: { ...verdicts, unverdicted },
    spendByVerdict: spendKnown
      ? { ...spendByVerdict, unverdicted: unverdictedSpendMinor }
      : null,
    spendByVerdictUnavailable: spendKnown ? null
      : mixed ? UNAVAILABLE.MIXED_CURRENCY : UNAVAILABLE.NOT_MEASURED,
  };
}

/**
 * Read the canonical population and aggregate it. The route's whole job is to
 * call this (PR#15+ rule: graph and aggregation logic never live in a handler).
 *
 * ONE EVIDENCE READ (R8 / I25). The canonical campaign rows are taken from the
 * evaluation rather than fetched again beside it — `evaluateConnectorVerdicts`
 * already read them to build the tree, and they are the same rows the verdicts
 * were computed from. Re-reading would be a second read of the same population
 * in the same request, and worse, a second read that could disagree with the
 * verdicts it is being joined to.
 *
 * That is also why this service does not call getCanonicalVerdictCampaigns
 * directly: the canonical read has exactly one verdict consumer
 * (verdictAuthority.test.js), and an aggregate keyed BY verdict is a verdict
 * consumer. It takes what the authority produced.
 *
 * @param {string} workspaceId
 * @param {object} [opts]
 * @param {object} [opts.evaluation] — an evaluation already produced for THIS
 *   workspace (a sweep's single pass). Supplied, nothing is recomputed.
 * @returns {Promise<object|null>} null when the workspace has no canonical rows.
 */
export async function getAccountAggregate(workspaceId, { evaluation } = {}) {
  if (!workspaceId) return null;

  // Throws on a failed evidence read rather than degrading to an empty result,
  // which would render as "this account has nothing in it" — the exact collapse
  // I29 forbids. The caller turns a throw into an honest 500.
  const ev = evaluation ?? await evaluateConnectorVerdicts(workspaceId);
  const verdictResult = await getConnectorVerdicts(workspaceId, { evaluation: ev });

  const campaigns = ev.campaigns ?? [];
  const verdictMap = Object.fromEntries((verdictResult?.verdicts ?? []).map((v) => [v.id, v]));
  const aggregate = computeAccountAggregate(campaigns, verdictMap);

  logger.info(
    {
      workspaceId,
      campaigns: campaigns.length,
      currencyStatus: aggregate?.currencyStatus ?? null,
      bounds: aggregate?.population?.boundsStatus ?? null,
    },
    '[accountAggregate] computed',
  );
  return aggregate;
}
