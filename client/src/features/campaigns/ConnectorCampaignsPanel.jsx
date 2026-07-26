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
// Governing law: every metric traces to a MetricSnapshot row. A missing metric
// renders "—" (Dash), never a fabricated 0. Loading/error/empty are honest.
// ============================================================
import { useState, useEffect, useMemo, Fragment } from 'react';
import { ChevronRight, ChevronDown, Loader2, Plug, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { roasColor, freqColor } from '@/components/campaign-analysis/campaignFormatters.js';
import { formatCurrency } from '@/lib/money';
import { useEntityDrillDown } from '@/hooks/useEntityDrillDown.js';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { CampaignDetailPanel } from '@/features/campaigns/CampaignDetailPanel.jsx';
import { NO_REVENUE_DISCLAIMER, evidenceClause, shortEvidence } from '@/features/campaigns/verdictEvidence.js';
import { groupCampaigns, GROUP_CONFIG, GROUP_ORDER } from '@/features/campaigns/campaignGrouping.js';

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

// The four metric cells shared by a campaign row and its ad-set rows.
function MetricCells({ m }) {
  return (
    <>
      <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-lumi-text"><Spend minor={m.spendMinor} currency={m.currency} /></td>
      <td className="px-4 py-2 text-right font-mono text-sm tabular-nums"><Roas v={m.roas} /></td>
      <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-lumi-text"><Ctr v={m.ctr} /></td>
      <td className="px-4 py-2 text-right font-mono text-sm tabular-nums"><Freq v={m.frequency} /></td>
    </>
  );
}

function AdSetRows({ state }) {
  if (!state || state.loading) {
    return (
      <tr><td colSpan={9} className="px-4 py-3 text-center text-xs text-lumi-subtle">
        <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1.5" strokeWidth={2} /> Loading ad sets…
      </td></tr>
    );
  }
  if (state.error) {
    return (
      <tr><td colSpan={9} className="px-4 py-3 text-center text-xs text-trend-danger">
        <AlertTriangle className="inline w-3.5 h-3.5 mr-1.5" strokeWidth={2} /> Couldn’t load ad sets — collapse and try again.
      </td></tr>
    );
  }
  if (state.adSets.length === 0) {
    return (
      <tr><td colSpan={9} className="px-4 py-3 text-center text-xs text-lumi-subtle">No ad sets synced for this campaign yet.</td></tr>
    );
  }
  return state.adSets.map((a) => (
    <tr key={a.entityId} className="bg-lumi-bg/40 border-b border-lumi-border/40">
      <td className="px-4 py-2.5 pl-10">
        <div className="font-display text-sm text-lumi-text">{a.name}</div>
        <div className="font-mono text-[11px] text-lumi-subtle">AD SET · {a.channel}</div>
      </td>
      <td className="px-4 py-2.5" />{/* verdicts are campaign-level — ad-set cell stays empty */}
      <td className="px-4 py-2.5" />{/* impact is campaign-level too — empty on ad-set rows */}
      <MetricCells m={a} />
      <td className="px-4 py-2.5" />
      <td className="px-4 py-2.5" />{/* detail toggle is campaign-level — empty on ad-set rows */}
    </tr>
  ));
}

export function ConnectorCampaignsPanel({ campaigns = [], verdicts = {}, relativeRanks = {}, impacts = {}, verdictInfo = {}, loading = false, error = null, deepLinkEntityId = null, onDeepLinkHandled }) {
  const [open, setOpen] = useState(new Set());          // ad-set drill-down
  const [detailOpen, setDetailOpen] = useState(new Set()); // signals + reasoning panel
  const { byId, load } = useEntityDrillDown();

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
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else { next.add(id); load(id); }
      return next;
    });
  };

  const toggleDetail = (id) => {
    setDetailOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // One campaign row (+ its detail and ad-set children). Lifted out of the map
  // so the grouped <tbody> stays readable; the markup is unchanged, and keeping
  // it a closure means no state has to be prop-drilled.
  const renderCampaignRow = (c) => {
    const isOpen = open.has(c.entityId);
    const isDetailOpen = detailOpen.has(c.entityId);
    const count = c.adSetCount ?? 0;
    const verdict = verdicts[c.entityId];
    const relativeRank = relativeRanks[c.entityId] ?? null;
    const impact = impacts[c.entityId] ?? null;
    const info = verdictInfo[c.entityId] ?? {};
    // The engine's own evidence words ("Lowest CTR in its group"),
    // never the internal "relative to portfolio" label. Fallback
    // states the TOP/BOTTOM field plainly when no rationale arrived.
    const badgeText = shortEvidence(info.rationale)
      ?? (relativeRank === 'BOTTOM' ? 'weakest engagement in its group' : 'strongest engagement in its group');
    const badgeTitle = `${evidenceClause(info.rationale) ?? badgeText} — ${NO_REVENUE_DISCLAIMER}`;
    return (
      <Fragment key={c.entityId}>
        <tr id={`campaign-row-${c.entityId}`} className="border-b border-lumi-border/50 hover:bg-lumi-elevated/40 transition-colors duration-100">
          <td className="px-4 py-2">
            <button
              type="button"
              onClick={() => count > 0 && toggle(c.entityId)}
              disabled={count === 0}
              aria-expanded={count > 0 ? isOpen : undefined}
              aria-label={count > 0 ? `Toggle ad sets for ${c.name}` : undefined}
              className={cn('inline-flex items-start gap-1.5 text-left', count > 0 ? 'cursor-pointer' : 'cursor-default')}
            >
              {count > 0
                ? (isOpen
                  ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 text-lumi-accent" strokeWidth={2} />
                  : <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-lumi-muted" strokeWidth={2} />)
                : <span className="w-3.5 h-3.5 inline-block" />}
              <span>
                <span className="block font-display font-medium text-xs text-lumi-text">{c.name}</span>
                <span className="block font-mono text-[11px] text-lumi-subtle">
                  {c.channel}
                  {/* A conversion campaign that spent but measured no revenue: its
                      ROAS cell reads "—" because the DATA is missing, not because
                      it performed badly. Say so next to the name. */}
                  {/* Subtle, not alarming: a missing revenue source is a
                      setup gap, not a live problem — muted so it reads as a
                      quiet hint next to the channel, not a warning. */}
                  {c.needsRevenue && (
                    <span className="ml-1.5 text-lumi-subtle">· needs revenue</span>
                  )}
                </span>
              </span>
            </button>
            {/* Revenue WAS uploaded, but it now lags the spend it would be
                divided by, so the engine stopped scoring it rather than show
                a drifted ROAS. A different story from "needs revenue" (none
                was ever given). Indicator ONLY — the re-upload CTA lives once
                (AlertsPanel/MetricsPanel), not repeated per row: a blue
                signal-watch link under every stale campaign read as N
                hyperlinks of noise. */}
            {c.revenueStale && (
              <span className="ml-5 block font-mono text-[11px] text-lumi-muted">
                · revenue outdated
              </span>
            )}
          </td>
          {/* Campaign-level verdict (revenue track OR awareness track). A
              gatedOut/dataless campaign has none → honest "—", never a faked one.
              A verdict decided by the portfolio-relative post-pass is badged
              so a revenue-free KILL/SCALE reads as an engagement-relative call. */}
          <td className="px-4 py-2">
            {verdict ? (
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                <VerdictPill verdict={verdict} size="sm" />
                {relativeRank && (
                  <span className="font-mono text-[10px] text-lumi-subtle whitespace-nowrap" title={badgeTitle}>
                    {badgeText}
                  </span>
                )}
              </span>
            ) : <Dash />}
          </td>
          <td className="px-4 py-2 text-right font-mono text-sm tabular-nums"><Impact score={impact} relativeRank={relativeRank} /></td>
          <MetricCells m={c} />
          <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-lumi-muted">{count > 0 ? count : <Dash />}</td>
          <td className="px-4 py-2 text-right">
            <button
              type="button"
              onClick={() => toggleDetail(c.entityId)}
              aria-expanded={isDetailOpen}
              aria-label={`Toggle details for ${c.name}`}
              className="inline-flex items-center justify-center rounded-md p-1 hover:bg-lumi-elevated transition-colors"
            >
              <ChevronDown
                className={cn('w-4 h-4 text-lumi-muted transition-transform', isDetailOpen && 'rotate-180 text-lumi-accent')}
                strokeWidth={2}
              />
            </button>
          </td>
        </tr>
        {isDetailOpen && (
          <tr className="border-b border-lumi-border/50 bg-lumi-bg/20">
            <td colSpan={9} className="px-4 pb-3 pt-0">
              <CampaignDetailPanel campaign={c} verdict={verdict} impact={impact} rationale={info.rationale ?? null} confidence={info.confidence ?? null} />
            </td>
          </tr>
        )}
        {isOpen && <AdSetRows state={byId[c.entityId]} />}
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
                <th scope="col" className="section-label px-4 py-2.5 text-left">Campaign</th>
                <th scope="col" className="section-label px-4 py-2.5 text-left w-28">
                  <span className="inline-flex items-center gap-1">Verdict <HelpTip content={HELP.VERDICT_COL} /></span>
                </th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-20">
                  <span className="inline-flex items-center gap-1">Impact <HelpTip variant="popover" content={HELP.IMPACT_SCORE} /></span>
                </th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-28">Spend</th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-20">
                  <span className="inline-flex items-center gap-1">ROAS <HelpTip content={HELP.ROAS} /></span>
                </th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-20">CTR</th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-20">
                  <span className="inline-flex items-center gap-1">Freq <HelpTip content={HELP.FREQUENCY} /></span>
                </th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-24">Ad sets</th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-12"><span className="sr-only">Details</span></th>
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
                      <td colSpan={9} className="px-4 pt-5 pb-1">
                        <div className="flex items-center gap-2">
                          <span className={cn('text-[10px] font-bold uppercase tracking-widest', config.color)}>
                            {config.label}
                          </span>
                          <span className="font-mono text-[10px] text-lumi-muted">{items.length}</span>
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
