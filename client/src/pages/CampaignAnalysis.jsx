// ============================================================
// MARCOM / Lumi — CampaignAnalysis  (/app/campaigns)
// ------------------------------------------------------------
// Bloomberg-terminal-style analysis report:
//   - 4 KPI summary cards (top)
//   - Budget allocation bar (KILL / HOLD / SCALE proportional)
//   - Sortable campaign data table (7 columns)
// All metrics derived from the live /api/lumi/feed payload.
// ============================================================
import { useMemo, useState } from 'react';
import {
  Upload, ChevronUp, ChevronDown, BarChart3, X, RefreshCw, Loader2,
} from 'lucide-react';
import { useCampaignFeed, metricValue } from '@/hooks/useCampaignFeed.js';
import { VerdictPill } from '@/components/ui/DecisionPill.jsx';
import InlineBar       from '@/components/ui/InlineBar.jsx';
import CsvUploader     from '@/components/upload/CsvUploader.jsx';
import { cn }          from '@/lib/utils.js';
import { useCampaignAnalysis } from '@/hooks/useCampaignAnalysis.js';

// Flatten campaigns → rows the table can sort + render.
function flatten(campaigns) {
  const rows = [];
  for (const c of campaigns) {
    for (const a of c.alerts ?? []) {
      const spend = metricValue(a, 'spend') ?? metricValue(a, 'amount spent') ?? 0;
      const ctr   = metricValue(a, 'CTR') ?? 0;
      const roas  = metricValue(a, 'ROAS') ?? 0;
      const freq  = metricValue(a, 'Frequency') ?? metricValue(a, 'Freq') ?? 0;
      const verdict  = a.analysis?.verdict || 'HOLD';
      const reason   = a.analysis?.root_cause || a.action_plan?.action || '—';
      const platform = (a.action_plan?.kind || a.action_plan?.platform || a.platform || 'META').toUpperCase();
      // Crude impact: KILL > HOLD > SCALE (act-on-this priority)
      const impact = verdict === 'KILL' ? 9 : verdict === 'HOLD' ? 6 : verdict === 'SCALE' ? 4 : 5;

      rows.push({
        id: a.action_id,
        campaign: c.campaign_id,
        platform,
        spend, ctr, roas, freq,
        verdict,
        impact,
        reasoning: reason,
      });
    }
  }
  return rows;
}

const sortableCols = new Set(['campaign', 'spend', 'ctr', 'roas', 'impact']);

export default function CampaignAnalysis() {
  const { campaigns, loading, refetch, setCampaigns } = useCampaignFeed();
  const [sortKey, setSortKey] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  const [expanded, setExpanded] = useState(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);

  const { syncing, handleAnalysisComplete, handleMetaSync } = useCampaignAnalysis({
    refetch, setCampaigns, setUploadOpen,
  });

  const rows = useMemo(() => {
    const all = flatten(campaigns);
    const sorted = [...all].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return sorted;
  }, [campaigns, sortKey, sortDir]);

  const totals = useMemo(() => {
    const r = { spend: 0, kill: 0, hold: 0, scale: 0, cpaSum: 0, cpaCount: 0 };
    for (const row of rows) {
      r.spend += row.spend;
      if (row.verdict === 'KILL')  r.kill  += row.spend;
      if (row.verdict === 'HOLD')  r.hold  += row.spend;
      if (row.verdict === 'SCALE') r.scale += row.spend;
    }
    const blendedCpa = r.cpaCount > 0 ? r.cpaSum / r.cpaCount : null;
    return { ...r, blendedCpa, wastedPct: r.spend > 0 ? Math.round((r.kill / r.spend) * 100) : 0 };
  }, [rows]);

  const healthScore = rows.length === 0 ? 0
    : Math.round(((totals.scale * 100 + totals.hold * 60 + totals.kill * 20) / Math.max(1, totals.spend)));
  const healthLabel = healthScore < 40 ? 'NEEDS ATTENTION' : healthScore < 70 ? 'IMPROVING' : 'HEALTHY';
  const healthColor = healthScore < 40 ? 'text-trend-danger'
                    : healthScore < 70 ? 'text-trend-warning'
                    : 'text-trend-positive';

  const setSort = (key) => {
    if (!sortableCols.has(key)) return;
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div className="flex flex-col h-full p-6 lg:p-8 animate-fade-in">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="decision-title text-lumi-text">Campaign Analysis</h1>
          <p className="font-mono text-xs text-lumi-subtle mt-1">
            {rows.length === 0 ? 'No data uploaded yet' : `${rows.length} campaign${rows.length === 1 ? '' : 's'} · live`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleMetaSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 bg-lumi-gold text-dark-base rounded-xl px-4 py-2 text-sm font-semibold hover:bg-lumi-deep disabled:opacity-60 transition-all"
          >
            {syncing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
            }
            {syncing ? 'Syncing…' : 'Sync Live Meta'}
          </button>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 bg-lumi-elevated border border-lumi-border rounded-xl px-4 py-2 text-sm font-display text-lumi-text hover:border-lumi-accent/40 transition-all"
          >
            <Upload className="w-3.5 h-3.5" strokeWidth={1.5} /> Upload CSV
          </button>
        </div>
      </header>

      {/* ── KPI CARDS ───────────────────────────────────────── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total Spend" value={fmtCurrency(totals.spend)}
                 delta={loading ? '—' : 'Live · CSV-derived'} deltaClass="text-lumi-subtle" />
        <KpiCard label="Blended CPA" value={totals.blendedCpa != null ? fmtCurrency(totals.blendedCpa) : '—'}
                 delta={totals.blendedCpa != null ? 'Per-campaign avg' : 'No CPA in dataset'} deltaClass="text-lumi-subtle" />
        <KpiCard label="Wasted Spend" value={fmtCurrency(totals.kill)}
                 valueClass="text-trend-danger"
                 delta={`${totals.wastedPct}% of total`} deltaClass="text-trend-danger"
                 footer={<InlineBar value={totals.wastedPct} max={100} ariaLabel={`${totals.wastedPct}% wasted spend`} />} />
        <KpiCard label="Account Health" value={`${healthScore}/100`} valueClass={healthColor}
                 delta={healthLabel} deltaClass={healthColor} />
      </section>

      {/* ── BUDGET ALLOCATION BAR ───────────────────────────── */}
      <section className="mb-6">
        <div className="section-label mb-3">Budget Allocation Recommendation</div>
        {totals.spend > 0 ? (
          <>
            <div
              className="h-4 rounded-full overflow-hidden flex bg-lumi-border"
              role="img"
              aria-label={`Allocation: kill ${pct(totals.kill, totals.spend)}%, hold ${pct(totals.hold, totals.spend)}%, scale ${pct(totals.scale, totals.spend)}%`}
            >
              <div className="bg-signal-kill"  style={{ width: `${pct(totals.kill,  totals.spend)}%` }} />
              <div className="bg-signal-hold"  style={{ width: `${pct(totals.hold,  totals.spend)}%` }} />
              <div className="bg-signal-scale" style={{ width: `${pct(totals.scale, totals.spend)}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
              <LegendDot color="bg-signal-kill"  text="Kill"  pct={pct(totals.kill,  totals.spend)} className="text-signal-kill"  />
              <LegendDot color="bg-signal-hold"  text="Hold"  pct={pct(totals.hold,  totals.spend)} className="text-signal-hold"  />
              <LegendDot color="bg-signal-scale" text="Scale" pct={pct(totals.scale, totals.spend)} className="text-signal-scale" />
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-lumi-border bg-lumi-surface/40 p-6 text-center text-sm text-lumi-muted">
            Upload a CSV to see budget allocation.
          </div>
        )}
      </section>

      {/* ── DATA TABLE ──────────────────────────────────────── */}
      <section className="bg-lumi-surface border border-lumi-border rounded-2xl overflow-hidden flex-1 min-h-0 flex flex-col">
        {rows.length === 0 ? (
          <EmptyTable onUpload={() => setUploadOpen(true)} loading={loading} />
        ) : (
          <div className="overflow-auto">
            <table className="w-full">
              <thead className="bg-lumi-elevated border-b border-lumi-border sticky top-0">
                <tr>
                  <Th k="campaign"  current={sortKey} dir={sortDir} onSort={setSort} className="text-left">Campaign</Th>
                  <Th k="spend"     current={sortKey} dir={sortDir} onSort={setSort} className="text-right w-28">Spend</Th>
                  <Th k="ctr"       current={sortKey} dir={sortDir} onSort={setSort} className="text-right w-20">CTR</Th>
                  <Th k="roas"      current={sortKey} dir={sortDir} onSort={setSort} className="text-right w-20">ROAS</Th>
                  <Th                                                        className="text-right w-20">Freq</Th>
                  <Th                                                        className="text-center w-28">Decision</Th>
                  <Th k="impact"    current={sortKey} dir={sortDir} onSort={setSort} className="text-left w-36">Impact</Th>
                  <Th                                                        className="text-left flex-1">Reasoning</Th>
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
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-lumi-text">{fmtCurrency(r.spend)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-lumi-text">{r.ctr.toFixed(2)}%</td>
                      <td className={cn('px-4 py-3 text-right font-mono text-sm tabular-nums', roasColor(r.roas))}>{r.roas.toFixed(2)}x</td>
                      <td className={cn('px-4 py-3 text-right font-mono text-sm tabular-nums', freqColor(r.freq))}>{r.freq.toFixed(2)}</td>
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

      {/* ── UPLOAD MODAL ────────────────────────────────────── */}
      {uploadOpen && (
        <div
          role="dialog" aria-modal="true" aria-labelledby="upload-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setUploadOpen(false); }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-lumi-border-strong bg-lumi-surface p-6 shadow-modal animate-slide-up">
            <div className="mb-4 flex items-center justify-between">
              <h3 id="upload-dialog-title" className="font-display font-bold text-lg text-lumi-text">Upload campaign data</h3>
              <button type="button" aria-label="Close" onClick={() => setUploadOpen(false)} className="rounded-md p-1 text-lumi-muted hover:bg-lumi-elevated hover:text-lumi-text">
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
            <CsvUploader mode="analyze" onSuccess={handleAnalysisComplete} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers + sub-components ────────────────────────────────
function KpiCard({ label, value, valueClass, delta, deltaClass, footer }) {
  return (
    <article className="bg-lumi-surface border border-lumi-border rounded-xl p-5">
      <div className="section-label">{label}</div>
      <div className={cn('mt-2 metric-display text-lumi-text', valueClass)}>{value}</div>
      {delta && <div className={cn('mt-1 text-xs font-mono', deltaClass)}>{delta}</div>}
      {footer && <div className="mt-3">{footer}</div>}
    </article>
  );
}

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

function LegendDot({ color, text, pct, className }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className={cn('w-2 h-2 rounded-full', color)} aria-hidden="true" />
      {text} · {pct}%
    </span>
  );
}

function EmptyTable({ onUpload, loading }) {
  if (loading) return <div className="p-12 text-center text-lumi-subtle">Loading…</div>;
  return (
    <div className="p-12 text-center">
      <BarChart3 className="w-12 h-12 mx-auto text-lumi-subtle" strokeWidth={1.5} />
      <p className="mt-3 font-display text-lumi-text">No campaigns analyzed yet.</p>
      <p className="mt-1 text-lumi-muted text-sm">Upload a CSV to get SCALE / HOLD / KILL verdicts.</p>
      <button
        type="button"
        onClick={onUpload}
        className="mt-4 inline-flex items-center gap-1.5 bg-lumi-accent text-lumi-bg font-display font-semibold px-4 py-2 rounded-xl text-sm shadow-accent-glow hover:bg-lumi-accent-hover"
      >
        <Upload className="w-3.5 h-3.5" strokeWidth={2} /> Upload CSV
      </button>
    </div>
  );
}

function fmtCurrency(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}
function roasColor(v) {
  if (v < 1.0) return 'text-trend-danger';
  if (v < 2.5) return 'text-trend-warning';
  return 'text-trend-positive';
}
function freqColor(v) {
  if (v > 5)   return 'text-trend-danger';
  if (v > 3.5) return 'text-trend-warning';
  return 'text-lumi-text';
}
