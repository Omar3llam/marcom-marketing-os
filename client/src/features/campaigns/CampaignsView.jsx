// ============================================================
// MARCOM / Lumi — CampaignAnalysis  (/app/campaigns)
// ------------------------------------------------------------
// Bloomberg-terminal-style analysis report.
// All metrics derived from the live /api/lumi/feed payload.
// ============================================================
import { useMemo, useState } from 'react';
import { Upload, RefreshCw, Loader2, X, Download } from 'lucide-react';
import { useCampaignFeed, metricValue } from '@/hooks/useCampaignFeed.js';
import CsvUploader from '@/components/upload/CsvUploader.jsx';
import { useCampaignAnalysis } from '@/hooks/useCampaignAnalysis.js';
import { MetricsPanel }    from '@/components/campaign-analysis/MetricsPanel.jsx';
import { PerformanceChart } from '@/components/campaign-analysis/PerformanceChart.jsx';
import { AnalysisSummary } from '@/components/campaign-analysis/AnalysisSummary.jsx';
import { generateCampaignReport, generateTextReport } from '@/lib/pdfExport.js';

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
      const impact = verdict === 'KILL' ? 9 : verdict === 'HOLD' ? 6 : verdict === 'SCALE' ? 4 : 5;
      const currency = a.currency || a._rawDecision?.currency || 'USD';  // Extract currency from alert
      rows.push({ id: a.action_id, campaign: c.campaign_id, platform, spend, ctr, roas, freq, verdict, impact, reasoning: reason, currency });
    }
  }
  return rows;
}

const sortableCols = new Set(['campaign', 'spend', 'ctr', 'roas', 'impact']);

export default function CampaignsView() {
  const { campaigns, loading, refetch, setCampaigns } = useCampaignFeed();
  const [sortKey, setSortKey] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  const [expanded, setExpanded] = useState(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);

  const { syncing, handleAnalysisComplete, handleMetaSync } = useCampaignAnalysis({
    refetch, setCampaigns, setUploadOpen,
  });

  const [downloading, setDownloading] = useState(false);

  const handleDownloadPdf = async () => {
    if (rows.length === 0) {
      alert('No campaign data to export');
      return;
    }

    setDownloading(true);
    try {
      await generateCampaignReport({
        campaigns: rows,
        totals,
        healthScore,
        healthLabel,
      });
    } catch (error) {
      console.error('PDF generation failed:', error);
      // Fallback to text export
      generateTextReport({
        campaigns: rows,
        totals,
        healthScore,
        healthLabel,
      });
    } finally {
      setDownloading(false);
    }
  };

  const rows = useMemo(() => {
    const all = flatten(campaigns);
    return [...all].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [campaigns, sortKey, sortDir]);

  // Detect primary currency from campaigns (first non-USD currency wins, or USD if all are USD)
  const currency = useMemo(() => {
    for (const row of rows) {
      if (row.currency && row.currency !== 'USD') return row.currency;
    }
    return rows[0]?.currency || 'USD';
  }, [rows]);

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
            {rows.length === 0 ? 'No data uploaded yet' : `${rows.length} campaign${rows.length === 1 ? '' : 's'} · live`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloading || rows.length === 0}
            className="inline-flex items-center gap-1.5 bg-lumi-elevated border border-lumi-border rounded-xl px-4 py-2 text-sm font-display text-lumi-text hover:border-lumi-accent/40 disabled:opacity-60 transition-all"
            title={rows.length === 0 ? 'No data to export' : 'Download PDF Report'}
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

      <AnalysisSummary
        rows={rows}
        loading={loading}
        sortKey={sortKey}
        sortDir={sortDir}
        setSort={setSort}
        expanded={expanded}
        setExpanded={setExpanded}
        onUpload={() => setUploadOpen(true)}
        currency={currency}
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
