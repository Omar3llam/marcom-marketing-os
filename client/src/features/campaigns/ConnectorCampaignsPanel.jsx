// ============================================================
// MARCOM / Lumi — ConnectorCampaignsPanel  (Campaigns · /app/campaigns)
// ------------------------------------------------------------
// Renders connector-synced campaigns (the entity graph the Sync button writes)
// as a DISTINCT section from the CSV-fed AnalysisSummary table — the two are
// disjoint substrates and must not be conflated. Each campaign drills into its
// ad sets (the connector graph is the only place ad-set detail exists).
//
// Governing law: every metric traces to a MetricSnapshot row. A missing metric
// renders "—" (Dash), never a fabricated 0. Loading/error/empty are honest.
// ============================================================
import { useState, Fragment } from 'react';
import { ChevronRight, ChevronDown, Loader2, Plug, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { roasColor, freqColor } from '@/components/campaign-analysis/campaignFormatters.js';
import { formatCurrency } from '@/lib/money';
import { useEntityDrillDown } from '@/hooks/useEntityDrillDown.js';

// Missing metric → em-dash, never 0 (a true zero and "no data" must not look alike).
const Dash = () => <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>;

// Spend is stored in minor units — format directly (formatCurrency applies the
// currency's real exponent; the old minor/100 truncated 3-dp currencies like KWD).
const Spend = ({ minor, currency }) => (minor == null ? <Dash /> : formatCurrency(minor, currency || 'USD'));
const Roas  = ({ v }) => (v == null ? <Dash /> : <span className={roasColor(v)}>{v.toFixed(2)}x</span>);
const Ctr   = ({ v }) => (v == null ? <Dash /> : `${(v * 100).toFixed(2)}%`); // ratio → percent
const Freq  = ({ v }) => (v == null ? <Dash /> : <span className={freqColor(v)}>{v.toFixed(2)}</span>);

// The four metric cells shared by a campaign row and its ad-set rows.
function MetricCells({ m }) {
  return (
    <>
      <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-lumi-text"><Spend minor={m.spendMinor} currency={m.currency} /></td>
      <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums"><Roas v={m.roas} /></td>
      <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-lumi-text"><Ctr v={m.ctr} /></td>
      <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums"><Freq v={m.frequency} /></td>
    </>
  );
}

function AdSetRows({ state }) {
  if (!state || state.loading) {
    return (
      <tr><td colSpan={6} className="px-4 py-3 text-center text-xs text-lumi-subtle">
        <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1.5" strokeWidth={2} /> Loading ad sets…
      </td></tr>
    );
  }
  if (state.error) {
    return (
      <tr><td colSpan={6} className="px-4 py-3 text-center text-xs text-trend-danger">
        <AlertTriangle className="inline w-3.5 h-3.5 mr-1.5" strokeWidth={2} /> Couldn’t load ad sets — collapse and try again.
      </td></tr>
    );
  }
  if (state.adSets.length === 0) {
    return (
      <tr><td colSpan={6} className="px-4 py-3 text-center text-xs text-lumi-subtle">No ad sets synced for this campaign yet.</td></tr>
    );
  }
  return state.adSets.map((a) => (
    <tr key={a.entityId} className="bg-lumi-bg/40 border-b border-lumi-border/40">
      <td className="px-4 py-2.5 pl-10">
        <div className="font-display text-sm text-lumi-text">{a.name}</div>
        <div className="font-mono text-[11px] text-lumi-subtle">AD SET · {a.channel}</div>
      </td>
      <MetricCells m={a} />
      <td className="px-4 py-2.5" />
    </tr>
  ));
}

export function ConnectorCampaignsPanel({ campaigns = [], loading = false, error = null }) {
  const [open, setOpen] = useState(new Set());
  const { byId, load } = useEntityDrillDown();

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
        <div className="overflow-auto">
          <table className="w-full">
            <thead className="bg-lumi-elevated/60 border-b border-lumi-border">
              <tr>
                <th scope="col" className="section-label px-4 py-2.5 text-left">Campaign</th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-28">Spend</th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-20">ROAS</th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-20">CTR</th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-20">Freq</th>
                <th scope="col" className="section-label px-4 py-2.5 text-right w-24">Ad sets</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const isOpen = open.has(c.entityId);
                const count = c.adSetCount ?? 0;
                return (
                  <Fragment key={c.entityId}>
                    <tr className="border-b border-lumi-border/50 hover:bg-lumi-elevated/40 transition-colors duration-100">
                      <td className="px-4 py-3">
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
                            <span className="block font-display font-medium text-sm text-lumi-text">{c.name}</span>
                            <span className="block font-mono text-[11px] text-lumi-subtle">{c.channel}</span>
                          </span>
                        </button>
                      </td>
                      <MetricCells m={c} />
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-lumi-muted">{count > 0 ? count : <Dash />}</td>
                    </tr>
                    {isOpen && <AdSetRows state={byId[c.entityId]} />}
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
