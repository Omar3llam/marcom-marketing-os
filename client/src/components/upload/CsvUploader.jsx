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
        headers: { 'Content-Type': 'multipart/form-data' },
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
          { description: 'AI analysis complete — rendering dashboard' },
        );
      } else {
        const campaignCount = res.data.campaign_ids?.length || 0;
        toast.success(
          `Processed ${res.data.processed} of ${res.data.uploaded} rows · ${campaignCount} campaign${campaignCount === 1 ? '' : 's'} created.`,
        );
      }

      onSuccess?.(res.data);
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
          dragOver ? 'border-blue-500/60 bg-blue-500/5' : 'border-gray-700 bg-gray-900/40 hover:border-gray-600',
          compact && 'p-5',
        )}
      >
        <CloudUpload className={cn('mx-auto mb-3 text-gray-400', compact ? 'h-6 w-6' : 'h-10 w-10')} />
        <p className="text-sm font-medium text-white">
          Drag &amp; drop a CSV here, or click to choose
        </p>
        <p className="mt-1 text-xs text-gray-500">
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
        <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/60 p-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="h-4 w-4 shrink-0 text-blue-400" />
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{file.name}</div>
              <div className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUpload}
              disabled={busy}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold',
                'bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed',
              )}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? `Uploading ${progress}%` : 'Upload'}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              aria-label="Remove"
              className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {busy && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-gray-800">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Result panel */}
      {result && !result.error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
          <div className="text-green-200">
            <div className="font-semibold">Upload complete</div>
            <div className="text-xs text-green-300/80">
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
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div className="text-red-200">
            <div className="font-semibold">{result.error}</div>
            {result.detail && <div className="text-xs text-red-300/80">{result.detail}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
