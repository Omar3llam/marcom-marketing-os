// ============================================================
// MARCOM / Lumi — DecisionLifecycle
// ------------------------------------------------------------
// "Did you act on this?" — the only way a verdict ever becomes a scored
// prediction. Everything around it is the product talking; this is the product
// listening.
//
// ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────────
// It has two mount points now: the decision surface (ActionBar, on the expanded
// campaign row) and the ad-set execution context (ExecutionContext, still used
// by Overview's DecisionCard). Six states, five sentences and one one-way rule
// rendered from two copies would drift — and the drift would land on the one
// write in the product whose entire purpose is to be believed. Lifted verbatim
// out of ExecutionContext rather than rewritten, so the wording, the treatment
// and the terminal-state semantics are the SAME ones, not a second opinion.
//
// ONE-WAY. Every terminal state REPLACES the buttons rather than disabling
// them: a clickable-looking control that has already been answered invites a
// second click, and a second click on a recorded claim is not a second claim.
// `stale` and the two error branches are terminal for the same reason — none of
// them get better by retrying the same request.
//
// PURE RENDERER: no hook, no request, no knowledge of decisionId or of which
// route the write will take. The caller owns useDecisionAction; this owns what
// the six answers look like.
// ============================================================
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

const Label = ({ children }) => (
  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-lumi-muted">{children}</p>
);

/**
 * @param {object} props
 * @param {?Function} props.onExecute — null renders nothing at all: a surface
 *   that cannot record an answer must not ask for one.
 * @param {?Function} props.onDismiss
 * @param {?string} props.executionState — null | 'executing' | 'executed'
 *   | 'dismissing' | 'dismissed' | 'stale' | 'error'
 * @param {string} [props.className] — the separator the host wants above it.
 */
export function DecisionLifecycle({
  onExecute = null, onDismiss = null, executionState = null,
  className = 'mt-3 border-t border-lumi-border pt-3',
}) {
  if (!onExecute || !onDismiss) return null;

  return (
    <div className={className}>
      {executionState === null && (
        <>
          <Label>Did you act on this?</Label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onExecute}
              className="rounded-lg bg-signal-kill px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              I executed this
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-lumi-border px-3 py-1.5 text-xs text-lumi-subtle transition-colors hover:text-lumi-text"
            >
              Not applicable
            </button>
          </div>
          {/* Says what the answer is FOR. Without it the pair reads as a
              satisfaction survey, and "Not applicable" looks like a way to hide
              the row rather than a recorded judgement. */}
          <p className="mt-2 text-[11px] leading-relaxed text-lumi-muted">
            Either answer is recorded — it is how Lumi learns whether its calls were right.
          </p>
        </>
      )}

      {(executionState === 'executing' || executionState === 'dismissing') && (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> Recording…
        </p>
      )}

      {executionState === 'executed' && (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-signal-scale">
          <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> Recorded as executed
        </p>
      )}

      {executionState === 'dismissed' && (
        <p className="font-mono text-[11px] text-lumi-subtle">Recorded as not applicable</p>
      )}

      {/* The verdict was replaced between render and click. Not a failure and
          not retryable — the call they answered no longer exists, and saying
          "try again" would send them at a request that 404s forever. */}
      {executionState === 'stale' && (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
          <AlertTriangle className="h-3 w-3" strokeWidth={2} /> This verdict was replaced — refresh to see the current one
        </p>
      )}

      {executionState === 'error' && (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-trend-danger">
          <AlertTriangle className="h-3 w-3" strokeWidth={2} /> Couldn&apos;t record — refresh and try again
        </p>
      )}
    </div>
  );
}
