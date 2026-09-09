// ============================================================
// MARCOM / Lumi — Overview derivations (PURE)
// ------------------------------------------------------------
// Every value the Home page shows that is COMPUTED rather than fetched. No
// React, no hooks, no network — each function takes the substrates it reads and
// returns a plain value, so the honesty rules below are unit-testable without a
// DOM and cannot drift into a component.
//
// Lifted out of OverviewView.jsx unchanged. The page carried its own three
// exported derivations plus two inline ones, which put the rules about what may
// be claimed in the same file as the markup that claims it.
//
// The invariant that runs through all of it: a figure no substrate carries stays
// NULL. "not measured" is never rendered as 0, and never rendered at all — the
// caller drops the line. See overviewState.js for the same rule applied to the
// hero's sentences.
// ============================================================
import { fromMinor } from '@/lib/money';
import { nextActionFor } from '@/features/campaigns/verdictEvidence.js';

// PURE: the decision feed — health rows (verdict + impact + name, the ONLY
// source of impactScore) joined to their connector row for the metrics
// ExecutionContext needs, and to the verdict row for the engine's own rationale.
// Three sources because no single one carries all of it; the join key is
// entityId throughout. A field absent everywhere stays null → the card omits
// that line rather than inventing it.
//
// The join carries EVERY scored campaign; partitionDecisions below owns which
// ones surface where. (It used to pre-filter to KILL + high-impact WATCH — that
// would have starved the calm sections of the only rows they can ever show.)
export function decisionFeed({ healthCampaigns = [], connectorCampaigns = [], verdicts = [] }) {
  const metricsById = new Map(connectorCampaigns.map((c) => [c.entityId, c]));
  const rationaleById = new Map(verdicts.map((v) => [v.id, v.rationale ?? null]));
  // R13-b — the STORED decision's identity and the judgement on it, from the
  // same verdict rows the rationale comes from. Keyed by the same entityId as
  // everything else here.
  //
  // Threaded rather than re-fetched: the id is already on the payload this page
  // loads, and a second lookup ("which decision belongs to this campaign?")
  // would be a GUESS — the very thing the decisionId contract exists to stop.
  // A campaign with no stored decision keeps `decisionId: null`, and the card
  // renders no judgement UI at all.
  const decisionById = new Map(verdicts.map((v) => [v.id, v]));

  return healthCampaigns
    .map((c) => {
      const m = metricsById.get(c.entityId) ?? {};
      const d = decisionById.get(c.entityId) ?? {};
      return {
        entityId: c.entityId,
        // R13-b · decision identity + the judgement on record. Null throughout
        // for a campaign no sweep has written a Decision for — a real answer,
        // and the signal DecisionCard uses to ask nothing.
        decisionId: d.decisionId ?? null,
        humanResponse: d.humanResponse ?? null,
        humanReasonCode: d.humanReasonCode ?? null,
        humanReasonNote: d.humanReasonNote ?? null,
        humanRespondedAt: d.humanRespondedAt ?? null,
        name: c.name ?? m.name ?? null,
        verdict: c.verdict,
        impactScore: c.impactScore ?? null,
        rationale: rationaleById.get(c.entityId) ?? null,
        // The next step a KILL/SCALE asks for — the engine-adjacent helper the
        // Campaigns detail panel already uses, never an invented instruction.
        humanAction: nextActionFor(c.verdict),
        ctr: m.ctr ?? null,
        spendMinor: m.spendMinor ?? null,
        currency: m.currency ?? null,
      };
    });
}

// The three bands, exhaustive over the VERDICT enum
// (verdict-engine/verdictTypes.js): KILL/REALLOCATE ask for an intervention now,
// WATCH/REFRESH are worth monitoring, HOLD/SCALE are working. A campaign the
// engine returned no verdict for belongs to none of them and is not counted —
// "unscored" is not "healthy".
const ACT_NOW_VERDICTS  = ['KILL', 'REALLOCATE'];
const WATCH_VERDICTS    = ['WATCH', 'REFRESH'];
const HEALTHY_VERDICTS  = ['HOLD', 'SCALE'];

// How many cards a band shows before deferring to the Campaigns page. The home
// is a triage surface, not a list — the TOTAL is always reported alongside, so
// capping never hides how much is really there.
export const SECTION_CAP = 3;

// Impact first; spend breaks the tie. Without the tie-break, equal-impact rows
// keep whatever order the health route happened to return, so the same account
// can re-order between renders — and "highest impact first" stops being a claim
// the page can back up.
const byImpactThenSpend = (a, b) =>
  (b.impactScore ?? 0) - (a.impactScore ?? 0) || (b.spendMinor ?? 0) - (a.spendMinor ?? 0);

/**
 * PURE: split the feed into the three bands, sorted and capped.
 * Returns the capped rows AND the true total per band, so the "view all N" link
 * quotes the real count rather than the number of cards on screen.
 */
export function partitionDecisions(feed = []) {
  const band = (verdicts) => feed.filter((d) => verdicts.includes(d.verdict)).sort(byImpactThenSpend);
  const actionable = band(ACT_NOW_VERDICTS);
  const watching   = band(WATCH_VERDICTS);
  const healthy    = feed.filter((d) => HEALTHY_VERDICTS.includes(d.verdict));

  // Protected spend stays NULL when not one healthy campaign reported a spend —
  // "nothing measured" is not "zero protected". A row missing its own spend just
  // contributes nothing to the sum.
  let healthySpend = null;
  let healthyCurrency = null;
  for (const d of healthy) {
    if (d.spendMinor != null) healthySpend = (healthySpend ?? 0) + d.spendMinor;
    if (!healthyCurrency && d.currency) healthyCurrency = d.currency;
  }

  return {
    actNow:      actionable.slice(0, SECTION_CAP),
    actNowTotal: actionable.length,
    watchNow:    watching.slice(0, SECTION_CAP),
    watchTotal:  watching.length,
    healthyCount: healthy.length,
    healthySpend,
    healthyCurrency,
  };
}

// PURE: the four Overview KPI values.
//
// PARITY-01 — spend and CPA are READ from the canonical account aggregate now,
// not derived here. What this function used to do, and why it may never do it
// again: it summed `spendMinor` across the connector campaigns, took the FIRST
// currency it saw as the currency of the total, and divided by a hardcoded 100.
//
//     spend: live && sawSpend ? spendMinor / 100 : null
//
// Campaigns did the same sum with `fromMinor()` — the currency's real exponent —
// so on a KWD, BHD or JOD workspace (1000 fils to the dinar) the two axes
// printed figures differing by a factor of TEN for the same rows. This file
// imports fromMinor and used it on the very next line, for the wasted-spend
// card: the defect was not ignorance of the rule, it was the second derivation.
//
// `AccountAggregateService` resolves the currency or refuses to answer, and
// divides ONE total by ONE total. Reading it is the fix; deleting the loop is
// what stops the fix from being undone. Wasted spend and health still come from
// the deterministic health engine — a different substrate, unchanged here.
//
// Every figure is null-when-absent → the card renders "—", never a fabricated 0.
//
// FE-03 — the `summary` parameter is gone with the substrate behind it. It held
// the legacy CampaignState feed's roll-up, used "ONLY when no channel has
// synced", and `GET /lumi/feed` stopped publishing `campaigns` in S1-B — so
// every one of those fallbacks read `summarize([])`.
//
// ⚠️ THREE OF THE FOUR DEGRADED HONESTLY AND ONE DID NOT, and the difference was
// the guard, not the data:
//
//     spend   summary?.spend  > 0 ? … : null     → null   ✅
//     wasted  summary?.wasted > 0 ? … : null     → null   ✅
//     cpa     summary?.blendedCpa ?? null        → null   ✅ (it really was null)
//     health  summary?.health     ?? null        → 0      ❌
//
// because `summarize()` returns `health: 0` as its own "nothing scored"
// sentinel, and `0 ?? null` is 0. That 0 flowed into healthPresentation →
// `{ tone: 'danger', label: 'Needs attention' }`, and KpiStrip renders
// `${kpis.health}/100`. It never reached a pixel — KpiStrip is gated on
// `hasAnyData`, which equalled `live` exactly, the same condition that made the
// branch unreachable — so this is a hazard removed, not a bug caught in the
// wild. Removing the parameter retires it by construction rather than leaving
// it standing behind a coincidence between two files.
export function overviewKpis({ aggregate = null, health = null, currency = 'USD' }) {
  // The aggregate names its own currency; the workspace's is the fallback for
  // the wasted-spend card, which comes from a different service and is still
  // denominated even when the account aggregate refuses to be.
  const kpiCurrency = aggregate?.currency ?? currency;
  return {
    live: aggregate?.available === true,
    currency: kpiCurrency,
    spend: aggregate?.spend ?? null,
    cpa: aggregate?.blendedCpa ?? null,
    // The card's captions come from the ANSWER, not from the markup: the period
    // the rows reported, and — when there is no figure — which absence this is.
    // "last 30 days" was typed into KpiStrip and asserted for every account,
    // including ones whose rows do not agree on a window.
    spendCaption: aggregate?.windowCaption || '',
    spendLabel: aggregate?.spendLabel ?? null,
    cpaLabel: aggregate?.cpaLabel ?? null,
    wasted: health?.wastedSpend?.minor != null ? fromMinor(health.wastedSpend.minor, kpiCurrency) : null,
    health: health?.score ?? null,
  };
}

/**
 * PURE: the Account-health card's tone + caption.
 *
 * RULING (Omar): **one engine fact → one published vocabulary → zero client
 * reclassification.**
 *
 * This function used to CLASSIFY. It re-thresholded `score` into a vocabulary
 * of its own while `AccountHealthService.healthLabel` published five bands from
 * the same number:
 *
 *     engine     ≥80 HEALTHY · ≥60 GOOD · ≥40 FAIR · ≥20 NEEDS ATTENTION · CRITICAL
 *     here       ≥75 Healthy · ≥50 "Fair — review soon" · else "Needs attention"
 *
 * SUBJECT/Campaigns rendered the engine's label and NOW/Attention rendered this
 * one, so the two axes printed different verdicts about ONE account, from ONE
 * score, in the same KPI-sub-label role — on 50 of the 101 integer scores.
 * `AccountHealthService.test.js` pins `healthLabel(70) === 'GOOD'`; this surface
 * printed "Fair — review soon" for that score. And CRITICAL had no band here at
 * all: the engine's worst state read in the same words as a score of 30, on the
 * axis whose whole job is what matters NOW.
 *
 * So the band is now the engine's, passed through. There is no enum: a band this
 * client has never heard of renders verbatim rather than blanking the card,
 * which is B8-01's hazard avoided rather than re-armed.
 *
 * ── WHAT DID NOT CHANGE ─────────────────────────────────────────────────────
 * The TONE ladder. Visual severity is a separate question from the semantic
 * band, and mixing the two into one slice was ruled out; `CampaignsView`'s own
 * colour ladder (<40 / <70) is parked beside it.
 *
 * A null band has TWO causes and they are DIFFERENT claims: the health fetch has
 * not landed yet, or it landed and scored nothing. "No score yet" asserts the
 * second — saying it during the first is the false-absence bug the readiness
 * gate exists to prevent (see useOverviewModel). `score` and `label` are
 * published together by the engine (both null in its no-data branch), so a
 * missing band is the same fact as a missing score; `accountHealthLabelParity`
 * pins that rather than assuming it.
 */
export function healthPresentation({ score = null, label = null, loading = false } = {}) {
  return {
    tone: score == null ? 'neutral'
        : score >= 75 ? 'positive'
        : score >= 50 ? 'warn' : 'danger',
    // Value wins over loading, exactly as the score used to: a refetch does not
    // retract a band the operator is already reading.
    label: label ?? (loading ? 'Scoring…' : 'No score yet'),
  };
}

/**
 * PURE: the real count of KILL-verdict campaigns, from the connector health
 * engine. No fabricated count.
 *
 * FE-03 — the `legacyCampaigns` branch counted alerts on the CampaignState feed
 * and is gone with it. It was reachable only when `!live`, which is exactly when
 * the array it counted was empty, so it could only ever return 0 — a count of
 * KILL verdicts on a substrate that has had no writer since R7.
 */
export function countKillVerdicts({ healthCampaigns = [] } = {}) {
  return healthCampaigns.filter((c) => c.verdict === 'KILL').length;
}
