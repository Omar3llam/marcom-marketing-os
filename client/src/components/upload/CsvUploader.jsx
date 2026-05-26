// ============================================================
// MARCOM / Lumi — CsvUploader
// ------------------------------------------------------------
// Drag-drop or click upload of Meta / Google Ads CSV exports.
// Hits POST /api/campaigns/upload-csv with field name "campaignData".
// Surfaces upload progress, success summary, and granular errors.
// ============================================================
import { useState, useRef, useCallback } from 'react';
import { CloudUpload, FileText, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { api }   from '../../lib/api.js';
import { cn }    from '../../lib/utils.js';
import { useIntelligence } from '../../context/IntelligenceContext.jsx';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * CsvUploader component
 * @param {object} props
 * @param {function} props.onSuccess - Callback when upload succeeds
 * @param {boolean} props.compact - Compact layout flag
 * @param {'analyze'|'db-write'} props.mode - Upload mode:
 *   - 'analyze': stateless AI analysis (no DB writes, returns decisions)
 *   - 'db-write' (default): persists to DB, creates Action rows
 */
export default function CsvUploader({ onSuccess, compact = false, mode = 'db-write' }) {
  const inputRef   = useRef(null);
  const [file,     setFile]     = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy,     setBusy]     = useState(false);
  const [result,   setResult]   = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const { refresh } = useIntelligence();

  const pickFile = (f) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') {
      toast.error('Only .csv files are accepted.');
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error('File too large — 10 MB max.');
      return;
    }
    setFile(f);
    setResult(null);
    setProgress(0);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  }, []);

  const handleUpload = async () => {
    if (!file || busy) return;
    setBusy(true);
    setProgress(0);

    const form = new FormData();
    form.append('campaignData', file);

    try {
      // Append ?mode=analyze query param if in analyze mode
      const endpoint = mode === 'analyze'
        ? '/api/campaigns/upload-csv?mode=analyze'
        : '/api/campaigns/upload-csv';

      const res = await api.post(endpoint, form, {
        // Don't set Content-Type manually — axios sets multipart/form-data with boundary automatically
        timeout: mode === 'analyze' ? 180_000 : 60_000, // 3 min for AI analysis, 1 min for DB write
        onUploadProgress: (evt) => {
          if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      });

      setResult(res.data);

      // Show success toast based on mode
      if (mode === 'analyze') {
        const analyzed = res.data.stats?.analyzed || res.data.decisions?.length || 0;
        toast.success(
          `Analyzed ${analyzed} campaign${analyzed === 1 ? '' : 's'} · ${res.data.decisions?.length || 0} decision${res.data.decisions?.length === 1 ? '' : 's'} generated`,
          { description: 'AI analysis complete — rendering intelligence layer' },
        );
      } else {
        const campaignCount = res.data.campaign_ids?.length || 0;
        toast.success(
          `Processed ${res.data.processed} of ${res.data.uploaded} rows · ${campaignCount} campaign${campaignCount === 1 ? '' : 's'} created.`,
        );
      }

      onSuccess?.(res.data);
      // Trigger intelligence refresh: campaigns + memory update simultaneously
      refresh();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Upload failed';
      toast.error(msg);
      setResult({ error: msg, detail: err.response?.data?.detail });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setFile(null); setProgress(0); setResult(null); };

  return (
    <div className={cn('w-full', compact && 'text-sm')}>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'rounded-xl border-2 border-dashed p-8 text-center cursor-pointer',
          'transition-colors',
          dragOver ? 'border-lumi-gold/60 bg-lumi-gold/10' : 'border-surface-border bg-surface-light hover:border-lumi-gold/40',
          compact && 'p-5',
        )}
      >
        <CloudUpload className={cn('mx-auto mb-3 text-lumi-gold', compact ? 'h-6 w-6' : 'h-10 w-10')} />
        <p className="font-display text-sm font-medium text-dark-base">
          Drag &amp; drop a CSV here, or click to choose
        </p>
        <p className="mt-1 font-mono text-xs text-dark-soft">
          Meta Ads Manager or Google Ads export · up to 10 MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
      </div>

      {/* Selected file row */}
      {file && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-surface-border bg-surface-card p-3 shadow-card">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-4 w-4 shrink-0 text-lumi-gold" />
            <div className="min-w-0">
              <div className="truncate font-body text-sm text-dark-base">{file.name}</div>
              <div className="font-mono text-xs text-dark-soft">{(file.size / 1024).toFixed(1)} KB</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUpload}
              disabled={busy}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold',
                'bg-lumi-gold text-dark-base hover:bg-lumi-deep disabled:opacity-60 disabled:cursor-not-allowed font-display',
              )}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy
                ? progress < 100
                  ? `Uploading ${progress}%`
                  : mode === 'analyze'
                    ? 'Analyzing with AI...'
                    : 'Processing...'
                : 'Upload'}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              aria-label="Remove"
              className="rounded-md p-1 text-dark-soft hover:bg-surface-border hover:text-dark-base transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {busy && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-border">
          <div
            className="h-full bg-lumi-gold transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Result panel */}
      {result && !result.error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-signal-scale/20 bg-signal-scale-bg p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal-scale" />
          <div className="text-signal-scale">
            <div className="font-display font-semibold">Upload complete</div>
            <div className="font-mono text-xs text-signal-scale/80">
              {mode === 'analyze' ? (
                <>
                  {result.stats?.analyzed || 0} analyzed · {result.decisions?.length || 0} decisions
                  {Array.isArray(result.errors) && result.errors.length > 0 && (
                    <span> · {result.errors.length} error(s)</span>
                  )}
                </>
              ) : (
                <>
                  {result.processed} processed · {result.alerts_created} alerts seeded
                  {Array.isArray(result.errors) && result.errors.length > 0 && (
                    <span> · {result.errors.length} row error(s)</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {result?.error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-signal-kill/20 bg-signal-kill-bg p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-kill" />
          <div className="text-signal-kill">
            <div className="font-display font-semibold">{result.error}</div>
            {result.detail && <div className="font-mono text-xs text-signal-kill/80">{result.detail}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
