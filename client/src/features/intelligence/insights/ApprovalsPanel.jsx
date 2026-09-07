// ============================================================
// MARCOM / Lumi — ApprovalsPanel  (Phase 6B · STRATEGIST decision queue)
// ------------------------------------------------------------
// Lists plans awaiting a STRATEGIST sign-off and lets them Approve or Request
// revision. Governance, so:
//   • Approve is a TWO-CLICK confirm (no one-click governance action).
//   • "Request revision" (= REJECTED + reason) opens an inline form; the note is
//     REQUIRED — a reviewer must say what needs changing.
//   • honest states: loading skeleton, mapped error, empty "nothing awaiting you".
// Pure + prop-driven (unit-tested directly); the hook owns the API + toasts.
// Mounted STRATEGIST-only in InsightsView (the server is the real arbiter).
// ============================================================
import { useState } from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatCurrency } from '@/lib/money';

const fmtDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function Section({ children }) {
  return (
    <section className="mt-10">
      <div className="section-label flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.5} /> Plan Approvals
      </div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        Plans awaiting your sign-off. Approve to unblock promotion, or request a revision with a note.
      </p>
      {children}
    </section>
  );
}

// ── One approval row: plan context + Approve / Request-revision ─
function ApprovalRow({ approval, onDecide, deciding }) {
  const [confirming, setConfirming] = useState(false); // Approve → two-click
  const [revising, setRevising] = useState(false);
  const [reason, setReason] = useState('');

  const plan = approval.plan ?? null;
  const title = plan?.name ?? `${approval.subjectType} ${approval.subjectId.slice(0, 8)}`;
  const reasonValid = reason.trim().length > 0;

  const approve = () => {
    if (!confirming) { setConfirming(true); return; } // first click arms the confirm
    onDecide?.(approval.id, 'APPROVED');
    setConfirming(false);
  };
  const sendRevision = () => {
    if (!reasonValid) return;
    onDecide?.(approval.id, 'REJECTED', reason.trim());
    setRevising(false); setReason('');
  };

  return (
    <div className="border-b border-lumi-border/60 last:border-b-0 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0 text-sm text-lumi-text truncate">{title}</span>
        {plan && (
          <>
            <span className="font-mono text-xs text-lumi-subtle hidden sm:inline">{fmtDate(plan.periodStart)} – {fmtDate(plan.periodEnd)}</span>
            <span className="font-mono text-xs text-lumi-text">{formatCurrency(plan.totalBudgetMinor, plan.currency || 'USD')}</span>
          </>
        )}
      </div>
      <p className="mt-0.5 font-mono text-[11px] text-lumi-subtle">Requested {fmtDate(approval.createdAt)}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={deciding}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed',
            confirming
              ? 'bg-signal-scale text-lumi-bg hover:opacity-90'
              : 'bg-lumi-accent text-lumi-bg hover:bg-lumi-gold',
          )}
        >
          {deciding ? 'Saving…' : confirming ? 'Confirm approve' : 'Approve'}
        </button>
        {confirming && (
          <button type="button" onClick={() => setConfirming(false)} className="text-xs text-lumi-muted hover:text-lumi-text">Cancel</button>
        )}
        {!revising && (
          <button
            type="button"
            onClick={() => { setRevising(true); setConfirming(false); }}
            disabled={deciding}
            className="rounded-lg border border-lumi-border px-3 py-1.5 text-xs font-semibold text-lumi-text hover:border-signal-kill/50 disabled:opacity-40"
          >
            Request revision
          </button>
        )}
      </div>

      {revising && (
        <div className="mt-2 space-y-1.5">
          <label className="text-xs text-lumi-muted block">
            What needs changing? <span className="text-signal-kill">(required)</span>
            <textarea
              className="mt-1 w-full rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2 text-sm text-lumi-text focus:border-lumi-accent/50 outline-none"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Revision reason"
              placeholder="e.g. Budget is too aggressive for the period — trim 20% and re-submit."
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={sendRevision}
              disabled={!reasonValid || deciding}
              className="rounded-lg bg-signal-kill px-3 py-1.5 text-xs font-semibold text-lumi-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deciding ? 'Saving…' : 'Send revision request'}
            </button>
            <button type="button" onClick={() => { setRevising(false); setReason(''); }} className="text-xs text-lumi-muted hover:text-lumi-text">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pure, prop-driven panel ─────────────────────────────────────
export function ApprovalsPanel({ approvals = [], loading = false, error = null, onDecide, decidingId = null }) {
  if (loading) {
    return <Section><div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading approvals…</div></Section>;
  }
  if (error) {
    return (
      <Section>
        <div className="rounded-2xl border border-signal-kill/25 bg-signal-kill-bg p-6 text-center text-sm text-signal-kill">
          <AlertCircle className="w-5 h-5 mx-auto mb-1.5" strokeWidth={1.5} /> Couldn’t load approvals right now. Try again shortly.
        </div>
      </Section>
    );
  }

  return (
    <Section>
      {approvals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-8 text-center">
          <ShieldCheck className="w-10 h-10 mx-auto text-lumi-subtle" strokeWidth={1.5} />
          <p className="mt-3 font-display text-lumi-text">No plans awaiting your approval.</p>
          <p className="mt-1 text-lumi-muted text-sm">When someone submits a plan for sign-off, it shows up here.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
          {approvals.map((a) => (
            <ApprovalRow key={a.id} approval={a} onDecide={onDecide} deciding={decidingId === a.id} />
          ))}
        </div>
      )}
    </Section>
  );
}
