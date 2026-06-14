// ============================================================
// MARCOM / Lumi — CampaignAnalysis  (/app/campaigns)
// ------------------------------------------------------------
// Bloomberg-terminal-style analysis report.
// All metrics derived from the live /api/lumi/feed payload.
// ============================================================
import { useMemo, useState } from 'react';
import { Upload, RefreshCw, Loader2, X, Download } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useCampaignFeed, metricValue } from '@/hooks/useCampaignFeed.js';
import CsvUploader from '@/components/upload/CsvUploader.jsx';
import { useCampaignAnalysis } from '@/hooks/useCampaignAnalysis.js';
import { MetricsPanel }    from '@/components/campaign-analysis/MetricsPanel.jsx';
import { PerformanceChart } from '@/components/campaign-analysis/PerformanceChart.jsx';
import { AnalysisSummary } from '@/components/campaign-analysis/AnalysisSummary.jsx';
import { generateCampaignReport, generateTextReport } from '@/lib/pdfExport.js';

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

// Null-last numeric/string comparator: an unknown metric is not a small number,
// so it always sinks to the bottom regardless of sort direction.
function compareRows(a, b, key, dir) {
  const av = a[key], bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
  return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
}

const sortableCols = new Set(['campaign', 'spend', 'ctr', 'roas', 'impact']);

export default function CampaignsView() {
  const { campaigns, loading, refetch, setCampaigns } = useCampaignFeed();
  const [sortKey, setSortKey] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  // `expanded` drives the per-row reasoning expand/collapse (a real feature).
  // NOTE: entity-level (AdSet) drill-down is intentionally NOT wired here. The
  // feed identifies campaigns by name string, which does not join to
  // MetricSnapshot.entityId (a UUID), and no /adsets route exists yet — so a
  // drill-down would have nothing real to load. Deferred until the entity graph
  // is linked to the feed; we don't fake an empty expansion.
  const [expanded, setExpanded] = useState(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [channel, setChannel] = useState('ALL');   // CAPABILITY 2 — channel filter

  const { syncing, handleAnalysisComplete, handleMetaSync } = useCampaignAnalysis({
    refetch, setCampaigns, setUploadOpen,
  });

  const [downloading, setDownloading] = useState(false);

  const handleDownloadPdf = async () => {
    if (allRows.length === 0) {
      alert('No campaign data to export');
      return;
    }

    setDownloading(true);
    try {
      await generateCampaignReport({
        campaigns: allRows,
        totals,
        healthScore,
        healthLabel,
      });
    } catch (error) {
      console.error('PDF generation failed:', error);
      // Fallback to text export
      generateTextReport({
        campaigns: allRows,
        totals,
        healthScore,
        healthLabel,
      });
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

  // Table rows: channel-filtered, then sorted (null metrics last).
  const tableRows = useMemo(() => {
    const filtered = channel === 'ALL' ? allRows : allRows.filter((r) => r.platform === channel);
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [allRows, channel, sortKey, sortDir]);

  // Detect primary currency from campaigns (first non-USD currency wins, or USD if all are USD)
  const currency = useMemo(() => {
    for (const row of allRows) {
      if (row.currency && row.currency !== 'USD') return row.currency;
    }
    return allRows[0]?.currency || 'USD';
  }, [allRows]);

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

  // Real account health = mean of the per-campaign health_score from the feed
  // (computeHealthScore, 0–1), scaled to 0–100. Never inferred from verdicts;
  // 0 ("no score yet") when nothing has been scored.
  const healthScore = useMemo(() => {
    const scores = campaigns.map((c) => c.health_score).filter((s) => Number.isFinite(s));
    return scores.length === 0
      ? 0
      : Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 100);
  }, [campaigns]);
  const healthLabel = healthScore < 40 ? 'NEEDS ATTENTION' : healthScore < 70 ? 'IMPROVING' : 'HEALTHY';
  const healthColor = healthScore < 40 ? 'text-trend-danger' : healthScore < 70 ? 'text-trend-warning' : 'text-trend-positive';

  const setSort = (key) => {
    if (!sortableCols.has(key)) return;
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div className="flex flex-col h-full p-6 lg:p-8 animate-fade-in">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="decision-title text-lumi-text">Campaign Analysis</h1>
          <p className="font-mono text-xs text-lumi-subtle mt-1">
            {allRows.length === 0 ? 'No data uploaded yet' : `${allRows.length} campaign${allRows.length === 1 ? '' : 's'} · live`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloading || allRows.length === 0}
            className="inline-flex items-center gap-1.5 bg-lumi-elevated border border-lumi-border rounded-xl px-4 py-2 text-sm font-display text-lumi-text hover:border-lumi-accent/40 disabled:opacity-60 transition-all"
            title={allRows.length === 0 ? 'No data to export' : 'Download PDF Report'}
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
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 bg-lumi-elevated border border-lumi-border rounded-xl px-4 py-2 text-sm font-display text-lumi-text hover:border-lumi-accent/40 transition-all"
          >
            <Upload className="w-3.5 h-3.5" strokeWidth={1.5} /> Upload CSV
          </button>
        </div>
      </header>

      <MetricsPanel
        totals={totals}
        loading={loading}
        healthScore={healthScore}
        healthLabel={healthLabel}
        healthColor={healthColor}
        currency={currency}
      />

      <PerformanceChart totals={totals} currency={currency} />

      {/* Channel filter — rendered only when ≥2 real channels exist in the data,
          so it never shows an empty "Google" pill before Google data flows. */}
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
        onUpload={() => setUploadOpen(true)}
        currency={currency}
        emptyChannel={channel !== 'ALL' && tableRows.length === 0 ? channel : null}
      />

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
