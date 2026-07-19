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
//   gatedOut = surfaced explicitly as needsRevenue, never folded into
//              a verdict count (a revenue-gated campaign is not a HOLD)
//
// The engine emits six verdicts (KILL/HOLD/SCALE/WATCH/REALLOCATE/REFRESH,
// see verdict-engine/verdictTypes.js). This tile surfaces the four the
// Growth Strategy sub-line names; REALLOCATE/REFRESH are counted in `total`
// but not broken out here (they have their own execution surfaces).
//
// INVARIANT (tested): scaling + holding + watching + killing + needsRevenue
//   <= total  — no campaign counted twice, buckets never exceed the roster.
//
// TECH DEBT (noted, not fixed here): "scaling" is overloaded across three
// layers — CampaignState.stage / Action verdict / connector engine verdict.
// A future rename (LifecycleStage vs OptimizationVerdict) would disambiguate.
// ============================================================
import { useConnectorCampaigns } from './useConnectorCampaigns.js';
import { useConnectorVerdicts } from './useConnectorVerdicts.js';

const EMPTY_SUMMARY = Object.freeze({
  total:        0,
  scaling:      0,
  holding:      0,
  watching:     0,
  killing:      0,
  needsRevenue: 0,
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

  // Verdict counts — four buckets kept separate (the UI decides display).
  // Defensive: any verdict outside these four (REALLOCATE/REFRESH/unknown)
  // is skipped silently, so the invariant can never be violated by a
  // future verdict value.
  const counts = { SCALE: 0, HOLD: 0, WATCH: 0, KILL: 0 };
  for (const v of verdicts ?? []) {
    if (v?.verdict && Object.prototype.hasOwnProperty.call(counts, v.verdict)) {
      counts[v.verdict]++;
    }
  }

  const needsRevenue = (gatedOut ?? []).length;

  return {
    loading: false,
    error:   null,
    summary: {
      total,
      scaling:      counts.SCALE,
      holding:      counts.HOLD,
      watching:     counts.WATCH,
      killing:      counts.KILL,
      needsRevenue,
    },
  };
}
