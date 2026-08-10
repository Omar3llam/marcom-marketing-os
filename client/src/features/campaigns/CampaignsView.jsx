// ============================================================
// MARCOM / Lumi — CampaignAnalysis  (/app/campaigns)
// ------------------------------------------------------------
// Bloomberg-terminal-style analysis report.
// All metrics derived from the live /api/lumi/feed payload.
// ============================================================
import { useMemo, useState, useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw, Loader2, Download } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { toast } from 'sonner';
import { cn } from '@/lib/utils.js';
import { useCampaignFeed, metricValue } from '@/hooks/useCampaignFeed.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { fromMinor } from '@/lib/money';
import { INDUSTRIES } from '@/pages/OnboardingPage/constants.js';
import { useCampaignAnalysis } from '@/hooks/useCampaignAnalysis.js';
import { MetricsPanel }    from '@/components/campaign-analysis/MetricsPanel.jsx';
import { PerformanceChart } from '@/components/campaign-analysis/PerformanceChart.jsx';
import { AnalysisSummary } from '@/components/campaign-analysis/AnalysisSummary.jsx';
import { ConnectorCampaignsPanel } from '@/features/campaigns/ConnectorCampaignsPanel.jsx';
import { groupCampaigns, GROUPS } from '@/features/campaigns/campaignGrouping.js';
import { fmtCurrency } from '@/components/campaign-analysis/campaignFormatters.js';
import { generateCampaignReport, generateTextReport } from '@/lib/pdfExport.js';
import { VERDICT_RANK } from '@/lib/verdictRank.js';
import { buildPdfCampaigns } from '@/features/campaigns/pdfData.js';

// The PDF is sourced from the LIVE connector substrate, so export is available
// exactly when there are synced connector campaigns (never the retired CSV feed).
// Exported (pure) so the button-gate can be unit-tested without booting the page.
export const canExportPdf = (connectorCampaigns = []) => connectorCampaigns.length > 0;

// Revenue-source → the guidance clause shown when connected campaigns can't be
// scored. Keyed by the industry's `revenueSource` (from onboarding INDUSTRIES),
// so e-commerce accounts are pointed at GA4/Shopify and services at a CRM. An
// unset/unknown industry falls back to the generic clause — no regression for
// accounts onboarded before the industry step existed.
const REVENUE_GUIDANCE = {
  GA4_SHOPIFY: 'connect GA4 or Shopify to see real ROAS',
  CRM:         'connect your CRM or confirm leads and deals are tracked',
  MANUAL:      'connect a revenue source or confirm purchase tracking',
};
const GENERIC_REVENUE_GUIDANCE = 'connect a revenue source or confirm purchase tracking';

// Flatten campaigns → rows the table can sort + render.
// Missing metrics stay null (not 0): the renderer shows "—" and the sort pushes
// them last, so an absent metric never masquerades as a real zero.
function flatten(campaigns) {
  const rows = [];
  for (const c of campaigns) {
    for (const a of c.alerts ?? []) {
      const spend = metricValue(a, 'spend') ?? metricValue(a, 'amount spent') ?? null;
      const ctr   = metricValue(a, 'CTR') ?? null;
      const roas  = metricValue(a, 'ROAS') ?? null;
      const freq  = metricValue(a, 'Frequency') ?? metricValue(a, 'Freq') ?? null;
      const verdict  = a.analysis?.verdict || 'HOLD';
      const reason   = a.analysis?.root_cause || a.action_plan?.action || '—';
      // Real channel from the feed's backing field; fall back only for the
      // static demo path (which carries no platform).
      const platform = (a.platform || a.action_plan?.kind || a.action_plan?.platform || 'META').toUpperCase();
      const impact = verdict === 'KILL' ? 9 : verdict === 'HOLD' ? 6 : verdict === 'SCALE' ? 4 : 5;
      const currency = a.currency || a._rawDecision?.currency || 'USD';  // Extract currency from alert
      rows.push({ id: a.action_id, campaign: c.campaign_id, platform, spend, ctr, roas, freq, verdict, impact, reasoning: reason, currency });
    }
  }
  return rows;
}

// Verdict sorts by action-urgency, NOT alphabetically: worst/most-actionable
// first (KILL), good news last (SCALE). The ranking itself now lives in
// lib/verdictRank.js — the PDF export sorts by the same urgency and used to keep
// its own drifted copy. An unknown verdict has no rank and sinks like a null
// metric.

// Null-last comparator: an unknown metric (or unranked verdict) is not a small
// number, so it always sinks to the bottom regardless of sort direction.
export function compareRows(a, b, key, dir) {
  if (key === 'verdict') {
    const ar = VERDICT_RANK[a.verdict], br = VERDICT_RANK[b.verdict];
    if (ar == null && br == null) return 0;
    if (ar == null) return 1;
    if (br == null) return -1;
    return dir === 'asc' ? ar - br : br - ar;
  }
  const av = a[key], bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
  return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
}

export const sortableCols = new Set(['campaign', 'spend', 'ctr', 'roas', 'verdict', 'impact']);

// PURE: split no-revenue scored campaigns (roas null) by objective. A conversion
// campaign that expects revenue but measures none is a fixable TRACKING GAP; an
// awareness campaign has no revenue BY DESIGN. `revenueExpected` is derived
// server-side from the Meta objective (connectorVerdictService.revenueExpectedFor).
// Exported for the banner unit test.
export function splitNoRevenueVerdicts(verdicts = []) {
  let awarenessCount = 0, trackingGapCount = 0;
  for (const v of verdicts) {
    if (v?.roas != null) continue;                 // has real revenue — not this banner
    if (v?.revenueExpected) trackingGapCount += 1; // conversion objective, no revenue = gap
    else awarenessCount += 1;                       // awareness/unknown objective = by design
  }
  return { awarenessCount, trackingGapCount };
}

export default function CampaignsView() {
  const { campaigns, loading } = useCampaignFeed();
  // Deep-link target from an Overview agenda item (?entity=<Campaign.id>). The
  // connector panel scrolls-to + expands that row, then calls back so we drop the
  // param (browser back/forward stays clean, a refresh won't re-trigger).
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkEntityId = searchParams.get('entity');
  const clearDeepLink = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);
  const [sortKey, setSortKey] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  // `expanded` drives the per-row reasoning expand/collapse on the CSV-fed table.
  // AdSet drill-down lives in <ConnectorCampaignsPanel> instead: it reads the
  // connector entity graph (keyed by Campaign.id UUID via /api/lumi/entities),
  // the only substrate that carries ad-set detail. The CSV feed is
  // campaign-level only, so it has nothing to drill into.
  const [expanded, setExpanded] = useState(new Set());
  const [channel, setChannel] = useState('ALL');   // CAPABILITY 2 — channel filter

  // Connector entity graph — the substrate the Sync button writes (disjoint from
  // the CSV feed above). Rendered as its own "Connected channels" section so
  // synced campaigns are visible + drillable; refetched after a successful sync.
  const {
    campaigns: connectorCampaigns,
    loading: connectorLoading,
    error: connectorError,
    refetch: refetchConnectors,
  } = useConnectorCampaigns();

  // Verdict engine over the connector campaigns WITH measured revenue. `gatedOut`
  // carries the campaigns that can't be honestly scored (no revenue) so they show
  // an explicit "needs revenue data" note, never a fabricated KILL.
  const {
    verdicts: connectorVerdicts,
    gatedOut: connectorGatedOut,
    memory: connectorMemory,
    refetch: refetchVerdicts,
  } = useConnectorVerdicts();

  // Deterministic analysis over the live connector graph: Account Health +
  // Wasted Spend + per-campaign Impact. Every number traces to a MetricSnapshot
  // row via the verdict engine — null (→ "—") when nothing can be honestly scored.
  const { health, refetch: refetchHealth } = useAccountHealth();

  const { syncing, handleMetaSync } = useCampaignAnalysis({
    refetchConnectors, refetchVerdicts, refetchHealth,
  });

  // Industry (from onboarding, surfaced on the workspace) tailors the
  // "needs revenue data" guidance below to the source this business actually uses.
  const { workspace } = useWorkspace();
  const revenueGuidance = useMemo(() => {
    const industry = INDUSTRIES.find((i) => i.id === workspace?.industry);
    return REVENUE_GUIDANCE[industry?.revenueSource] ?? GENERIC_REVENUE_GUIDANCE;
  }, [workspace?.industry]);

  const [downloading, setDownloading] = useState(false);

  const handleDownloadPdf = async () => {
    if (!canExportPdf(connectorCampaigns)) {
      toast.error('No campaign data to export');
      return;
    }

    setDownloading(true);
    // Build PDF rows from the connector graph, joining the engine verdict +
    // rationale + impact by entityId. Gated (no-revenue) campaigns are marked
    // honestly — never given a fabricated verdict.
    const reportArgs = {
      campaigns: buildPdfCampaigns({
        connectorCampaigns,
        verdictByEntityId,
        verdictInfoByEntityId,
        impactByEntityId,
        gatedOutIds: new Set((connectorGatedOut ?? []).map((g) => g.id)),
      }),
      healthScore,                       // health?.score ?? null (live engine)
      healthLabel: health?.label ?? null, // null (not the on-screen fallback) → honest PDF state
      wastedSpend: kpiWasted,            // major units, currency-correct, null when unscored
      wastedPct: kpiWastedPct,
      generatedAt: new Date().toISOString(),
      workspaceName: workspace?.name ?? null,
    };
    try {
      await generateCampaignReport(reportArgs);
    } catch (error) {
      console.error('[Campaigns] PDF generation failed:', error);
      generateTextReport(reportArgs); // text fallback, same connector data
    } finally {
      setDownloading(false);
    }
  };

  // Account-wide rows (every channel). The KPI cards + health are account-level
  // and read from this, so a channel filter narrows the *table* without
  // silently changing the headline account numbers.
  const allRows = useMemo(() => flatten(campaigns), [campaigns]);

  // Distinct channels actually present in the data (not a hardcoded list). The
  // filter only earns its place when there are ≥2 channels to separate — the
  // same "don't show it until it's real" discipline as portfolio pacing.
  const platforms = useMemo(
    () => [...new Set(allRows.map((r) => r.platform).filter(Boolean))].sort(),
    [allRows],
  );

  // Deep-link filter from Blended Truth (?channel=<CHANNEL>). Applied ONLY when
  // that channel is a real platform in the data — so an absent/unknown channel
  // (e.g. a connector-only account whose legacy table is empty) degrades to plain
  // navigation instead of stranding the user on an empty-filtered table.
  const urlChannel = searchParams.get('channel');
  useEffect(() => {
    if (urlChannel && platforms.includes(urlChannel.toUpperCase())) {
      setChannel(urlChannel.toUpperCase());
    }
  }, [urlChannel, platforms]);

  // Table rows: channel-filtered, then sorted (null metrics last).
  const tableRows = useMemo(() => {
    const filtered = channel === 'ALL' ? allRows : allRows.filter((r) => r.platform === channel);
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [allRows, channel, sortKey, sortDir]);

  // Detect primary currency from campaigns (first non-USD currency wins); fall
  // back to the workspace currency, then USD — never a hardcoded assumption.
  const currency = useMemo(() => {
    for (const row of allRows) {
      if (row.currency && row.currency !== 'USD') return row.currency;
    }
    return allRows[0]?.currency || workspace?.currency || 'USD';
  }, [allRows, workspace?.currency]);

  const totals = useMemo(() => {
    const r = { spend: 0, kill: 0, hold: 0, scale: 0, cpaSum: 0, cpaCount: 0 };
    for (const row of allRows) {
      const spend = row.spend ?? 0;   // unknown spend contributes 0, never a guess
      r.spend += spend;
      if (row.verdict === 'KILL')  r.kill  += spend;
      if (row.verdict === 'HOLD')  r.hold  += spend;
      if (row.verdict === 'SCALE') r.scale += spend;
    }
    const blendedCpa = r.cpaCount > 0 ? r.cpaSum / r.cpaCount : null;
    return { ...r, blendedCpa, wastedPct: r.spend > 0 ? Math.round((r.kill / r.spend) * 100) : 0 };
  }, [allRows]);

  // Account Health now comes from the deterministic engine (spend-weighted
  // roll-up of per-campaign verdicts over the live connector graph), NOT the
  // removed CSV analysis pipeline that left this card permanently "—". Null →
  // "—"; the label is the engine's (HEALTHY…CRITICAL), color keyed off the score.
  const healthScore = health?.score ?? null;
  const healthLabel = health?.label ?? 'Sync Meta to see health';
  const healthColor = healthScore == null ? 'text-lumi-muted' : healthScore < 40 ? 'text-trend-danger' : healthScore < 70 ? 'text-trend-warning' : 'text-trend-positive';

  // Per-campaign Impact score (1-10), keyed by entityId for the connector table.
  const impactByEntityId = useMemo(() => {
    const m = {};
    for (const c of health?.campaigns ?? []) m[c.entityId] = c.impactScore;
    return m;
  }, [health]);

  // Spend-weighted KILL/HOLD/SCALE buckets from the connector VERDICT engine —
  // same shape PerformanceChart consumes from the CSV `totals`, so the chart needs
  // no change. The engine's six verdicts coarsen into the chart's three lanes:
  // KILL→kill, SCALE→scale, everything keep-running/adjust (HOLD/WATCH/REALLOCATE/
  // REFRESH)→hold. Units are minor here — the chart only renders ratios. Only
  // revenue-eligible campaigns are present (the rest are in connectorGatedOut), so
  // a positive `spend` here means "we have honestly-scored connector spend."
  const connectorTotals = useMemo(() => {
    const t = { spend: 0, kill: 0, hold: 0, scale: 0 };
    for (const v of connectorVerdicts) {
      const spend = v.spendMinor ?? 0;
      t.spend += spend;
      if (v.verdict === 'KILL') t.kill += spend;
      else if (v.verdict === 'SCALE') t.scale += spend;
      else t.hold += spend;
    }
    return t;
  }, [connectorVerdicts]);

  // Live connector verdicts take the allocation chart when they exist (mirrors the
  // KPI strip's live-XOR-csv rule below — the two substrates never blend), else
  // the CSV-derived totals.
  const chartTotals = connectorTotals.spend > 0 ? connectorTotals : totals;

  // Join the engine verdict onto each connector campaign row (by entityId) so the
  // Connected-channels table can render a verdict badge — revenue track (KILL/
  // SCALE/HOLD) AND awareness track (REFRESH/WATCH/HOLD) alike. gatedOut campaigns
  // simply aren't in this map → the row shows "—", never a fabricated verdict.
  const verdictByEntityId = useMemo(() => {
    const m = {};
    for (const v of connectorVerdicts) m[v.id] = v.verdict;
    return m;
  }, [connectorVerdicts]);

  // How many campaigns are in the Needs Action band (KILL / REALLOCATE) — the
  // headline fact of the page. Reuses the SAME pure helper the table bands with,
  // so the count in the header can never disagree with the band below it.
  // NOTE: this is a different population from Budget at Risk, which the analysis
  // engine defines as KILL + REFRESH. The two are stated on separate lines and
  // never merged into one clause.
  const actionCount = useMemo(
    () => groupCampaigns(connectorCampaigns, verdictByEntityId)[GROUPS.ACTION].length,
    [connectorCampaigns, verdictByEntityId],
  );

  // Which campaigns had their verdict decided by the portfolio-relative post-pass
  // ('TOP' | 'BOTTOM'), keyed by entityId. Drives the evidence badge so a KILL/
  // SCALE reached WITHOUT revenue is honestly labelled with the engine's own
  // evidence (e.g. "Lowest CTR in its group"), not an absolute ROAS verdict.
  const relativeRankByEntityId = useMemo(() => {
    const m = {};
    for (const v of connectorVerdicts) if (v.relativeRank) m[v.id] = v.relativeRank;
    return m;
  }, [connectorVerdicts]);
  const hasRelativeRanking = Object.keys(relativeRankByEntityId).length > 0;

  // Rationale + confidence ride along per entity so the table badge and the
  // expanded "Why?" panel can SURFACE the engine's existing reasoning — the
  // fields already arrive on every verdict; this just keys them for the rows.
  const verdictInfoByEntityId = useMemo(() => {
    const m = {};
    // funnel / rootCause / dataConfidence are the engine's STRUCTURED
    // provenance. They arrived on every verdict row and were dropped here, so
    // the panel could only recover the leading clause of the prose — the
    // counterfactual and the recommended action were unreachable.
    for (const v of connectorVerdicts) {
      m[v.id] = {
        rationale: v.rationale,
        confidence: v.confidence,
        funnel: v.funnel ?? null,
        rootCause: v.rootCause ?? null,
        dataConfidence: v.dataConfidence ?? null,
        // The OTHER half of the same product. It has been published on every
        // verdict row since the engine started splitting the two, and no client
        // file read it — so "Low confidence" could say the data was thin but
        // never that the evidence simply did not converge.
        signalConfidence: v.signalConfidence ?? null,
        // The alternatives the engine set aside. Dropped here for the same
        // reason funnel/rootCause were until PR #309: this projection is an
        // explicit list, and a field that arrives on every verdict row still
        // has to be named to survive it. `[]` rather than null — the engine
        // returns an empty list when there was no second candidate to argue
        // against, which is a real answer and not a missing one.
        counterfactuals: v.counterfactuals ?? [],
        // The ranked candidate mechanisms. Only [0] is rendered — [1..n] are
        // the alternatives, and buildCounterfactuals is literally
        // `hypotheses.slice(1)`, so they already appear as "what we ruled out".
        // Projected whole anyway: the list is what the engine produced, and a
        // consumer that wants the rest should not have to re-fetch.
        hypotheses: v.hypotheses ?? [],
        // The STORED decision for this entity, when a sweep has written one.
        // Identity only: `decisionId` routes execute/dismiss at one row instead
        // of at a query the server re-resolves, and `decisionVerdict` is what
        // Lumi committed to THEN — beside the live verdict above, never
        // reconciled with it. Both null when no sweep has run this campaign.
        decisionId: v.decisionId ?? null,
        decisionVerdict: v.decisionVerdict ?? null,
        // The cohort a relative verdict was decided in. Unlike relativeRank
        // below this has no second route to the panel — the `relativeRanks` map
        // carries only the tag.
        relativeContext: v.relativeContext ?? null,
        // What Lumi said about this campaign BEFORE, from a separate map on the
        // same response — never a field on the verdict, so history and the
        // current call cannot edit each other. null the first time we judge a
        // campaign, which the panel renders as no Memory section at all.
        memory: connectorMemory?.[v.id] ?? null,
        // NOTE relativeRank is deliberately NOT here. It is already resolved
        // per-row in ConnectorCampaignsPanel from the `relativeRanks` map that
        // feeds the Impact badge; carrying a second copy would give the badge
        // and the reasoning block two sources for one fact.
      };
    }
    return m;
  }, [connectorVerdicts, connectorMemory]);

  // No-revenue scored campaigns split by OBJECTIVE: awareness (no revenue by
  // design) vs a conversion campaign with a tracking gap. Lumping them as one
  // "awareness" count is the exact dishonesty the objective work removed.
  const { awarenessCount, trackingGapCount } = useMemo(
    () => splitNoRevenueVerdicts(connectorVerdicts),
    [connectorVerdicts],
  );

  // Account-level aggregate from the LIVE connector graph (sums real
  // MetricSnapshot rows; null-when-absent so an unsynced metric never reads 0).
  const connectorAgg = useMemo(() => {
    let spendMinor = 0, conversions = 0, sawSpend = false, sawConv = false, cur = null;
    for (const c of connectorCampaigns) {
      if (c.spendMinor != null) { spendMinor += c.spendMinor; sawSpend = true; }
      if (c.conversions != null) { conversions += c.conversions; sawConv = true; }
      if (!cur && c.currency) cur = c.currency;
    }
    // Minor → major via the CURRENCY's real exponent, not a hardcoded /100: a
    // Gulf dinar is 1000 fils, so /100 overstated both cards 10x. The panel's
    // formatter takes major units (kpiWasted below already does this).
    const currency = cur || workspace?.currency || 'USD';
    const spendMajor = fromMinor(spendMinor, currency);
    return {
      spend: sawSpend ? spendMajor : null,
      blendedCpa: sawConv && conversions > 0 ? spendMajor / conversions : null,
      currency,
    };
  }, [connectorCampaigns, workspace?.currency]);

  // The KPI strip reads the live connector when a channel has synced, else the
  // CSV feed — the same source feeding the panels below it, so the headline and
  // the table can't disagree about whether data exists. Wasted Spend + Account
  // Health are now backed by the deterministic analysis engine over the live
  // connector graph (see `health` above), "—" when nothing scores (never a 0).
  const live = connectorCampaigns.length > 0;
  const hasCsv = allRows.length > 0;
  // Single source of truth for "is there anything to show". The CSV analysis
  // table and the budget-allocation chart both derive their empty/non-empty
  // messaging from this, so no two sections can disagree (the analysis box saying
  // "No campaigns analyzed — upload a CSV" while live connector verdicts render
  // below it was exactly that contradiction). The substrates stay DISJOINT — we
  // never conflate connector rows into the CSV table; the CSV table just stops
  // claiming the page is empty when live connector data exists.
  const hasConnectorData = live;
  const kpiSpend = live ? connectorAgg.spend : (hasCsv ? totals.spend : null);
  const kpiBlendedCpa = live ? connectorAgg.blendedCpa : totals.blendedCpa;
  const kpiCurrency = live ? connectorAgg.currency : currency;
  const kpiSpendLabel = live ? 'Live · connector' : (hasCsv ? 'Campaign feed' : 'No data yet');
  // Wasted spend from the analysis engine (minor units → major for the panel's
  // major-unit formatter, currency-correct so it stays on the same scale as the
  // Total Spend card). Null → "—", never a fabricated 0.
  const kpiWasted = health?.wastedSpend?.minor != null ? fromMinor(health.wastedSpend.minor, kpiCurrency) : null;
  const kpiWastedPct = health?.wastedSpend?.pct ?? null;

  const setSort = (key) => {
    if (!sortableCols.has(key)) return;
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    // NOT a scroller: MainLayout's <main> (overflow-y-auto) is the single
    // vertical scroll owner. An h-full + overflow-y-auto here nested a second
    // scroll container inside it — double scrollbars, wheel trapped in the
    // inner one. min-h-0 only lets flex children shrink if a flex parent
    // ever wraps this.
    <div className="flex flex-col min-h-0 p-6 lg:p-8 animate-fade-in">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          {/* The page is a queue of decisions, not a report. It says so, and
              then leads with the count that decides whether you read on. */}
          <h1 className="page-title text-lumi-text">Decision Queue</h1>
          {actionCount > 0 && (
            <p className="font-mono text-xs text-signal-kill mt-1">
              {actionCount} campaign{actionCount === 1 ? '' : 's'} need{actionCount === 1 ? 's' : ''} action
            </p>
          )}
          <p className="font-mono text-xs text-lumi-subtle mt-0.5">
            {(() => {
              // Count from whichever substrate has data — a connector-synced
              // account has 0 CSV rows but N live campaigns, so keying this off
              // the CSV feed alone falsely read "no data" with 34 campaigns synced.
              const n = connectorCampaigns.length || allRows.length;
              if (n === 0) return 'No campaigns synced yet';
              const scanned = `${n} campaign${n === 1 ? '' : 's'} · live`;
              // Budget at Risk is the analysis engine's figure (KILL + REFRESH),
              // shown here in the SAME formatter as the KPI card so the header
              // and the card can never quote different numbers.
              return kpiWasted != null && kpiWasted > 0
                ? `${fmtCurrency(kpiWasted, kpiCurrency)} budget at risk · ${scanned}`
                : scanned;
            })()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloading || !canExportPdf(connectorCampaigns)}
            className="inline-flex items-center gap-1.5 bg-lumi-elevated border border-lumi-border rounded-xl px-4 py-2 text-sm font-display text-lumi-text hover:border-lumi-accent/40 disabled:opacity-60 transition-all"
            title={!canExportPdf(connectorCampaigns) ? 'Sync your Meta account to export' : 'Download PDF Report'}
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" strokeWidth={1.5} />}
            {downloading ? 'Generating…' : 'PDF Report'}
          </button>
          <button
            type="button"
            onClick={handleMetaSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 bg-lumi-gold text-dark-base rounded-xl px-4 py-2 text-sm font-semibold hover:bg-lumi-deep disabled:opacity-60 transition-all"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />}
            {syncing ? 'Syncing…' : 'Sync Live Meta'}
          </button>
        </div>
      </header>

      <MetricsPanel
        spend={kpiSpend}
        spendLabel={kpiSpendLabel}
        blendedCpa={kpiBlendedCpa}
        wasted={kpiWasted}
        wastedPct={kpiWastedPct}
        loading={loading || connectorLoading}
        healthScore={healthScore}
        healthLabel={healthLabel}
        healthColor={healthColor}
        currency={kpiCurrency}
      />

      {/* No-revenue campaigns ARE scored — on engagement (frequency + CTR), with
          ROAS honestly blank. Split by objective so a conversion campaign missing
          revenue reads as a fixable tracking gap, not "awareness by design". */}
      {awarenessCount > 0 && (
        <p className="font-mono text-[11px] text-lumi-subtle mb-2 -mt-3">
          {awarenessCount} awareness campaign{awarenessCount === 1 ? '' : 's'} scored on engagement — ROAS stays “—” by design (no revenue expected).
        </p>
      )}
      {trackingGapCount > 0 && (
        <p className={cn('font-mono text-[11px] text-signal-warning', awarenessCount > 0 ? 'mb-2' : 'mb-2 -mt-3')}>
          {trackingGapCount} conversion campaign{trackingGapCount === 1 ? '' : 's'} scored on engagement but tracking no revenue — verify the Meta Pixel or lead-form setup so ROAS can be measured.
        </p>
      )}

      {/* Some engagement campaigns were verdicted RELATIVE to their portfolio (no
          revenue to score on ROAS). Say so once, and point at the fix. */}
      {hasRelativeRanking && (
        <p className="font-mono text-[11px] text-lumi-subtle mb-2 -mt-1">
          Some campaigns have no revenue data — their recommendations are based on CTR, Frequency and Spend only.{' '}
          <Link to={appRoutes.settingsRevenue} className="text-lumi-gold hover:underline">
            Connect sales data to unlock profit-based recommendations →
          </Link>
        </p>
      )}

      {/* Connector campaigns that can't be scored at all (no spend or no delivery)
          — explicit, never dropped silently (hiding them would be a quieter form of
          the same fabrication). */}
      {connectorGatedOut.length > 0 && (
        <p className={cn('font-mono text-[11px] text-lumi-subtle mb-6', awarenessCount > 0 ? '' : '-mt-3')}>
          {connectorGatedOut.length} connected campaign{connectorGatedOut.length === 1 ? '' : 's'} need revenue data before
          {connectorGatedOut.length === 1 ? ' it' : ' they'} can be scored — {revenueGuidance}.
        </p>
      )}

      {/* The decision queue — the reason the page exists, so it comes before
          the account-level chart and the legacy feed table rather than after
          both. Everything below this line is context for it. */}
      <ConnectorCampaignsPanel
        campaigns={connectorCampaigns}
        verdicts={verdictByEntityId}
        relativeRanks={relativeRankByEntityId}
        impacts={impactByEntityId}
        verdictInfo={verdictInfoByEntityId}
        loading={connectorLoading}
        error={connectorError}
        deepLinkEntityId={deepLinkEntityId}
        onDeepLinkHandled={clearDeepLink}
      />

      {/* Where the money currently sits, as context BELOW the decisions rather
          than the second thing on the page. */}
      <div className="mt-6">
        <PerformanceChart totals={chartTotals} currency={currency} hasConnectorData={hasConnectorData} />
      </div>

      {/* Channel filter — rendered only when ≥2 real channels exist in the data,
          so it never shows an empty "Google" pill before Google data flows.
          Filters the legacy feed table only, so it travels with it. */}
      {platforms.length >= 2 && (
        <div className="flex items-center gap-1.5 mb-3" role="group" aria-label="Filter by channel">
          {['ALL', ...platforms].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setChannel(p)}
              aria-pressed={channel === p}
              className={cn(
                'px-3 py-1 rounded-full font-mono text-[11px] uppercase tracking-wide border transition-colors',
                channel === p
                  ? 'bg-lumi-accent text-lumi-bg border-lumi-accent'
                  : 'bg-lumi-elevated text-lumi-muted border-lumi-border hover:border-lumi-accent/40',
              )}
            >
              {p === 'ALL' ? 'All' : p}
            </button>
          ))}
        </div>
      )}

      <AnalysisSummary
        rows={tableRows}
        loading={loading}
        sortKey={sortKey}
        sortDir={sortDir}
        setSort={setSort}
        expanded={expanded}
        setExpanded={setExpanded}
        currency={currency}
        hasConnectorData={hasConnectorData}
        emptyChannel={channel !== 'ALL' && tableRows.length === 0 ? channel : null}
      />
    </div>
  );
}
