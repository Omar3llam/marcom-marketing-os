import { ChevronUp, ChevronDown, BarChart3 } from 'lucide-react';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import InlineBar       from '@/components/ui/InlineBar.jsx';
import { cn }          from '@/lib/utils.js';
import { fmtCurrency, roasColor, freqColor } from './campaignFormatters.js';

function Th({ children, k, current, dir, onSort, className }) {
  const sortable = !!k;
  const isActive = current === k;
  return (
    <th
      scope="col"
      aria-sort={sortable ? (isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
      className={cn('section-label px-4 py-3 select-none', className, sortable && 'cursor-pointer')}
      onClick={() => sortable && onSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && isActive && (dir === 'asc'
          ? <ChevronUp className="w-3 h-3" strokeWidth={2} />
          : <ChevronDown className="w-3 h-3" strokeWidth={2} />)}
      </span>
    </th>
  );
}

// Missing metric → em-dash, never 0.00. A blank value and a true zero must not
// look identical (governing-law honest-empty rule).
const Dash = () => <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>;

function EmptyTable({ loading, emptyChannel, hasConnectorData }) {
  if (loading) return <div className="p-12 text-center text-lumi-subtle">Loading…</div>;
  if (emptyChannel) {
    return (
      <div className="p-12 text-center">
        <BarChart3 className="w-12 h-12 mx-auto text-lumi-subtle" strokeWidth={1.5} />
        <p className="mt-3 font-display text-lumi-text">No {emptyChannel} campaigns in this workspace.</p>
        <p className="mt-1 text-lumi-muted text-sm">Switch the channel filter to “All” to see every campaign.</p>
      </div>
    );
  }
  // This table is the legacy campaign-analysis substrate. When live connector
  // data exists it renders below (Connected channels) + in the budget chart — so
  // DON'T claim the page is empty here; point to the live section instead. The CSV
  // upload path was removed, so there is no upload affordance — connect Meta to
  // populate campaigns.
  if (hasConnectorData) {
    return (
      <div className="p-12 text-center">
        <BarChart3 className="w-12 h-12 mx-auto text-lumi-subtle" strokeWidth={1.5} />
        <p className="mt-3 font-display text-lumi-text">Live verdicts are shown below in Connected channels.</p>
        <p className="mt-1 text-lumi-muted text-sm">Per-campaign analysis appears here as your channels sync.</p>
      </div>
    );
  }
  // Genuinely empty — nothing connected yet.
  return (
    <div className="p-12 text-center">
      <BarChart3 className="w-12 h-12 mx-auto text-lumi-subtle" strokeWidth={1.5} />
      <p className="mt-3 font-display text-lumi-text">No campaign data yet.</p>
      <p className="mt-1 text-lumi-muted text-sm">Connect your Meta account to get started.</p>
    </div>
  );
}

export function AnalysisSummary({ rows, loading, sortKey, sortDir, setSort, expanded, setExpanded, currency = 'USD', emptyChannel = null, hasConnectorData = false }) {
  return (
    <section className="bg-lumi-surface border border-lumi-border rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
      {rows.length === 0 ? (
        <EmptyTable loading={loading} emptyChannel={emptyChannel} hasConnectorData={hasConnectorData} />
      ) : (
        <div className="overflow-auto">
          <table className="w-full">
            <thead className="bg-lumi-elevated border-b border-lumi-border sticky top-0">
              <tr>
                <Th k="campaign" current={sortKey} dir={sortDir} onSort={setSort} className="text-left">Campaign</Th>
                <Th k="spend"    current={sortKey} dir={sortDir} onSort={setSort} className="text-right w-28">Spend</Th>
                <Th k="ctr"      current={sortKey} dir={sortDir} onSort={setSort} className="text-right w-20">CTR</Th>
                <Th k="roas"     current={sortKey} dir={sortDir} onSort={setSort} className="text-right w-20">ROAS</Th>
                <Th className="text-right w-20">Freq</Th>
                <Th className="text-center w-28">Decision</Th>
                <Th k="impact"   current={sortKey} dir={sortDir} onSort={setSort} className="text-left w-36">Impact</Th>
                <Th className="text-left flex-1">Reasoning</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded.has(r.id);
                return (
                  <tr key={r.id} className="border-b border-lumi-border/50 hover:bg-lumi-elevated/40 transition-colors duration-100">
                    <td className="px-4 py-3">
                      <div className="font-display font-medium text-sm text-lumi-text">{r.campaign}</div>
                      <div className="font-mono text-xs text-lumi-subtle mt-0.5">{r.platform}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-lumi-text">{r.spend == null ? <Dash /> : fmtCurrency(r.spend, r.currency || currency)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-lumi-text">{r.ctr == null ? <Dash /> : `${r.ctr.toFixed(2)}%`}</td>
                    <td className={cn('px-4 py-3 text-right font-mono text-sm tabular-nums', r.roas == null ? 'text-lumi-subtle' : roasColor(r.roas))}>{r.roas == null ? <Dash /> : `${r.roas.toFixed(2)}x`}</td>
                    <td className={cn('px-4 py-3 text-right font-mono text-sm tabular-nums', r.freq == null ? 'text-lumi-subtle' : freqColor(r.freq))}>{r.freq == null ? <Dash /> : r.freq.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center"><VerdictPill verdict={r.verdict} /></td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-lumi-text">{r.impact}/10</div>
                      <div className="mt-1.5"><InlineBar value={r.impact} max={10} ariaLabel={`Impact ${r.impact} of 10`} /></div>
                    </td>
                    <td className="px-4 py-3 text-xs text-lumi-muted leading-relaxed">
                      <div className={cn(!isOpen && 'line-clamp-2')}>{r.reasoning}</div>
                      {(r.reasoning?.length ?? 0) > 110 && (
                        <button
                          type="button"
                          aria-label={isOpen ? 'Collapse reasoning' : 'Expand reasoning'}
                          onClick={() => setExpanded((s) => {
                            const next = new Set(s);
                            if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                            return next;
                          })}
                          className="mt-1 inline-flex items-center text-lumi-accent hover:text-lumi-accent-hover"
                        >
                          {isOpen ? <ChevronUp className="w-3.5 h-3.5" strokeWidth={2} /> : <ChevronDown className="w-3.5 h-3.5" strokeWidth={2} />}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
