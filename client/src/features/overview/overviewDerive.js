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

// PURE: the four Overview KPI values, CONNECTOR-FIRST (mirrors CampaignsView's
// live-XOR-legacy rule) so a synced workspace's headline matches the Campaigns
// page instead of the disjoint legacy CampaignState feed. Every figure is
// null-when-absent → the card renders "—", never a fabricated 0. Spend/CPA come
// from the live connector aggregate; Wasted/Health from the deterministic engine
// (health). The legacy summary is used ONLY when no channel has synced.
export function overviewKpis({ connectorCampaigns = [], summary = null, health = null, currency = 'USD' }) {
  let spendMinor = 0, conversions = 0, sawSpend = false, sawConv = false, cur = null;
  for (const c of connectorCampaigns) {
    if (c.spendMinor != null) { spendMinor += c.spendMinor; sawSpend = true; }
    if (c.conversions != null) { conversions += c.conversions; sawConv = true; }
    if (!cur && c.currency) cur = c.currency;
  }
  const live = connectorCampaigns.length > 0;
  const kpiCurrency = cur || currency;
  return {
    live,
    currency: kpiCurrency,
    spend: live ? (sawSpend ? spendMinor / 100 : null) : (summary?.spend > 0 ? summary.spend : null),
    cpa:   live ? (sawConv && conversions > 0 ? spendMinor / conversions / 100 : null) : (summary?.blendedCpa ?? null),
    wasted: health?.wastedSpend?.minor != null
      ? fromMinor(health.wastedSpend.minor, kpiCurrency)
      : (live ? null : (summary?.wasted > 0 ? summary.wasted : null)),
    health: health?.score ?? (live ? null : (summary?.health ?? null)),
  };
}

/**
 * PURE: the Account-health card's tone + caption, derived from the real score.
 *
 * A null score has TWO causes and they are DIFFERENT claims: the health fetch
 * has not landed yet, or it landed and scored nothing. "No score yet" asserts
 * the second — saying it during the first is the false-absence bug the readiness
 * gate exists to prevent (see useOverviewModel).
 */
export function healthPresentation({ score = null, loading = false } = {}) {
  return {
    tone: score == null ? 'neutral'
        : score >= 75 ? 'positive'
        : score >= 50 ? 'warn' : 'danger',
    label: score != null
      ? (score >= 75 ? 'Healthy'
        : score >= 50 ? 'Fair — review soon' : 'Needs attention')
      : (loading ? 'Scoring…' : 'No score yet'),
  };
}

/**
 * PURE: the real count of KILL-verdict campaigns — from the connector health
 * engine when synced, else the legacy feed's alerts. No fabricated count.
 */
export function countKillVerdicts({ live = false, healthCampaigns = [], legacyCampaigns = [] } = {}) {
  return live
    ? healthCampaigns.filter((c) => c.verdict === 'KILL').length
    : legacyCampaigns.reduce(
      (n, c) => n + (c.alerts || []).filter((a) => a.analysis?.verdict === 'KILL').length,
      0,
    );
}
