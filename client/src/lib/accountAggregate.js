// ============================================================
// MARCOM / Lumi — the account aggregate, read once  (PARITY-01)
// ------------------------------------------------------------
// PURE. Turns `GET /api/lumi/account/aggregate` plus the state of that read
// into the values a KPI card renders and the sentence it prints when there is
// no value to render.
//
// ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
// It is not a helper. It is the single place the account's headline numbers are
// read, because two places is exactly what went wrong:
//
//   • `features/overview/overviewDerive.js` summed `spendMinor` and divided by a
//     hardcoded 100. `features/campaigns/CampaignsView.jsx` summed the same rows
//     and divided by `fromMinor()`. A dinar is 1000 fils, so on a KWD, BHD or
//     JOD workspace Attention printed a Total Spend TEN TIMES the one Campaigns
//     printed, from the same rows, in the same session.
//
//   • Both walked the array taking the FIRST currency they saw and then summed
//     every campaign's minor units under it — producing, on a mixed-currency
//     account, a figure denominated in nothing.
//
//   • Campaigns decided it had data with `campaigns.length > 0`, so a FAILED
//     read arrived as the label "No data yet": a claim about the operator's
//     account, asserted by a request that never landed.
//
// `AccountAggregateService` already refuses all three — it resolves the currency
// or declines to answer, divides ONE total by ONE total, and distinguishes an
// outage (500) from an unmeasured account (`available: false`). None of that was
// reaching a screen, because nothing called it. So the derivation moves out of
// both surfaces and this module reads the canonical answer instead.
//
// ── THE RULE THIS ENCODES ───────────────────────────────────────────────────
//     hasData ≠ read succeeded
// Absence has SEVEN causes here and they are seven different claims. Exactly
// four are statements about the account; the other three are statements about
// the request — it has not come back, it failed, or this seat may not make it.
// Collapsing them is how a surface tells an operator their account is empty
// because our database was.
// ============================================================
import { fromMinor } from '@/lib/money';

/**
 * Why there is no number.
 *
 * NOT_MEASURED · MIXED_CURRENCY · NO_CONVERSIONS are the server's own
 * `UNAVAILABLE` vocabulary, proved equal to it in
 * src/tests/accountAggregateParity.test.js. The others describe the READ, which
 * the server cannot know about — and NO_MEASUREMENT is the hinge between them:
 * the only absence here that the server measured and confirmed.
 */
export const AGGREGATE_ABSENCE = Object.freeze({
  // The request has not come back yet. Says nothing about the account.
  LOADING: 'LOADING',
  // The request failed. Says nothing about the account either — this is the one
  // that used to render as "No data yet".
  READ_FAILED: 'READ_FAILED',
  // The request SUCCEEDED and the account holds no canonical measurement. The
  // only one of the four that is a fact about the operator's account.
  NO_MEASUREMENT: 'NO_MEASUREMENT',
  // Measured, but this field was not reported by any contributing row.
  NOT_MEASURED: 'NOT_MEASURED',
  // The rows are in more than one currency and nothing converts between them.
  MIXED_CURRENCY: 'MIXED_CURRENCY',
  // Spend is known; conversions are not, so the ratio has no denominator.
  NO_CONVERSIONS: 'NO_CONVERSIONS',
  // The seat may not read this aggregate — the endpoint is BUYER|STRATEGIST.
  // An authorization refusal is an honest locked state: not a failure, and
  // certainly not an empty account. Same rule useIncrementality follows for its
  // own tier gate.
  NOT_PERMITTED: 'NOT_PERMITTED',
});

// One sentence per absence, because a token cannot replace a reason (C-07) —
// the three "no money figure" cases have three different next steps, and an
// operator who reads "No data yet" during an outage goes and checks their ad
// account instead of retrying.
const LABEL = Object.freeze({
  [AGGREGATE_ABSENCE.LOADING]:        'Checking…',
  [AGGREGATE_ABSENCE.READ_FAILED]:    'Couldn’t read this account',
  [AGGREGATE_ABSENCE.NO_MEASUREMENT]: 'No data yet',
  [AGGREGATE_ABSENCE.NOT_MEASURED]:   'Not measured yet',
  [AGGREGATE_ABSENCE.MIXED_CURRENCY]: 'Mixed currencies — no single total',
  [AGGREGATE_ABSENCE.NO_CONVERSIONS]: 'No conversions tracked yet',
  [AGGREGATE_ABSENCE.NOT_PERMITTED]:  'Not available for this seat',
});

const SOURCE_LABEL = 'Live · connector';

/** The card's period caption, from the ROWS — not a caption typed into a view. */
function windowCaption(population) {
  const label = population?.measurementWindow ?? null;
  if (label === 'CUMULATIVE_30D') return 'last 30 days';
  if (label == null) return 'period varies by campaign';
  return label.toLowerCase().replace(/_/g, ' ');
}

/** PURE: minor units → major, or null. Never guesses an exponent. */
function major(minorAmount, currency) {
  if (minorAmount == null || !currency) return null;
  return fromMinor(minorAmount, currency);
}

/**
 * PURE: the one reading of the account aggregate.
 *
 * @param {object} input
 * @param {object|null} input.response — the parsed AccountAggregateResponse
 * @param {boolean}     input.loading
 * @param {Error|null}  input.error
 * @param {boolean}     input.forbidden — a 403: not a failure, not an absence
 * @returns {{
 *   spend: number|null, blendedCpa: number|null, currency: string|null,
 *   conversions: number|null, campaignCount: number|null,
 *   windowLabel: string|null, windowCaption: string, boundsKnown: boolean,
 *   spendAbsence: string|null, cpaAbsence: string|null,
 *   spendLabel: string, cpaLabel: string|null, available: boolean|null,
 * }}
 */
export function accountAggregateReading({
  response = null, loading = false, error = null, forbidden = false,
} = {}) {
  const blank = (absence) => ({
    spend: null,
    blendedCpa: null,
    currency: null,
    conversions: null,
    campaignCount: null,
    windowLabel: null,
    windowCaption: '',
    boundsKnown: false,
    spendAbsence: absence,
    cpaAbsence: absence,
    spendLabel: LABEL[absence],
    cpaLabel: LABEL[absence],
    available: null,
  });

  // A known failure outranks a retry in flight: saying "checking" while we know
  // the last answer failed is the softer, less true of the two.
  if (forbidden) return blank(AGGREGATE_ABSENCE.NOT_PERMITTED);
  if (error) return blank(AGGREGATE_ABSENCE.READ_FAILED);
  if (loading || !response) return blank(AGGREGATE_ABSENCE.LOADING);

  // The server measured the account and found no canonical rows. `reason` is
  // carried through rather than re-derived — this is the ONE case where "no
  // data yet" is a true sentence, and it is true because the server said so.
  if (!response.available || !response.aggregate) {
    return { ...blank(AGGREGATE_ABSENCE.NO_MEASUREMENT), available: false };
  }

  const agg = response.aggregate;
  const spendAbsence = agg.spend.unavailable ?? null;
  const cpaAbsence = agg.acquisition.unavailable ?? null;

  return {
    spend: major(agg.spend.minor, agg.currency),
    blendedCpa: major(agg.acquisition.blendedCpaMinor, agg.currency),
    currency: agg.currency,
    conversions: agg.acquisition.conversions,
    campaignCount: agg.population.campaignCount,
    windowLabel: agg.population.measurementWindow,
    windowCaption: windowCaption(agg.population),
    // Bounds travel only when every contributing row reported the SAME ones.
    boundsKnown: agg.population.boundsStatus === 'REPORTED',
    spendAbsence,
    cpaAbsence,
    // `spendLabel` always says something: when the figure IS there it names its
    // provenance, because the Campaigns card has printed a source line under
    // Total Spend since that card existed. `cpaLabel` is null when the number is
    // present — the CPA card's own caption belongs to the surface, not here.
    spendLabel: spendAbsence ? LABEL[spendAbsence] : SOURCE_LABEL,
    cpaLabel: cpaAbsence ? LABEL[cpaAbsence] : null,
    available: true,
  };
}

// The empty-state reason the route publishes. Named here so the parity test can
// see that the branch above is keyed to the word the server actually sends:
// NO_CANONICAL_MEASUREMENT.
export const NO_CANONICAL_MEASUREMENT = 'NO_CANONICAL_MEASUREMENT';
