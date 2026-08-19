// ============================================================
// MARCOM / Lumi — LumiExecute
// ------------------------------------------------------------
// "Lumi, pause this campaign." The control that performs a REAL platform
// mutation, and the reason it is a separate component from DecisionLifecycle
// rather than a third button inside it.
//
// DecisionLifecycle asks "did you act on this?" — it records a claim. This asks
// Lumi to act. One writes a timestamp; the other changes a customer's live ad
// account. They sit next to each other on the same panel, and the only thing
// keeping them apart in an operator's head is that they look and read like two
// different things. So they are two different things.
//
// PURE RENDERER. No hook, no request, no knowledge of endpoints. The caller owns
// useLumiExecution; this owns what the states look like and what the refusals
// say. Mirrors DecisionLifecycle's own contract deliberately — same shape, so a
// reader comparing them sees the semantic difference rather than a structural one.
//
// NEVER RENDERS SUCCESS FROM A SUBMIT. QUEUED and EXECUTING are shown as what
// they are: accepted, not finished. "Paused on Meta" appears only for
// EXECUTED_SUCCESS, which is worker-written after the platform accepted it.
// ============================================================
import { Loader2, CheckCircle2, AlertTriangle, Zap } from 'lucide-react';
import { EXEC_STATE } from './useLumiExecution.js';

const REQUEST_FAILED_FALLBACK = "Lumi couldn't start this action.";

const Label = ({ children }) => (
  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-lumi-muted">{children}</p>
);

const Line = ({ tone = 'muted', icon: Icon = null, spin = false, children }) => (
  <p className={`flex items-center gap-2 text-xs ${
    tone === 'good' ? 'text-trend-positive'
      : tone === 'bad' ? 'text-trend-danger'
        : tone === 'warn' ? 'text-trend-warning' : 'text-lumi-subtle'}`}
  >
    {Icon ? <Icon className={`h-3.5 w-3.5 shrink-0 ${spin ? 'animate-spin' : ''}`} /> : null}
    <span>{children}</span>
  </p>
);

/**
 * What each refusal actually means. Every one is a real, distinct answer — none
 * of them is "something went wrong, try again", which is what an operator hears
 * when a surface has not bothered to tell them apart.
 */
const REJECTION_COPY = Object.freeze({
  // The one refusal that must never be worked around. Falling back to matching
  // the campaign by name is exactly the attribution rot the identity contract
  // exists to prevent.
  ATTRIBUTION_UNRESOLVED: "This decision couldn't be linked to an executable request. Refresh and try again.",
  ALREADY_QUEUED: 'This decision already has an execution in progress.',
  NOT_PERMITTED:  'Your role cannot run platform actions.',
  NOT_AUTHENTICATED: 'Your session expired. Sign in again.',
  BUSY:  'The execution queue is full right now. Try again shortly.',
  INVALID_REQUEST: "Lumi couldn't build a valid action for this campaign.",
  REQUEST_FAILED: "Lumi couldn't reach the execution service.",
});

/** Human names for the actions this surface can offer. */
const ACTION_COPY = Object.freeze({
  PAUSE_CAMPAIGN: 'Pause this campaign on Meta',
  PAUSE_ADSET:    'Pause this ad set on Meta',
  RESUME_CAMPAIGN: 'Resume this campaign on Meta',
  RESUME_ADSET:   'Resume this ad set on Meta',
});

/**
 * Why Lumi is not offering to act. Rendered only when it says something the
 * operator can use — a HOLD needs no explanation for the absence of a button.
 */
const UNSUPPORTED_COPY = Object.freeze({
  NEEDS_OPERATOR_INPUT: 'Lumi can’t run this one for you yet — it needs a budget or creative you choose.',
  UNSUPPORTED_CHANNEL:  'Lumi can only run actions on Meta today.',
  NO_PLATFORM_ID:       'This campaign has no platform link yet, so there’s nothing for Lumi to act on.',
});

/**
 * @param {object} props
 * @param {object|null} props.execution — the SERVER's descriptor from the
 *   verdict payload: { supported, actionType, targetId, targetType, reason }.
 *   null renders nothing; the client never decides executability itself.
 * @param {?Function} props.onExecute — null renders nothing at all, the same
 *   rule DecisionLifecycle keeps: a surface that cannot act must not offer to.
 * @param {?string} props.state — an EXEC_STATE value, or null for READY.
 * @param {?string} props.rejection — a rejection reason key.
 * @param {string} [props.className]
 */
export function LumiExecute({
  execution = null, onExecute = null, state = null, rejection = null,
  className = 'mt-3 border-t border-lumi-border pt-3',
}) {
  if (!execution || !onExecute) return null;

  // Not executable. Say why only when the reason is actionable; stay silent for
  // NO_DECISION and NO_ACTION_FOR_VERDICT, where an explanation would be noise
  // about something the operator never asked for.
  if (!execution.supported) {
    const why = UNSUPPORTED_COPY[execution.reason];
    if (!why) return null;
    return (
      <div className={className}>
        <Line>{why}</Line>
      </div>
    );
  }

  const s = state ?? EXEC_STATE.READY;

  return (
    <div className={className}>
      {s === EXEC_STATE.READY && (
        <>
          <Label>Run this for me</Label>
          <button
            type="button"
            onClick={onExecute}
            className="flex items-center gap-2 rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-deep transition-opacity hover:opacity-90"
          >
            <Zap className="h-3.5 w-3.5" />
            {ACTION_COPY[execution.actionType] ?? 'Run this action on Meta'}
          </button>
          {/* Says what the button DOES, in the platform's terms. Without it,
              "Run this for me" sits next to "I executed this" and the two read
              as the same act with different phrasing. */}
          <p className="mt-1.5 text-[11px] text-lumi-muted">
            Lumi will make this change on your ad account.
          </p>
        </>
      )}

      {s === EXEC_STATE.SUBMITTING && (
        <Line icon={Loader2} spin>Sending to Meta…</Line>
      )}

      {/* QUEUED and EXECUTING are NOT success. The request exists; the platform
          has not confirmed anything yet, and the copy says exactly that. */}
      {s === EXEC_STATE.QUEUED && (
        <Line icon={Loader2} spin>Queued — Lumi hasn’t called Meta yet.</Line>
      )}
      {s === EXEC_STATE.EXECUTING && (
        <Line icon={Loader2} spin>Running on Meta…</Line>
      )}

      {s === EXEC_STATE.EXECUTED_SUCCESS && (
        <Line tone="good" icon={CheckCircle2}>Done — Meta confirmed this change.</Line>
      )}

      {s === EXEC_STATE.EXECUTED_FAILED && (
        <Line tone="bad" icon={AlertTriangle}>Meta refused this action. Nothing was changed.</Line>
      )}

      {s === EXEC_STATE.TIMED_OUT && (
        <Line tone="warn" icon={AlertTriangle}>This action timed out before Meta confirmed it.</Line>
      )}
      {s === EXEC_STATE.CANCELLED && (
        <Line tone="warn" icon={AlertTriangle}>This action was cancelled before it ran.</Line>
      )}

      {s === EXEC_STATE.REJECTED && (
        <Line tone="bad" icon={AlertTriangle}>
          {REJECTION_COPY[rejection] ?? REQUEST_FAILED_FALLBACK}
        </Line>
      )}
    </div>
  );
}
