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
import { useState, useEffect, useMemo, Fragment } from 'react';
import { ChevronRight, Loader2, Plug, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { roasColor, freqColor } from '@/components/campaign-analysis/campaignFormatters.js';
import { formatCurrency } from '@/lib/money';
import { useEntityDrillDown } from '@/hooks/useEntityDrillDown.js';
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
import { useEvidence, evidenceKey } from '@/hooks/useEvidence.js';

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

function AdSetRows({ state }) {
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
  return state.adSets.map((a) => (
    <tr key={a.entityId} className="bg-lumi-bg/40 border-b border-lumi-border/40">
      <td className="px-4 py-2.5" />{/* verdicts are campaign-level — ad-set cell stays empty */}
      <td className="px-4 py-2.5 pl-10">
        <div className="font-display text-sm text-lumi-text">{a.name}</div>
        <div className="font-mono text-[11px] text-lumi-subtle">AD SET · {a.channel}</div>
      </td>
      <DecisiveCell m={a} />
      <SpendCell m={a} />
      <td className="px-4 py-2.5" />{/* the toggles are campaign-level — empty on ad-set rows */}
    </tr>
  ));
}

export function ConnectorCampaignsPanel({ campaigns = [], verdicts = {}, relativeRanks = {}, impacts = {}, verdictInfo = {}, loading = false, error = null, deepLinkEntityId = null, onDeepLinkHandled }) {
  const [open, setOpen] = useState(new Set());          // ad-set drill-down
  const [detailOpen, setDetailOpen] = useState(new Set()); // signals + reasoning panel
  const { byId, load } = useEntityDrillDown();
  const { byId: evidenceById, loading: evidenceLoading, errors: evidenceErrors, load: loadEvidence } = useEvidence();

  // Decision-queue order. `verdicts`/`impacts` arrive FLAT from CampaignsView
  // (entityId → 'KILL' / entityId → 7), which is the shape groupCampaigns reads.
  const grouped = useMemo(
    () => groupCampaigns(campaigns, verdicts, impacts),
    [campaigns, verdicts, impacts],
  );

  // Deep-link from an Overview agenda item (?entity=<id>): once the target row
  // exists, expand its detail (signals + Lumi's Read) and scroll it into view,
  // then hand back so the parent can clear the URL param. An id not in this list
  // (stale/invalid, or still loading) is a graceful no-op — no expand, no crash.
  // Grouping is presentation-only: the row keeps its id, so this still finds it.
  useEffect(() => {
    if (!deepLinkEntityId) return;
    if (!campaigns.some((c) => c.entityId === deepLinkEntityId)) return;
    setDetailOpen((s) => (s.has(deepLinkEntityId) ? s : new Set(s).add(deepLinkEntityId)));
    document.getElementById(`campaign-row-${deepLinkEntityId}`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    onDeepLinkHandled?.();
  }, [deepLinkEntityId, campaigns, onDeepLinkHandled]);

  // Stay quiet until there's something real to show. Connector data is a
  // separate substrate from the CSV feed, so a CSV-only workspace gets no empty
  // section here — the Sync toast carries the "nothing landed" feedback instead.
  if (!loading && !error && campaigns.length === 0) return null;

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
              />
            </td>
          </tr>
        )}
        {isOpen && <AdSetRows state={byId[c.entityId]} />}
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
                {/* The server having found a ranking guarantees ExecutionContext
                    finds one too: both rank the same rows on the same -20% gap
                    with the same two-reporter minimum, and the server ALSO drops
                    rows under 100 impressions — a strictly smaller set, so a gap
                    it found is still there in the fuller one. That is why this
                    branch cannot produce the empty row the old pre-commit gate
                    existed to prevent. */}
                {ev?.evidence && (
                  <ExecutionContext campaign={c} adSets={byId[c.entityId]?.adSets} verdict={verdict} />
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
