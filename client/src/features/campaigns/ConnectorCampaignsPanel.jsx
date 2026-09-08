// ============================================================
// MARCOM / Lumi — ConnectorCampaignsPanel  (Campaigns · /app/campaigns)
// ------------------------------------------------------------
// Renders connector-synced campaigns (the entity graph the Sync button writes)
// as a DISTINCT section from the CSV-fed AnalysisSummary table — the two are
// disjoint substrates and must not be conflated. Each campaign drills into its
// ad sets (the connector graph is the only place ad-set detail exists).
//
// Rows are ordered as a DECISION QUEUE, not by sync order: campaigns are banded
// into Needs Action / Watching / Healthy / Needs Data (campaignGrouping.js) and
// sorted by impact within each band. One table throughout — the bands are
// header <tr>s, so the column grid, keyboard order, deep-link anchors and the
// expand-state Sets all keep working untouched.
//
// The row leads with the DECISION, not the dashboard: Verdict → Campaign +
// evidence + impact → the ONE metric that carries the verdict → Spend →
// actions. The old four-metric grid (Spend/ROAS/CTR/Freq on every row) showed
// four numbers to justify one call; the full set still lives one click away in
// the detail panel, where there is room to read it.
//
// Governing law: every metric traces to a MetricSnapshot row. A missing metric
// renders "—" (Dash), never a fabricated 0. Loading/error/empty are honest.
// ============================================================
import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { ChevronRight, Loader2, Plug, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { roasColor, freqColor } from '@/components/campaign-analysis/campaignFormatters.js';
import { formatCurrency } from '@/lib/money';
import { useEntityDrillDown } from '@/hooks/useEntityDrillDown.js';
import { useAdsDrillDown } from '@/hooks/useAdsDrillDown.js';
import { recordExplain } from './decisionSignals.js';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { CampaignDetailPanel } from '@/features/campaigns/CampaignDetailPanel.jsx';
import { NO_REVENUE_DISCLAIMER, evidenceClause, shortEvidence, decisiveMetric } from '@/features/campaigns/verdictEvidence.js';
import { groupCampaigns, GROUP_CONFIG, GROUP_ORDER } from '@/features/campaigns/campaignGrouping.js';
import { ExecutionContext } from '@/features/campaigns/ExecutionContext.jsx';
import { shouldRequestEvidence } from '@/features/campaigns/executionContext.js';
import { EvidenceState } from '@/features/campaigns/EvidenceState.jsx';
import { AdRows } from '@/features/campaigns/AdRows.jsx';
import { useEvidence, evidenceKey } from '@/hooks/useEvidence.js';
import { useDecisionAction } from '@/features/campaigns/useDecisionAction.js';
import { useDecisionJudgment, judgmentFrom } from '@/features/campaigns/useDecisionJudgment.js';
import { useLumiExecution } from '@/features/campaigns/useLumiExecution.js';

// Every band header / detail / ad-set row spans the full grid. One constant so
// the five call sites can never drift out of step with the <thead>.
const COLS = 5;

// Missing metric → em-dash, never 0 (a true zero and "no data" must not look alike).
const Dash = () => <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>;

// Spend is stored in minor units — format directly (formatCurrency applies the
// currency's real exponent; the old minor/100 truncated 3-dp currencies like KWD).
const Spend = ({ minor, currency }) => (minor == null ? <Dash /> : formatCurrency(minor, currency || 'USD'));
const Roas  = ({ v }) => (v == null ? <Dash /> : <span className={roasColor(v)}>{v.toFixed(2)}x</span>);
const Ctr   = ({ v }) => (v == null ? <Dash /> : `${(v * 100).toFixed(2)}%`); // ratio → percent
const Freq  = ({ v }) => (v == null ? <Dash /> : <span className={freqColor(v)}>{v.toFixed(2)}</span>);

// Impact (1-10): deterministic priority-to-act from the analysis engine. Higher
// = more urgent (KILL a big spender). Absent (unscored/sub-floor) → "—", never 0.
const impactColor = (s) => (s >= 8 ? 'text-trend-danger' : s >= 5 ? 'text-trend-warning' : 'text-lumi-muted');
// A revenue-free campaign has no impact score, but the relative post-pass DID
// place it in its cohort — surface that standing (↑ top / ↓ bottom) rather than a
// bare "—". It is explicitly a relative rank, not a fabricated impact number, so
// the title says so. No verdict / no rank at all still honestly falls to "—".
const Impact = ({ score, relativeRank }) => {
  if (score != null) {
    return <span className={cn('font-semibold', impactColor(score))} title={`Impact ${score}/10 — priority to act`}>{score}</span>;
  }
  if (relativeRank === 'TOP') {
    return <span className="text-signal-scale" title="Strongest engagement in its group — no revenue data to score impact">↑</span>;
  }
  if (relativeRank === 'BOTTOM') {
    return <span className="text-signal-kill" title="Weakest engagement in its group — no revenue data to score impact">↓</span>;
  }
  return <Dash />;
};

// The ONE metric carrying the verdict, picked from the row's own data by
// decisiveMetric() — the label changes per row, so it is rendered IN the cell
// rather than in the column header. Each variant keeps the formatter (and the
// threshold colouring) it had as its own column.
function DecisiveCell({ m }) {
  const dm = decisiveMetric(m);
  if (!dm) {
    return <td className="px-4 py-2 text-right font-mono text-sm tabular-nums"><Dash /></td>;
  }
  return (
    <td className="px-4 py-2 text-right">
      <div className="font-mono text-[10px] uppercase tracking-wide text-lumi-subtle">{dm.label}</div>
      <div className="font-mono text-sm tabular-nums text-lumi-text">
        {dm.format === 'roas' ? <Roas v={dm.value} />
          : dm.format === 'freq' ? <Freq v={dm.value} />
            : <Ctr v={dm.value} />}
      </div>
    </td>
  );
}

const SpendCell = ({ m }) => (
  <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-lumi-text">
    <Spend minor={m.spendMinor} currency={m.currency} />
  </td>
);

// Both row toggles share one affordance: a chevron that ROTATES (the label never
// changes to "Close" — the button names what it opens, not what it does next).
function RowToggle({ expanded, onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded border border-lumi-border px-2 py-1 font-mono text-[11px] text-lumi-muted transition-colors hover:bg-lumi-elevated hover:text-lumi-text"
    >
      <ChevronRight className={cn('w-3 h-3 transition-transform duration-200', expanded && 'rotate-90 text-lumi-accent')} strokeWidth={2} />
      {children}
    </button>
  );
}

/**
 * The ad sets of one campaign, each drilling one level further into its ads.
 *
 * `ads` is the whole ad-level bundle, passed as ONE object rather than seven
 * props: the state it carries (which ad sets are open, their rows, their
 * evidence) belongs to the panel — three hooks' worth of maps, keyed by ad-set
 * id — and threading each map separately would put the panel's internals in
 * this signature.
 */
function AdSetRows({ state, ads }) {
  if (!state || state.loading) {
    return (
      <tr><td colSpan={COLS} className="px-4 py-3 text-center text-xs text-lumi-subtle">
        <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1.5" strokeWidth={2} /> Loading ad sets…
      </td></tr>
    );
  }
  if (state.error) {
    return (
      <tr><td colSpan={COLS} className="px-4 py-3 text-center text-xs text-trend-danger">
        <AlertTriangle className="inline w-3.5 h-3.5 mr-1.5" strokeWidth={2} /> Couldn’t load ad sets — collapse and try again.
      </td></tr>
    );
  }
  if (state.adSets.length === 0) {
    return (
      <tr><td colSpan={COLS} className="px-4 py-3 text-center text-xs text-lumi-subtle">No ad sets synced for this campaign yet.</td></tr>
    );
  }
  return state.adSets.map((a) => {
    // The TRUE total from _count, not children.length: MAX_ADS_PER_ADSET caps
    // the returned list, so counting the array would tell a 140-ad ad set it has
    // 100. Same honesty rule the campaign level already applies to adSetCount.
    const adCount = a.adCount ?? 0;
    const adsAreOpen = ads.open.has(a.entityId);
    const evKey = evidenceKey(a.entityId);
    return (
      <Fragment key={a.entityId}>
        <tr className="bg-lumi-bg/40 border-b border-lumi-border/40">
          <td className="px-4 py-2.5" />{/* verdicts are campaign-level — ad-set cell stays empty */}
          <td className="px-4 py-2.5 pl-10">
            <div className="font-display text-sm text-lumi-text">{a.name}</div>
            <div className="font-mono text-[11px] text-lumi-subtle">AD SET · {a.channel}</div>
          </td>
          <DecisiveCell m={a} />
          <SpendCell m={a} />
          {/* The one control that IS ad-set-level. Absent (not disabled) when the
              ad set has no ads — an unusable chevron opening onto nothing is the
              same noise the campaign level already refuses to render. */}
          <td className="px-4 py-2.5 pr-4 align-top">
            {adCount > 0 && (
              <div className="flex justify-end">
                <RowToggle
                  expanded={adsAreOpen}
                  onClick={() => ads.toggle(a.entityId)}
                  label={`Toggle ads for ${a.name}`}
                >
                  View ads ({adCount})
                </RowToggle>
              </div>
            )}
          </td>
        </tr>
        {adsAreOpen && (
          <AdRows
            cols={COLS}
            state={ads.byId[a.entityId] ?? null}
            loading={Boolean(ads.loading[a.entityId])}
            error={ads.errors[a.entityId] ?? null}
            evidence={ads.evidenceById[evKey] ?? null}
            evidenceLoading={Boolean(ads.evidenceLoading[evKey])}
            evidenceError={ads.evidenceErrors[evKey] ?? null}
          />
        )}
      </Fragment>
    );
  });
}

/**
 * PARITY-03 · what happened to the address the URL asked for.
 *
 * FIVE states, because they are five different claims and three of them used to
 * be one silence. C-07's rule on a deep link: a token cannot replace a reason,
 * and "we could not look" is not "it is not here".
 */
export const DEEP_LINK = Object.freeze({
  NONE:        'NONE',        // no ?entity= — nothing was asked
  PENDING:     'PENDING',     // the campaign read has not landed; nothing can be said
  RESOLVED:    'RESOLVED',    // the id is among the rows
  NOT_IN_LIST: 'NOT_IN_LIST', // the read SUCCEEDED and the id is not among them
  UNREADABLE:  'UNREADABLE',  // the read FAILED — whether it is here is unknown
});

/**
 * PURE. hasData ≠ read succeeded (PARITY-01), on the deep link this time: a
 * failed read must never resolve to "that campaign is not here", which is a
 * claim about the operator's account made by a request that never landed.
 */
export function deepLinkState({ id, campaigns = [], loading = false, error = null }) {
  if (!id) return DEEP_LINK.NONE;
  if (error) return DEEP_LINK.UNREADABLE;
  if (loading) return DEEP_LINK.PENDING;
  return campaigns.some((c) => c.entityId === id) ? DEEP_LINK.RESOLVED : DEEP_LINK.NOT_IN_LIST;
}

// One sentence per unresolved state. NOT_IN_LIST deliberately says "not among
// this account's synced campaigns" rather than "does not exist": the campaign
// read is capped (`take: 200`), so absence from the list is not proof of absence
// from the account. That cap is a separate finding with its own owner.
const DEEP_LINK_NOTICE = Object.freeze({
  [DEEP_LINK.NOT_IN_LIST]: 'That campaign is not among this account’s synced campaigns.',
  [DEEP_LINK.UNREADABLE]:  'Couldn’t check whether that campaign is here — the campaign read failed.',
});

export function ConnectorCampaignsPanel({ campaigns = [], verdicts = {}, relativeRanks = {}, impacts = {}, verdictInfo = {}, loading = false, error = null, deepLinkEntityId = null }) {
  const [open, setOpen] = useState(new Set());          // ad-set drill-down
  const [adsOpen, setAdsOpen] = useState(new Set());    // ad drill-down, keyed by AD-SET id
  const [detailOpen, setDetailOpen] = useState(new Set()); // signals + reasoning panel
  const { byId, load } = useEntityDrillDown();
  const { byId: evidenceById, loading: evidenceLoading, errors: evidenceErrors, load: loadEvidence } = useEvidence();
  const { byId: adsById, loading: adsLoading, errors: adsErrors, load: loadAds } = useAdsDrillDown();
  // A SECOND instance of the same hook, fixed to the AD dimension. Its own byId
  // and `seen` maps, so an ad-set id ranking its ads can never collide with a
  // campaign id ranking its ad sets in one cache — see useEvidence's header.
  const {
    byId: adEvidenceById, loading: adEvidenceLoading,
    errors: adEvidenceErrors, load: loadAdEvidence,
  } = useEvidence({ dimension: 'ad' });
  // One instance for the whole table — the hook keys its state by entityId, so
  // every row reads its own answer rather than the last one clicked.
  const { states: actionStates, execute: executeDecision, dismiss: dismissDecision } = useDecisionAction();
  // R13-b — the operator's judgement OF the call, a separate axis from whether
  // they acted on it. Keyed by decisionId rather than entityId: a judgement
  // belongs to ONE stored decision, and a campaign without one has nothing to key.
  const {
    states: judgmentStates, recorded: judgmentRecorded,
    messages: judgmentMessages, submit: submitJudgment,
  } = useDecisionJudgment();

  // R13-D / B3 — REAL execution, keyed by decisionId like the judgement above.
  // One instance for the whole table: a hook inside the expanded panel would
  // give every row its own state and lose an in-flight execution on collapse —
  // and this is the one axis where losing state means an operator cannot see
  // whether a live ad-account change landed.
  const {
    states: lumiStates, rejections: lumiRejections, run: runLumiExecution,
  } = useLumiExecution();

  // Decision-queue order. `verdicts`/`impacts` arrive FLAT from CampaignsView
  // (entityId → 'KILL' / entityId → 7), which is the shape groupCampaigns reads.
  const grouped = useMemo(
    () => groupCampaigns(campaigns, verdicts, impacts),
    [campaigns, verdicts, impacts],
  );

  const linkState = deepLinkState({ id: deepLinkEntityId, campaigns, loading, error });

  // Deep-link from an Overview agenda item, a Decision card or the fatigue
  // panel (?entity=<Campaign.id>): expand the target's detail (signals + Lumi's
  // Read) and scroll it into view. Grouping is presentation-only — the row keeps
  // its id, so this still finds it in any band.
  //
  // ⚠️ TWO THINGS THIS DELIBERATELY NO LONGER DOES.
  //
  // It does not hand back for the parent to delete ?entity=. That erased the
  // address at the exact moment it succeeded: the URL could not be copied to the
  // thing on screen, and a refresh landed at the top of an unexpanded list. The
  // only case where the param survived was the case where nothing was found.
  //
  // And it does not open the panel silently. A real click runs `toggleDetail`,
  // which records `explain` — "a human opened the reasoning". Arriving by link
  // IS opening the reasoning, so it records the same signal; otherwise the
  // institutional record depends on which door the operator used.
  //
  // Once per id per mount: the effect re-runs whenever the list refetches (a new
  // array, same rows), and a refetch is not a second arrival. A genuine reload
  // remounts, which IS one.
  const arrived = useRef(new Set());
  useEffect(() => {
    if (linkState !== DEEP_LINK.RESOLVED) return;
    if (arrived.current.has(deepLinkEntityId)) return;
    arrived.current.add(deepLinkEntityId);
    recordExplain(deepLinkEntityId);
    setDetailOpen((s) => (s.has(deepLinkEntityId) ? s : new Set(s).add(deepLinkEntityId)));
    document.getElementById(`campaign-row-${deepLinkEntityId}`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [linkState, deepLinkEntityId]);

  // Stay quiet until there's something real to show. Connector data is a
  // separate substrate from the CSV feed, so a CSV-only workspace gets no empty
  // section here — the Sync toast carries the "nothing landed" feedback instead.
  // Stay quiet when there is nothing to show — UNLESS a deep link asked a
  // question. Silence is not an available answer to an address.
  const notice = DEEP_LINK_NOTICE[linkState] ?? null;
  if (!loading && !error && campaigns.length === 0 && !notice) return null;

  const toggle = (id) => {
    // The fetches fire OUTSIDE the state updater, for the reason toggleDetail
    // documents below: a setState updater must be pure, and React may invoke it
    // more than once per call. Both loaders are idempotent behind a `seen` ref,
    // so this was benign — but only by accident, and the evidence request is a
    // second one to get wrong the same way.
    if (!open.has(id)) {
      load(id);
      loadEvidence(id);
    }
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // One level down, same discipline: both fetches fire OUTSIDE the state
  // updater (a setState updater must be pure), both are idempotent behind their
  // hooks' `seen` refs, and neither runs on collapse.
  const toggleAds = (adSetId) => {
    if (!adsOpen.has(adSetId)) {
      loadAds(adSetId);
      loadAdEvidence(adSetId);
    }
    setAdsOpen((s) => {
      const next = new Set(s);
      if (next.has(adSetId)) next.delete(adSetId);
      else next.add(adSetId);
      return next;
    });
  };

  // The ad level's whole state, in one object — see AdSetRows' signature note.
  const adsBundle = {
    open: adsOpen,
    toggle: toggleAds,
    byId: adsById,
    loading: adsLoading,
    errors: adsErrors,
    evidenceById: adEvidenceById,
    evidenceLoading: adEvidenceLoading,
    evidenceErrors: adEvidenceErrors,
  };

  const toggleDetail = (id) => {
    // The signal fires OUTSIDE the state updater. A setState updater must be
    // pure: React may invoke it more than once per call (StrictMode
    // double-invocation, re-renders), so a request inside it gets sent an
    // unpredictable number of times — it fired 8 times for one click.
    //
    // Only on OPEN. Collapsing is not a second engagement, and the server
    // stamps the first open once anyway. Fire-and-forget: never blocks the
    // expand, never surfaces an error.
    if (!detailOpen.has(id)) recordExplain(id);

    setDetailOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // One campaign row (+ its detail and ad-set children). Lifted out of the map
  // so the grouped <tbody> stays readable; keeping it a closure means no state
  // has to be prop-drilled.
  const renderCampaignRow = (c) => {
    const isOpen = open.has(c.entityId);
    const isDetailOpen = detailOpen.has(c.entityId);
    const count = c.adSetCount ?? 0;
    const verdict = verdicts[c.entityId];
    const relativeRank = relativeRanks[c.entityId] ?? null;
    const impact = impacts[c.entityId] ?? null;
    const info = verdictInfo[c.entityId] ?? {};
    // The engine's own evidence words ("Lowest CTR in its group"), never the
    // internal "relative to portfolio" label — now on the row itself rather than
    // buried in a tooltip, because it is the reason for the verdict beside it.
    // Fallback states the TOP/BOTTOM field plainly when no rationale arrived;
    // with neither, the row says nothing rather than inventing a reason.
    const evidence = shortEvidence(info.rationale)
      ?? (relativeRank ? (relativeRank === 'BOTTOM' ? 'weakest engagement in its group' : 'strongest engagement in its group') : null);
    // The no-revenue disclaimer belongs ONLY to a verdict the relative post-pass
    // decided — appending it to a revenue-track verdict would be false.
    const evidenceTitle = relativeRank
      ? `${evidenceClause(info.rationale) ?? evidence} — ${NO_REVENUE_DISCLAIMER}`
      : (evidenceClause(info.rationale) ?? undefined);
    return (
      <Fragment key={c.entityId}>
        <tr id={`campaign-row-${c.entityId}`} className="border-b border-lumi-border/50 hover:bg-lumi-elevated/40 transition-colors duration-100">
          {/* 1. VERDICT — the decision leads the row. A gatedOut/dataless
              campaign has none → honest "—", never a fabricated one. */}
          <td className="px-4 py-3 align-top">
            {verdict ? <VerdictPill verdict={verdict} size="md" /> : <Dash />}
          </td>

          {/* 2. What it is, why, and how much it matters. */}
          <td className="px-4 py-3 align-top">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="block font-display font-semibold text-sm text-lumi-text">{c.name}</span>
                <span className="block font-mono text-[11px] text-lumi-subtle">
                  {c.channel}
                  {c.objective ? ` · ${c.objective}` : ''}
                  {/* A conversion campaign that spent but measured no revenue: its
                      ROAS reads "—" because the DATA is missing, not because it
                      performed badly. Say so next to the name. Subtle, not
                      alarming: a missing revenue source is a setup gap. */}
                  {c.needsRevenue && (
                    <span className="ml-1.5 text-lumi-subtle">· needs revenue</span>
                  )}
                </span>
                {evidence && (
                  <span className="mt-1 block font-mono text-[11px] text-lumi-muted" title={evidenceTitle}>
                    {evidence}
                  </span>
                )}
                {/* Revenue WAS uploaded, but it now lags the spend it would be
                    divided by, so the engine stopped scoring it rather than show
                    a drifted ROAS. A different story from "needs revenue" (none
                    was ever given). Indicator ONLY — the re-upload CTA lives once
                    (AlertsPanel/MetricsPanel), not repeated per row. */}
                {c.revenueStale && (
                  <span className="mt-1 block font-mono text-[11px] text-lumi-muted">
                    · revenue outdated
                  </span>
                )}
              </div>
              {/* Impact rides WITH the campaign it ranks rather than standing as
                  its own column — it is a property of this decision, not a
                  metric to scan down. */}
              <span className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded bg-lumi-elevated px-1.5 py-0.5 font-mono text-[10px] text-lumi-muted">
                Impact <Impact score={impact} relativeRank={relativeRank} />
              </span>
            </div>
          </td>

          {/* 3. The one metric that carries the verdict. 4. What it costs. */}
          <DecisiveCell m={c} />
          <SpendCell m={c} />

          {/* 5. The two ways in. "View ad sets" is absent (not disabled) when
              there are none — an unusable control is noise. */}
          <td className="px-4 py-3 pr-4 align-top">
            <div className="flex flex-col items-end gap-1.5">
              <RowToggle
                expanded={isDetailOpen}
                onClick={() => toggleDetail(c.entityId)}
                label={`Toggle details for ${c.name}`}
              >
                Explain decision
              </RowToggle>
              {count > 0 && (
                <RowToggle
                  expanded={isOpen}
                  onClick={() => toggle(c.entityId)}
                  label={`Toggle ad sets for ${c.name}`}
                >
                  View ad sets ({count})
                </RowToggle>
              )}
            </div>
          </td>
        </tr>
        {isDetailOpen && (
          <tr className="border-b border-lumi-border/50 bg-lumi-bg/20">
            <td colSpan={COLS} className="px-4 pb-3 pt-0">
              <CampaignDetailPanel
                campaign={c}
                verdict={verdict}
                impact={impact}
                rationale={info.rationale ?? null}
                confidence={info.confidence ?? null}
                funnel={info.funnel ?? null}
                rootCause={info.rootCause ?? null}
                dataConfidence={info.dataConfidence ?? null}
                dataConfidenceDimensions={info.dataConfidenceDimensions ?? null}
                signalConfidence={info.signalConfidence ?? null}
                counterfactuals={info.counterfactuals ?? null}
                hypotheses={info.hypotheses ?? null}
                // The row's own rank, already resolved above for the Impact
                // badge. The panel needs it to know whether the reasoning it is
                // about to show actually DECIDED this verdict.
                relativeRank={relativeRank}
                relativeContext={info.relativeContext ?? null}
                memory={info.memory ?? null}
                // Whether the null above is "never judged" or "could not read"
                // (C-03). Without it the panel has one value for two facts.
                decisionHistoryStatus={info.decisionHistoryStatus ?? null}
                // And what that answer MEANS (C-06), which is what the view
                // model actually branches on.
                decisionHistoryKnowledge={info.decisionHistoryKnowledge ?? null}
                // The STORED decision's provenance, from the same row
                // `info.decisionId` names. Null until a sweep writes a decision
                // with provenance captured — the panel renders nothing then.
                evidenceReference={info.decisionEvidenceReference ?? null}
                // The decision lifecycle, on the decision surface. `info.decisionId`
                // is the STORED decision's id when a sweep wrote one, so the write
                // lands on THAT row rather than on whatever the server re-resolves
                // as newest at click time; null for a campaign with no Decision,
                // where the by-entity route is correct rather than degraded. Same
                // routing as before — only the surface moved.
                onExecute={() => executeDecision(c.entityId, info.decisionId ?? null)}
                onDismiss={() => dismissDecision(c.entityId, info.decisionId ?? null)}
                executionState={actionStates[c.entityId] ?? null}
                // R13-b. Null `decisionId` ⇒ the panel renders no judgement UI
                // at all. There is no row to attach reasoning to, and resolving
                // one from the entity would attribute an operator's judgement to
                // a call they were never shown — the by-entity latitude
                // execute/dismiss can afford, this deliberately cannot.
                decisionId={info.decisionId ?? null}
                // The SERVER's answer whenever this session produced one — a
                // fresh 200 and a 409's reconciliation are both newer than the
                // feed that loaded before either happened. Otherwise the
                // persisted judgement off the verdict read, which is what makes
                // a recorded judgement survive a reload.
                judgment={judgmentRecorded[info.decisionId] ?? judgmentFrom(info)}
                judgmentState={judgmentStates[info.decisionId] ?? null}
                judgmentMessage={judgmentMessages[info.decisionId] ?? null}
                onJudge={(j) => submitJudgment(info.decisionId, j)}
                // R13-D / B3 — the SERVER decides what Lumi may run; this only
                // forwards the descriptor and the click.  is
                // absent on a legacy payload, which renders nothing at all.
                execution={info.execution ?? null}
                lumiState={lumiStates[info.decisionId] ?? null}
                lumiRejection={lumiRejections[info.decisionId] ?? null}
                onLumiExecute={() => runLumiExecution(info.decisionId, info.execution)}
              />
            </td>
          </tr>
        )}
        {isOpen && <AdSetRows state={byId[c.entityId]} ads={adsBundle} />}
        {/* Where to act, under the ad sets it points at. The verdict gate is
            still local and free, so an expanded HOLD costs no request; whether
            one ad set is measurably dragging is now the SERVER's answer, and it
            can decline in three distinguishable ways. Committing the <tr> and
            resolving inside it is the DecisionCard pattern: an expansion that
            silently showed nothing was indistinguishable from one still loading
            and from one where every ad set is performing fine. It lives in its
            own <tr> for the same reason the detail panel does: a bare <div>
            inside a <tbody> gets reparented out of the table by the browser. */}
        {isOpen && shouldRequestEvidence(c, verdict) && (() => {
          const key = evidenceKey(c.entityId);
          const ev = evidenceById[key];
          const evLoading = evidenceLoading[key];
          const evError = evidenceErrors[key];
          // Nothing in flight and nothing back yet — say nothing, rather than
          // commit an empty bordered row.
          if (!evLoading && !evError && !ev) return null;
          return (
            <tr className="border-b border-lumi-border/50 bg-lumi-bg/20">
              <td colSpan={COLS} className="px-4 pb-3 pt-0">
                {/* Renders null once the answer is a real ranking. */}
                <EvidenceState
                  loading={evLoading}
                  error={evError}
                  reasonKey={ev?.insufficientData ? ev.reasonKey : null}
                  className="py-2"
                />
                {/* A ranking here means the panel has one: ExecutionContext
                    renders the row this payload names rather than deriving its
                    own, so the gate and the pick cannot disagree. That is why
                    this branch cannot produce the empty row the old pre-commit
                    gate existed to prevent. */}
                {/* NO onExecute / onDismiss / executionState here any more, and
                    that omission is load-bearing. The lifecycle moved up to
                    CampaignDetailPanel, where the decision lives; passing it
                    here too would give ONE campaign TWO places to answer the
                    same question — under "Explain decision" and again under
                    "View ad sets" — with one state behind both. Two surfaces
                    for one claim is worse than the walk they replace.

                    ExecutionContext KEEPS the capability: Overview's
                    DecisionCard is a different surface with no detail panel
                    behind it, and still passes all three. */}
                {ev?.evidence && (
                  <ExecutionContext
                    campaign={c}
                    evidence={ev.evidence}
                    verdict={verdict}
                  />
                )}
              </td>
            </tr>
          );
        })()}
      </Fragment>
    );
  };

  return (
    <section className="mt-6 bg-lumi-surface border border-lumi-border rounded-2xl overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-lumi-border bg-lumi-elevated">
        <Plug className="w-4 h-4 text-lumi-accent" strokeWidth={1.5} />
        <h2 className="section-label">Connected channels</h2>
        {!loading && !error && (
          <span className="font-mono text-[11px] text-lumi-subtle">
            {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'} · live sync
          </span>
        )}
      </header>

      {/* The deep link's own answer, when it has one. PENDING and RESOLVED say
          nothing here: one has no answer yet, the other IS the expanded row. */}
      {notice && (
        <p className="px-4 py-3 font-mono text-[11px] text-lumi-subtle border-b border-lumi-border">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="p-8 text-center text-lumi-subtle text-sm"><Loader2 className="inline w-4 h-4 animate-spin mr-2" strokeWidth={2} />Loading connector campaigns…</div>
      ) : error ? (
        <div className="p-8 text-center text-trend-danger text-sm"><AlertTriangle className="inline w-4 h-4 mr-2" strokeWidth={2} />Couldn’t load connector campaigns. Try syncing again.</div>
      ) : (
        <div
          role="region"
          aria-label="Connected channel campaigns"
          tabIndex={0}
          className="overflow-x-auto"
        >
          {/* Horizontal scroll only. The panel deliberately does NOT cap its own
              height — the layout's <main> owns the vertical scroll, so a nested
              max-h here just produced a cramped scroll-within-a-scroll. min-w
              keeps the columns from crushing on narrow viewports. NOT sticky:
              this overflow-x-auto wrapper is the thead's nearest scroll
              container (overflow-x forces overflow-y to auto too), so a sticky
              header could only stick to a box that never scrolls vertically —
              it silently never worked. */}
          <table className="w-full min-w-[720px]">
            <thead className="bg-lumi-elevated border-b border-lumi-border">
              <tr>
                <th scope="col" className="section-label px-4 py-2.5 text-left w-32">
                  <span className="inline-flex items-center gap-1">Verdict <HelpTip content={HELP.VERDICT_COL} /></span>
                </th>
                <th scope="col" className="section-label px-4 py-2.5 text-left">Campaign</th>
                {/* The metric NAME lives in each cell (it differs per row), so the
                    header names the role the column plays instead. */}
                <th scope="col" className="section-label px-4 py-2.5 text-right w-32">
                  <span className="inline-flex items-center gap-1">Key signal <HelpTip content={HELP.KEY_SIGNAL} /></span>
                </th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-28">Spend</th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-44"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {GROUP_ORDER.map((groupKey) => {
                const items = grouped[groupKey];
                if (items.length === 0) return null; // an empty band gets no header
                const config = GROUP_CONFIG[groupKey];
                return (
                  <Fragment key={groupKey}>
                    {/* Band separator. Same colSpan as the ad-set/detail rows so
                        the single table's column grid stays intact. */}
                    <tr className="bg-lumi-bg/30">
                      <td colSpan={COLS} className="px-4 pt-5 pb-2 border-b border-lumi-border/50">
                        {/* The band is the table's primary organising idea; at
                            10px it was the smallest type on the page. */}
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('font-display text-sm font-semibold', config.color)}>
                            {config.label}
                          </span>
                          <span className={cn('font-mono text-xs font-medium opacity-70', config.color)}>
                            {items.length}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {items.map(renderCampaignRow)}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
