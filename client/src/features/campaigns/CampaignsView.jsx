// ============================================================
// MARCOM / Lumi — CampaignAnalysis  (/app/campaigns) · the SUBJECT axis
// ------------------------------------------------------------
// Every metric on this page derives from the connector entity graph
// (GET /api/lumi/entities/{campaigns,health,verdicts}).
//
// FE-03 — it used to read TWO substrates. The second was the legacy
// CampaignState feed, whose `campaigns` array S1-B deleted from
// GET /api/lumi/feed, and it fed a whole parallel apparatus here: a flattened
// row set, a sortable analysis table, a channel filter, an account-level
// `totals` roll-up and a `hasCsv` flag threaded through the KPI strip.
//
// None of it was rendering a FALSEHOOD — the table returned null whenever
// connector data existed, and an honest "No campaign data yet" when it did not,
// so the page never lied about the account. It was ~180 lines computing over an
// array that could not be non-empty, plus a channel filter whose options were
// derived from that array, which is why the `?channel=` deep-link from Blended
// Truth has been inert: `platforms` was always [].
// ============================================================
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw, Loader2, Download } from 'lucide-react';
import { appRoutes } from '@/app/routeManifest.js';
import { toast } from 'sonner';
import { cn } from '@/lib/utils.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useAccountAggregate } from '@/hooks/useAccountAggregate.js';
import { accountAggregateReading, AGGREGATE_ABSENCE } from '@/lib/accountAggregate.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { fromMinor } from '@/lib/money';
import { INDUSTRIES } from '@/pages/OnboardingPage/constants.js';
import { useCampaignAnalysis } from '@/hooks/useCampaignAnalysis.js';
import { MetricsPanel }    from '@/components/campaign-analysis/MetricsPanel.jsx';
import { PerformanceChart } from '@/components/campaign-analysis/PerformanceChart.jsx';
import { ConnectorCampaignsPanel } from '@/features/campaigns/ConnectorCampaignsPanel.jsx';
import { summarizeGatedOut } from '@/features/campaigns/gatingReasonCopy.js';
import { groupCampaigns, GROUPS } from '@/features/campaigns/campaignGrouping.js';
import { fmtCurrency } from '@/components/campaign-analysis/campaignFormatters.js';
import { generateCampaignReport, generateTextReport } from '@/lib/pdfExport.js';
import { VERDICT_RANK } from '@/lib/verdictRank.js';
import { buildPdfCampaigns } from '@/features/campaigns/pdfData.js';

// The PDF is sourced from the LIVE connector substrate, so export is available
// when there are synced connector campaigns (never the retired CSV feed).
// This pure row predicate is combined with read availability at the header.
export const canExportPdf = (connectorCampaigns = []) => connectorCampaigns.length > 0;

// [] during a pending/failed read makes no claim about the campaign population.
function campaignHeaderState({ campaigns, loading, error }) {
  if (loading) return 'LOADING';
  if (error) return 'ERROR';
  return campaigns.length === 0 ? 'EMPTY' : 'PRESENT';
}

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

// FE-03 — `flatten()`, `compareRows()` and `sortableCols` stood here: the row
// builder, comparator and sortable-column set for the legacy analysis table.
// All three operated on campaigns[].alerts[] from a feed that no longer
// publishes the array, so they ran over [] on every render. Deleted with the
// table; `VERDICT_RANK` survives in lib/verdictRank.js, where the PDF export
// (which sorts LIVE connector rows by the same urgency) reads it.

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
  // Deep-link target from an Overview agenda item, a Decision card or the
  // fatigue panel (?entity=<Campaign.id>). The connector panel scrolls-to and
  // expands that row.
  //
  // PARITY-03 — the param is KEPT. It used to be deleted the moment the row was
  // found ("a refresh won't re-trigger"), which is exactly the problem: a
  // refresh SHOULD re-trigger, because the URL names what the operator is
  // looking at. Erasing it meant the address could not be copied or reloaded,
  // and the one case where it survived was the case where nothing was found.
  //
  // Campaign remains the investigation LENS — this is not a destination and
  // there is no /app/campaigns/:id. What the param has to do is carry the
  // identity honestly for as long as the lens is showing it.
  const [searchParams] = useSearchParams();
  const deepLinkEntityId = searchParams.get('entity');

  // FE-03 — `sortKey`/`sortDir`/`expanded`/`channel` lived here, all four owned
  // by the legacy table and its filter. AdSet drill-down was never theirs: it
  // lives in <ConnectorCampaignsPanel>, which reads the connector entity graph,
  // the only substrate carrying ad-set detail.

  // Connector entity graph — the substrate the Sync button writes. Rendered as
  // its own "Connected channels" section so synced campaigns are visible +
  // drillable; refetched after a successful sync.
  const {
    campaigns: connectorCampaigns,
    loading: connectorLoading,
    error: connectorError,
    refetch: refetchConnectors,
  } = useConnectorCampaigns();

  // PARITY-01 — the CANONICAL account aggregate: one spend figure and one
  // blended CPA for the whole account, computed once by AccountAggregateService
  // and read here rather than derived a second time in the browser. Attention
  // reads exactly the same answer.
  const accountAggregateRead = useAccountAggregate();

  // Verdict engine over the connector campaigns WITH measured revenue. `gatedOut`
  // carries the campaigns that can't be honestly scored, each NAMING WHY (C-07):
  // no measurable delivery, never measured, or measured too long ago. Three
  // different fixes — so never one fabricated KILL, and never one instruction.
  const {
    verdicts: connectorVerdicts,
    gatedOut: connectorGatedOut,
    memory: connectorMemory,
    // C-03 — one status for the whole history read, not one per campaign. A
    // campaign missing from `connectorMemory` means "never judged" only while
    // this says OK; under HISTORY_UNAVAILABLE it means we never got an answer.
    //
    // C-06 — kept under the server's own name, and carried WITH its knowledge
    // token. The alias this used to have ("memoryStatus") is what let the
    // distinction the projection protects get lost in transit.
    decisionHistoryStatus,
    decisionHistoryKnowledge,
    // ⚠️ PARITY-04 — this hook has exported `error` all along and NOTHING read
    // it. B6-01's finding, exactly: an exported error state is not an error
    // path. Combined with the `?? []` default it removed, a verdicts read that
    // FAILED — network or contract — left every campaign unscored and the page
    // said "Needs Data" for the whole account.
    error: verdictsError,
    loading: verdictsLoading,
    budgetDistribution,
    refetch: refetchVerdicts,
  } = useConnectorVerdicts();

  // The two reads that back every claim on this page. Either one unreadable
  // means the decision table cannot be drawn honestly: campaigns without
  // verdicts render as UNSCORED, which is a measurement nobody took.
  const substrateError = connectorError ?? verdictsError;
  const headerState = campaignHeaderState({ campaigns: connectorCampaigns, loading: connectorLoading, error: connectorError });
  const headerReadsReady = !connectorLoading && !connectorError && !verdictsLoading && !verdictsError;
  const exportReadPending = connectorLoading || verdictsLoading;

  // Deterministic analysis over the live connector graph: Account Health +
  // Wasted Spend + per-campaign Impact. Every number traces to a MetricSnapshot
  // row via the verdict engine — null (→ "—") when nothing can be honestly scored.
  const { health, refetch: refetchHealth } = useAccountHealth();

  const { syncing, handleMetaSync } = useCampaignAnalysis({
    refetchConnectors, refetchVerdicts, refetchHealth,
  });

  // Industry (from onboarding, surfaced on the workspace) tailors the guidance
  // for ONE of the three gating reasons — NO_MEASURABLE_DELIVERY, the only one
  // a revenue source fixes — to the source this business actually uses.
  const { workspace } = useWorkspace();
  const revenueGuidance = useMemo(() => {
    const industry = INDUSTRIES.find((i) => i.id === workspace?.industry);
    return REVENUE_GUIDANCE[industry?.revenueSource] ?? GENERIC_REVENUE_GUIDANCE;
  }, [workspace?.industry]);

  // C-07 — ONE LINE PER REASON, not one count over three problems. The line
  // this replaces read "N connected campaigns need revenue data before they can
  // be scored", which is simply false for a campaign awaiting a first sync and
  // for one whose measurement went stale: adding revenue changes nothing there.
  // Only the delivery gate takes the industry-tailored revenue guidance.
  const gatedGroups = useMemo(
    () => summarizeGatedOut(connectorGatedOut, { revenueGuidance }),
    [connectorGatedOut, revenueGuidance],
  );

  const [downloading, setDownloading] = useState(false);

  const handleDownloadPdf = async () => {
    if (exportReadPending) {
      toast.error('Checking campaign data before export');
      return;
    }
    if (substrateError) {
      toast.error('Can’t export while the campaign read is unavailable');
      return;
    }
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
        // C-07 — the WHOLE rows. This was `new Set(...map((g) => g.id))`: the
        // reason the backend published died on this line, and every gated
        // campaign in the export got the same note.
        gatedOut: connectorGatedOut ?? [],
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

  // FE-03 — `allRows` · `platforms` · `tableRows` · `totals` stood here, each
  // derived from `flatten(campaigns)` over the retired feed, so each was empty
  // or zero on every render for every workspace.
  //
  // ⚠️ `platforms` took the CHANNEL FILTER down with it, and that is a real
  // consequence rather than a tidy-up. Blended Truth links here with
  // `?channel=<CHANNEL>`, and the effect that consumed it applied the filter
  // ONLY when `platforms.includes(...)` — over an array that was always []. So
  // that deep-link has been inert since S1-B; deleting the filter makes the
  // deadness explicit instead of latent, and does not change what happens when
  // an operator follows the link. Rebuilding it over `connectorCampaigns`
  // (which do carry `channel`) means filtering the LIVE panel — a feature, with
  // its own questions about which sections a filter governs. Reported, not
  // rebuilt here.

  // The account's currency. Taken from the connector rows below when they carry
  // one, else the workspace's — never a hardcoded assumption.
  const currency = workspace?.currency || 'USD';

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
        // C-09 - the three factors OF the number above, each with its basis.
        // Named here for the same reason every other structured field had to
        // be: this projection is an explicit allowlist, and a field that
        // arrives on every verdict row still dies here unless it is listed.
        // That is exactly how C-07 lost the gating reason.
        dataConfidenceDimensions: v.dataConfidenceDimensions ?? null,
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
        // R13-D / B3 — what Lumi can actually RUN for this verdict, decided by
        // the server from the mutation layer's own rules (verdictToActionType →
        // ALLOWED_ACTIONS → the endpoint builder's option requirements).
        //
        // This projection is an explicit list, so a field arriving on every
        // verdict row still has to be named to survive it — the same trap that
        // hid funnel/rootCause for two PRs. null on a legacy payload, which the
        // panel renders as no execution UI at all.
        execution: v.execution ?? null,
        // The STORED decision for this entity, when a sweep has written one.
        // Identity only: `decisionId` routes execute/dismiss at one row instead
        // of at a query the server re-resolves, and `decisionVerdict` is what
        // Lumi committed to THEN — beside the live verdict above, never
        // reconciled with it. Both null when no sweep has run this campaign.
        decisionId: v.decisionId ?? null,
        decisionVerdict: v.decisionVerdict ?? null,
        // R13-b — what the human decided about that stored decision, straight
        // off the same row. All four null means NO judgement was recorded, which
        // the panel renders as an unanswered question — never as agreement, and
        // never as a zero.
        humanResponse: v.humanResponse ?? null,
        humanReasonCode: v.humanReasonCode ?? null,
        humanReasonNote: v.humanReasonNote ?? null,
        humanRespondedAt: v.humanRespondedAt ?? null,
        // The cohort a relative verdict was decided in. Unlike relativeRank
        // below this has no second route to the panel — the `relativeRanks` map
        // carries only the tag.
        relativeContext: v.relativeContext ?? null,
        // What Lumi said about this campaign BEFORE, from a separate map on the
        // same response — never a field on the verdict, so history and the
        // current call cannot edit each other. null the first time we judge a
        // campaign, which the panel renders as no Memory section at all.
        memory: connectorMemory?.[v.id] ?? null,
        // Travels WITH the null above, because on its own that null is
        // ambiguous — it is the value for a campaign we have never judged and
        // for one whose history we could not read. Same map, opposite sentences.
        decisionHistoryStatus,
        // C-06 — the class of the absence, so the panel does not have to know
        // that this vocabulary spells "we could not look" HISTORY_UNAVAILABLE.
        decisionHistoryKnowledge,
        // NOTE relativeRank is deliberately NOT here. It is already resolved
        // per-row in ConnectorCampaignsPanel from the `relativeRanks` map that
        // feeds the Impact badge; carrying a second copy would give the badge
        // and the reasoning block two sources for one fact.
      };
    }
    return m;
  }, [connectorVerdicts, connectorMemory, decisionHistoryStatus, decisionHistoryKnowledge]);

  // No-revenue scored campaigns split by OBJECTIVE: awareness (no revenue by
  // design) vs a conversion campaign with a tracking gap. Lumping them as one
  // "awareness" count is the exact dishonesty the objective work removed.
  const { awarenessCount, trackingGapCount } = useMemo(
    () => splitNoRevenueVerdicts(connectorVerdicts),
    [connectorVerdicts],
  );

  // ── PARITY-01 · the account aggregate is READ, not recomputed ─────────────
  // What stood here summed `spendMinor` over the connector campaigns, took the
  // FIRST currency in the array as the currency of the total, and divided by
  // that currency's exponent. Attention ran the same loop with a hardcoded 100,
  // so the two axes printed totals differing by a FACTOR OF TEN on a KWD, BHD or
  // JOD workspace; and on a mixed-currency account both summed rows denominated
  // in different money and labelled the result with whichever came first.
  //
  // `GET /lumi/account/aggregate` has answered this correctly since the
  // aggregate track — currency resolved or the question refused, ONE total
  // divided by ONE total — with no client caller at all. It is the canonical
  // source now, and the loop is DELETED rather than corrected, so no second
  // derivation is left to drift.
  const aggregate = accountAggregateReading(accountAggregateRead);

  // ⚠️ THE FLAG IS GONE, not renamed. `const live = connectorCampaigns.length > 0`
  // guarded every figure below and produced the label directly:
  //
  //     kpiSpendLabel = live ? 'Live · connector' : 'No data yet'
  //
  // On a FAILED read the array is [], so `live` was false and the strip told the
  // operator "No data yet" — a claim about their account, asserted by a request
  // that never landed, while the panel eight lines down correctly said it could
  // not load. One page, two answers.
  //
  //     hasData ≠ read succeeded
  //
  // Nothing needs the flag now: the aggregate answers directly, and each absence
  // carries its own reason (C-07 — a token cannot replace a reason; loading,
  // failed, refused, unmeasured and mixed-currency have five different next
  // steps, and only one of them is a fact about the account).
  const kpiSpend = aggregate.spend;
  const kpiBlendedCpa = aggregate.blendedCpa;
  const kpiCurrency = aggregate.currency ?? currency;
  const kpiSpendLabel = aggregate.spendLabel;
  // The CPA card used to infer its caption from `blendedCpa == null`, so six of
  // the seven absences above rendered the seventh's reason — and its footer
  // turned that into an instruction. The token and its sentence travel together.
  const kpiCpaLabel = aggregate.cpaLabel;
  const kpiCpaAbsence = aggregate.cpaAbsence;

  // Deliberately NOT `live`. This asks "are there connector rows to chart and
  // export?" — a question about the array, which stays a question about the
  // array. `live` asks "did the server measure this account?". Conflating the
  // two is exactly what made a failed read look like an empty account.
  const hasConnectorData = connectorCampaigns.length > 0;

  // Wasted spend from the analysis engine (minor units → major for the panel's
  // major-unit formatter, currency-correct so it stays on the same scale as the
  // Total Spend card). Null → "—", never a fabricated 0.
  const kpiWasted = health?.wastedSpend?.minor != null ? fromMinor(health.wastedSpend.minor, kpiCurrency) : null;
  const kpiWastedPct = health?.wastedSpend?.pct ?? null;

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
          {headerReadsReady && actionCount > 0 && (
            <p className="font-mono text-xs text-signal-kill mt-1">
              {actionCount} campaign{actionCount === 1 ? '' : 's'} need{actionCount === 1 ? 's' : ''} action
            </p>
          )}
          <p className="font-mono text-xs text-lumi-subtle mt-0.5">
            {(() => {
              if (headerState === 'LOADING') return 'Checking synced campaigns…';
              if (headerState === 'ERROR') return 'Couldn’t read synced campaigns.';
              if (headerState === 'EMPTY') return 'No campaigns synced yet';
              const n = connectorCampaigns.length;
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
            // The PDF carries verdicts and gating reasons, so an unreadable
            // verdict read would export a document asserting every campaign is
            // unscored. Refuse rather than publish it.
            disabled={downloading || !headerReadsReady || !canExportPdf(connectorCampaigns)}
            className="inline-flex items-center gap-1.5 bg-lumi-elevated border border-lumi-border rounded-xl px-4 py-2 text-sm font-display text-lumi-text hover:border-lumi-accent/40 disabled:opacity-60 transition-all"
            title={exportReadPending ? 'Checking campaign data before export'
              : substrateError ? 'Can’t export while the campaign read is unavailable'
              : !canExportPdf(connectorCampaigns) ? 'No campaign data to export' : 'Download PDF Report'}
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
        cpaLabel={kpiCpaLabel}
        cpaAbsence={kpiCpaAbsence}
        wasted={kpiWasted}
        wastedPct={kpiWastedPct}
        // The SPEND card's own read, not the campaign list's: the two are
        // different requests and only one of them backs this figure.
        loading={aggregate.spendAbsence === AGGREGATE_ABSENCE.LOADING}
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
        <p className={cn('font-mono text-[11px] text-signal-hold', awarenessCount > 0 ? 'mb-2' : 'mb-2 -mt-3')}>
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

      {/* Connector campaigns that can't be scored at all — explicit, never dropped
          silently (hiding them would be a quieter form of the same fabrication),
          and one line per REASON: no measurable delivery, never measured, or
          measured too long ago. Three absences, three different next steps. */}
      {gatedGroups.length > 0 && (
        <div className={cn('mb-6', awarenessCount > 0 ? '' : '-mt-3')}>
          {gatedGroups.map((g, i) => (
            <p key={g.reason ?? `unknown-${i}`} className="font-mono text-[11px] text-lumi-subtle">
              {g.sentence}
            </p>
          ))}
        </div>
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
        // NOT just `connectorError`. A verdicts failure with a healthy campaign
        // read is the exact shape that manufactured "Needs Data": rows present,
        // verdicts empty, no error anywhere.
        error={substrateError}
        deepLinkEntityId={deepLinkEntityId}
      />

      {/* Where the money currently sits, as context BELOW the decisions rather
          than the second thing on the page. */}
      <div className="mt-6">
        <PerformanceChart budgetDistribution={budgetDistribution} loading={verdictsLoading} error={verdictsError} />
      </div>

      {/* FE-03 — the channel filter and <AnalysisSummary> stood here. The
          filter's options came from the retired feed, so it never rendered
          (its gate was `platforms.length >= 2` over an empty array), and the
          table's rows came from the same place. The table itself was already
          careful: it returned NULL when connector data existed and an honest
          "No campaign data yet" when it did not, which is why removing it
          changes nothing an operator sees on either kind of account.

          The live decision queue is <ConnectorCampaignsPanel> above — it was
          moved above the chart deliberately, being the reason the page exists. */}
    </div>
  );
}
