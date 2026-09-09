// ============================================================
// MARCOM / Lumi — useGrowthStrategySummary
// ------------------------------------------------------------
// Composition layer — CONNECTOR substrate only. Repoints the
// Growth Strategy "Active Campaigns" tile to the same source
// CampaignsView counts (useConnectorCampaigns), replacing the
// legacy CampaignState-feed summary that counted only campaigns
// with a pending Action. Strategic Bets + Memory Layer stay on
// the legacy feed (they read Action/DecisionMemory rows the
// connector substrate does not produce).
//
// DELIBERATE CHOICES:
//   total    = campaigns.length from useConnectorCampaigns
//              (verified identical to CampaignsView's connector count)
//   verdicts = per-entity connector ENGINE verdict (NOT pending Actions)
//   gatedOut = surfaced per REASON, never folded into a verdict count
//              (a gated campaign is not a HOLD) and never collapsed into
//              one number (C-07: three reasons, three different fixes —
//              `needsRevenue` named one of them and counted all three)
//
// The engine emits six verdicts (KILL/HOLD/SCALE/WATCH/REALLOCATE/REFRESH,
// see verdict-engine/verdictTypes.js). This tile surfaces the four the
// Growth Strategy sub-line names; REALLOCATE/REFRESH are counted in `total`
// but not broken out here (they have their own execution surfaces).
//
// INVARIANT (tested): scaling + holding + watching + killing + gatedTotal
//   <= total  — no campaign counted twice, buckets never exceed the roster.
//   `gatedTotal` exists for that arithmetic ONLY; every surface that says
//   something to a person reads `gated` and speaks per reason.
//
// TECH DEBT (noted, not fixed here): "scaling" is overloaded across three
// layers — CampaignState.stage / Action verdict / connector engine verdict.
// A future rename (LifecycleStage vs OptimizationVerdict) would disambiguate.
// ============================================================
import { summarizeGatedOut } from '@/features/campaigns/gatingReasonCopy.js';
import { useConnectorCampaigns } from './useConnectorCampaigns.js';
import { useConnectorVerdicts } from './useConnectorVerdicts.js';

const EMPTY_SUMMARY = Object.freeze({
  total:       0,
  // Counts keyed by the verdict token itself. Four named fields stood here —
  // scaling/holding/watching/killing — which is how REALLOCATE and REFRESH came
  // to be dropped: a bucket LIST can forget a member, a map discovered from the
  // data cannot. See the counting loop.
  byVerdict:   Object.freeze({}),
  // How many verdicts we actually received, whatever they were named. The
  // breakdown's empty state is decided by this, never by whether the four words
  // it happened to know matched anything.
  scored:      0,
  // One entry per reason present, each with its own count and sentence.
  gated:       Object.freeze([]),
  gatedTotal:  0,
});

export function useGrowthStrategySummary() {
  const { campaigns, loading: cLoading, error: cError } = useConnectorCampaigns();
  const { verdicts, gatedOut, loading: vLoading, error: vError } = useConnectorVerdicts();

  const loading = cLoading || vLoading;
  const error   = cError || vError;

  // Always return a stable shape — never a null summary.
  if (loading) return { loading: true,  error: null,  summary: { ...EMPTY_SUMMARY } };
  if (error)   return { loading: false, error,        summary: { ...EMPTY_SUMMARY } };

  // total: the same connector array CampaignsView counts (no revenue filter).
  const total = campaigns?.length ?? 0;

  // Verdict counts, keyed by the token the engine actually sent.
  //
  // This was a four-bucket list — `{ SCALE, HOLD, WATCH, KILL }` — over a SIX
  // member vocabulary, and its comment called REALLOCATE/REFRESH "future verdict
  // values" that were "skipped silently". They are emitted today
  // (verdictEngine.js reaches REFRESH at 375/431/435 and REALLOCATE at 439/443),
  // so two live, actionable calls disappeared here — and when they were an
  // account's ONLY calls the breakdown came out empty and the tile said
  // "Awaiting verdicts" over decisions Lumi had already made.
  //
  // RULING (Omar): a canonical verdict cannot disappear because a downstream
  // consumer forgot that it exists. Discovering the keys from the data rather
  // than declaring them closes the class — there is no list left to forget a
  // member of, so a seventh verdict is counted the day it ships.
  const byVerdict = {};
  let scored = 0;
  for (const v of verdicts ?? []) {
    if (!v?.verdict) continue;
    byVerdict[v.verdict] = (byVerdict[v.verdict] ?? 0) + 1;
    scored += 1;
  }

  // Grouped, not counted. The single number this replaced was rendered as
  // "N need revenue data" over campaigns that needed a sync.
  const gated = summarizeGatedOut(gatedOut);

  return {
    loading: false,
    error:   null,
    summary: {
      total,
      byVerdict,
      scored,
      gated,
      gatedTotal:   gated.reduce((n, g) => n + g.count, 0),
    },
  };
}
