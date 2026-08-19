// ============================================================
// MARCOM / Lumi — DecisionJudgment (R13-b)
// ------------------------------------------------------------
// "What did you decide?" — the question that turns a recommendation into a
// record of human reasoning. DecisionLifecycle beside it asks what HAPPENED on
// the ad platform; this asks what the operator THOUGHT of the call. Two axes,
// never merged: a buyer can override a KILL and take no action at all, and both
// halves of that are true.
//
// ── NOTHING HERE EXECUTES ───────────────────────────────────────────────────
// CONFIRM means "I agree with this call", not "do it". OVERRIDE means "I
// disagree", not "do the opposite". The verdict is never rewritten, the status
// never changes, and no platform action follows. The copy has to carry that,
// because a button labelled Confirm beside a KILL reads as an instruction if
// nothing says otherwise.
//
// ── ONE-WAY, LIKE ITS SIBLING ───────────────────────────────────────────────
// The server is first-write-wins. So a recorded judgement REPLACES the controls
// rather than disabling them, and there is deliberately no Edit, Change or
// Reset: offering an affordance the record refuses teaches people the record is
// negotiable. It is not.
//
// PURE RENDERER: no hook, no request, no knowledge of which route the write
// takes. The host owns useDecisionJudgment and merges the server's answer over
// the persisted one; this owns what the states look like.
// ============================================================
import { useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  HUMAN_RESPONSE, RESPONSE_LABEL, JUDGMENT_REASONS,
  MAX_NOTE_LENGTH, needsReason, reasonLabel,
} from './judgmentVocabulary.js';

const Label = ({ children }) => (
  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-lumi-muted">{children}</p>
);

/** Compact, and never a fabricated time: an unparseable stamp renders nothing. */
function recordedAt(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

/** The recorded judgement. Terminal by construction — it renders no controls. */
function RecordedJudgment({ judgment }) {
  const when = recordedAt(judgment.humanRespondedAt);
  return (
    <>
      <Label>Your decision</Label>
      <p className="font-mono text-xs font-semibold text-lumi-text">
        {RESPONSE_LABEL[judgment.humanResponse] ?? judgment.humanResponse}
      </p>
      {/* CONFIRM carries no reason and must not be given one — a blank line
          here would read as a reason we failed to load. */}
      {judgment.humanReasonCode && (
        <p className="mt-0.5 text-[11px] text-lumi-muted">{reasonLabel(judgment.humanReasonCode)}</p>
      )}
      {judgment.humanReasonNote && (
        <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-lumi-subtle">
          {judgment.humanReasonNote}
        </p>
      )}
      {/* No actor. R13 stores no user, and naming the current session would
          attribute a judgement to whoever happens to be looking at it. */}
      {when && <p className="mt-1.5 font-mono text-[10px] text-lumi-muted">Recorded {when}</p>}
    </>
  );
}

/**
 * @param {object} props
 * @param {?string} props.decisionId — null renders NOTHING. A campaign no sweep
 *   has written a Decision for has no row to judge, and the by-entity guess the
 *   lifecycle can afford would attach reasoning to a call nobody was shown.
 * @param {?object} props.judgment — the judgement ON RECORD:
 *   { humanResponse, humanReasonCode, humanReasonNote, humanRespondedAt }.
 *   The host merges the server's live answer over the persisted read, so this
 *   is always the database's version and never the operator's draft.
 * @param {?string} props.state — null | 'saving' | 'recorded' | 'conflict'
 *   | 'superseded' | 'unavailable' | 'denied' | 'invalid' | 'error'
 * @param {?string} props.message — the server's own validation text ('invalid')
 * @param {?Function} props.onSubmit — ({response, reasonCode, reasonNote}) => void.
 *   null makes the block READ-ONLY: a seat that may not record must not be asked.
 * @param {string} [props.className]
 */
export function DecisionJudgment({
  decisionId = null, judgment = null, state = null, message = null,
  onSubmit = null, className = 'mt-3 border-t border-lumi-border/60 pt-3',
}) {
  // Which answer is waiting on a reason. Local because it is a half-finished
  // form and nothing outside this component should ever see one.
  const [pending, setPending] = useState(null);
  const [reasonCode, setReasonCode] = useState(null);
  const [note, setNote] = useState('');

  if (!decisionId) return null;

  const saving = state === 'saving';
  const conflict = state === 'conflict';

  const reset = () => { setPending(null); setReasonCode(null); setNote(''); };

  const answer = (response) => {
    if (saving) return;
    if (needsReason(response)) { setPending(response); return; }
    onSubmit?.({ response });
  };

  const commit = () => {
    if (!pending || !reasonCode || saving) return;
    onSubmit?.({ response: pending, reasonCode, reasonNote: note });
    reset();
  };

  // ── Read-only: the judgement, or an honest absence ────────────────────────
  // "No judgment recorded yet" is a statement about this decision. "0 judgments"
  // would be a metric, and there is no query behind it.
  if (!onSubmit) {
    return (
      <div className={className}>
        {judgment
          ? <RecordedJudgment judgment={judgment} />
          : <p className="font-mono text-[11px] text-lumi-subtle">No judgment recorded yet</p>}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* The record wins over everything below it. Once a judgement exists —
          from this session or from a previous one — the question is answered
          and the controls are gone. */}
      {judgment ? (
        <>
          {conflict && (
            <p className="mb-2 flex items-start gap-1.5 font-mono text-[11px] text-lumi-subtle">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" strokeWidth={2} />
              A judgment was already recorded for this decision — showing what is on record.
            </p>
          )}
          {state === 'recorded' && (
            <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] text-signal-scale">
              <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> Recorded
            </p>
          )}
          <RecordedJudgment judgment={judgment} />
        </>
      ) : saving ? (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> Recording…
        </p>
      ) : state === 'superseded' ? (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
          This verdict was replaced — refresh to judge the current one
        </p>
      ) : state === 'unavailable' ? (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
          This decision is no longer available — refresh to see the current one
        </p>
      ) : state === 'denied' ? (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
          You do not have permission to record this judgment
        </p>
      ) : state === 'invalid' ? (
        <p className="flex items-start gap-1.5 font-mono text-[11px] text-trend-danger">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" strokeWidth={2} />
          {message || 'That judgment was not accepted — check the reason and try again'}
        </p>
      ) : state === 'error' ? (
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-trend-danger">
          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
          Couldn&apos;t record your judgment — refresh and try again
        </p>
      ) : pending ? (
        // ── The reason step ──────────────────────────────────────────────────
        // Structured first, prose second. The code is what a later slice can
        // count; the note is context for a human reading one row.
        <>
          <Label>
            {pending === HUMAN_RESPONSE.OVERRIDE
              ? 'Why are you overriding this?'
              : 'Why are you adjusting this?'}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {JUDGMENT_REASONS.map((r) => (
              <button
                key={r.code}
                type="button"
                aria-pressed={reasonCode === r.code}
                onClick={() => setReasonCode(r.code)}
                className={
                  reasonCode === r.code
                    ? 'rounded-lg border border-lumi-accent bg-lumi-elevated px-2.5 py-1 text-[11px] font-medium text-lumi-text'
                    : 'rounded-lg border border-lumi-border px-2.5 py-1 text-[11px] text-lumi-subtle transition-colors hover:text-lumi-text'
                }
              >
                {r.label}
              </button>
            ))}
          </div>

          <label className="mt-2 block">
            <span className="sr-only">Optional note</span>
            <textarea
              value={note}
              rows={2}
              maxLength={MAX_NOTE_LENGTH}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note"
              className="w-full rounded-lg border border-lumi-border bg-transparent px-2.5 py-1.5 text-[11px] text-lumi-text placeholder:text-lumi-subtle focus:border-lumi-accent focus:outline-none"
            />
          </label>
          <p className="mt-0.5 text-right font-mono text-[10px] text-lumi-muted">
            {note.length} / {MAX_NOTE_LENGTH}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={commit}
              disabled={!reasonCode}
              className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Record {RESPONSE_LABEL[pending]}
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-[11px] text-lumi-subtle transition-colors hover:text-lumi-text"
            >
              Cancel
            </button>
            {/* Says WHY the picker will not submit yet, instead of leaving a
                disabled button to explain itself. */}
            {!reasonCode && (
              <span className="font-mono text-[10px] text-lumi-muted">Pick a reason to record this</span>
            )}
          </div>
        </>
      ) : (
        // ── The question ─────────────────────────────────────────────────────
        <>
          <Label>What did you decide?</Label>
          <div className="flex flex-wrap gap-2">
            {[HUMAN_RESPONSE.CONFIRM, HUMAN_RESPONSE.OVERRIDE, HUMAN_RESPONSE.ADJUST].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => answer(r)}
                className="rounded-lg border border-lumi-border px-3 py-1.5 text-xs text-lumi-subtle transition-colors hover:text-lumi-text"
              >
                {RESPONSE_LABEL[r]}
              </button>
            ))}
          </div>
          {/* Without this the three buttons read as instructions to Lumi. They
              are not: nothing here changes the verdict or touches the account. */}
          <p className="mt-2 text-[11px] leading-relaxed text-lumi-muted">
            Your judgment is recorded beside Lumi&apos;s call — it changes nothing in your ad account.
          </p>
        </>
      )}
    </div>
  );
}
