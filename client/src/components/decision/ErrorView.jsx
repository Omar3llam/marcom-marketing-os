// ============================================================
// MARCOM / Lumi — ErrorView (FSM state E)
// ------------------------------------------------------------
// Context-aware error card with retry. Hint copy varies by code
// so the user knows whether to refresh, wait, retry, or report.
// ============================================================
import { AlertTriangle, RotateCcw, ArrowLeft } from 'lucide-react';
import { DecisionTitle } from '@/components/primitives';

const HINTS = {
  '401': 'Your session has expired. Please log in again.',
  '403': 'You do not have access to this workspace. Switch projects from the sidebar.',
  '413': 'File too large. Compress your CSV or split by date range.',
  '422': 'The data could not be parsed. Check your CSV columns and re-export.',
  '429': 'Rate limit reached. Wait 60 seconds before retrying.',
  '500': 'Lumi\'s analysis backend hit an error. Try again — if it persists, the live deploy logs will surface the cause.',
  '502': 'The AI provider returned an unparseable response. Click retry — usually self-heals.',
  '503': 'A backing service (database or queue) is unreachable. Check Render env vars.',
  'NETWORK_ERROR':    'Check your connection and try again.',
  'SCHEMA_VIOLATION': 'Unexpected response format. The team has been notified — try again in a moment.',
};

const DEFAULT_HINT = 'The analysis could not complete. Try again or start fresh.';

export default function ErrorView({ error, onRetry, onBack }) {
  const hint = HINTS[error?.code] || DEFAULT_HINT;
  const retryable = error?.retryable !== false;
  const classification = error?.classification;
  const fallbackAction = error?.fallbackAction;

  return (
    <div className="max-w-md mx-auto p-8 flex flex-col items-center animate-fade-in">
      <div className="w-full bg-lumi-surface border border-trend-danger/30 rounded-2xl overflow-hidden">
        <div className="card-accent card-accent-error" aria-hidden="true" />
        <div className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 mx-auto text-trend-danger" strokeWidth={1.5} />
          <DecisionTitle as="h2" className="mt-4 text-lumi-text">Analysis failed</DecisionTitle>

          <div className="mt-3 font-mono text-sm text-trend-danger bg-signal-kill-bg border border-signal-kill/20 px-3 py-2 rounded-lg break-words">
            {error?.message || 'Unknown error'}
          </div>

          {error?.code && (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs">
              <span className="font-mono text-lumi-subtle">Code · {error.code}</span>
              {classification && (
                <>
                  <span className="text-lumi-border">|</span>
                  <span className="font-mono text-lumi-subtle capitalize">{classification}</span>
                </>
              )}
            </div>
          )}

          <p className="mt-4 text-sm text-lumi-muted leading-relaxed max-w-xs mx-auto">{hint}</p>

          {fallbackAction && (
            <div className="mt-3 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 rounded-lg">
              💡 Fallback: {fallbackAction}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2">
            {retryable && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 bg-lumi-accent text-lumi-bg font-display font-semibold hover:bg-lumi-accent-hover shadow-accent-glow"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} /> Retry analysis
              </button>
            )}
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center justify-center gap-1 text-sm text-lumi-muted hover:text-lumi-text px-3 py-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} /> Back to Command Center
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
