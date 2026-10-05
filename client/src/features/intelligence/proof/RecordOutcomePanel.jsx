// ============================================================
// MARCOM / Lumi — Record Outcome panel (Phase X · the WRITE path UI)
// ------------------------------------------------------------
// Closes the Proof loop by hand: lists EXECUTED decisions still missing an
// outcome and lets a BUYER/STRATEGIST record WHAT ACTUALLY HAPPENED. This is
// honest, operator-owned measurement — not "verify"/"confirm" (those imply Lumi
// already knows). Until a causal realized-metrics source is wired, this human
// entry is the Proof Engine's only real input. CLIENT never sees it.
//
// Money is entered in MAJOR units and converted to minor via toMinor(currency).
// A successful KILL legitimately reduces both spend and revenue → negatives are
// allowed. On success the just-recorded decision drops off the list and the
// parent refetches the accuracy surface.
//
// R6 (I19) — WHAT THIS FORM NOW ASKS FOR, AND WHAT IT DOES NOT
//   It captures `measuredAt`: WHEN the operator established these numbers, which
//   is not when they got round to typing them and not when the row is written.
//   Nothing here defaults it to today — a prefilled date is a value nobody
//   stated, and the whole point of the field is that it is the operator's fact.
//
//   It does NOT capture provenance. The evidence reference is projected on the
//   server from the rows Lumi actually holds for that entity over the measured
//   period; a browser cannot see those rows, so anything it sent would be a
//   claim about a database it has never read.
//
//   The numbers stay the operator's, and the copy says so. They are not
//   platform-measured and this form must never imply that they are.
//
// B5-01X' — WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
//   This header used to end "the panel therefore shows no evidence summary
//   before submitting — there is nothing honest to show yet." There is now:
//   OutcomeEvidence reports Lumi's own daily observations either side of the
//   intervention, over a comparison window the product defines rather than one
//   this form invents.
//
//   It is shown BESIDE the fields and fills none of them. No default is
//   prefilled from it, `sustained` is untouched, and nothing about it moves the
//   submit button — an operator who disagrees with what Lumi observed records
//   what they saw. Evidence is not an outcome, and this panel is still the only
//   place an outcome is authored.
// ============================================================
import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { usePendingOutcomes } from '@/hooks/usePendingOutcomes.js';
import { useRecordOutcome } from '@/hooks/useRecordOutcome.js';
import { toMinor } from '@/lib/money.ts';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';
import OutcomeEvidence from './OutcomeEvidence.jsx';

const field = 'w-full rounded-lg border border-lumi-border bg-lumi-surface px-2.5 py-1.5 text-sm text-lumi-text';

// ── One decision's outcome form (own local state) ───────────────
function OutcomeForm({ decision, currency, onSubmit, busy }) {
  const [spend, setSpend] = useState('');
  const [revenue, setRevenue] = useState('');
  const [roas, setRoas] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [measured, setMeasured] = useState('');
  const [sustained, setSustained] = useState(false);

  // The server owns these rules (it is the only clock that counts, and the only
  // thing that knows when the decision was executed). Mirroring the two the
  // operator can see keeps the common mistake out of a round trip; the server
  // still refuses the rest and says why.
  const today = new Date().toISOString().slice(0, 10);
  const executedDay = decision.executedAt ? String(decision.executedAt).slice(0, 10) : undefined;

  const ready = spend !== '' && revenue !== '' && roas !== '' && start !== '' && end !== ''
    && measured !== '' && new Date(end) > new Date(start);

  const submit = () => {
    if (!ready) return;
    onSubmit(decision.id, {
      spendDeltaMinor: toMinor(Number(spend), currency),
      revenueDeltaMinor: toMinor(Number(revenue), currency),
      roasDelta: Number(roas),
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(end).toISOString(),
      // WHEN it was measured — never `new Date()`. Substituting the clock here
      // would record the moment of typing as the moment of measurement, which is
      // the one thing this field exists to keep apart.
      measuredAt: new Date(measured).toISOString(),
      sustained,
    });
  };

  return (
    <>
      {/* Read-only, and above the fields on purpose: what Lumi observed is
          context for the operator's judgement, never a draft of it. */}
      <OutcomeEvidence decisionId={decision.id} />
      <div className="mt-3 grid grid-cols-2 gap-2.5">
      <label className="text-xs text-lumi-subtle">Spend change ({currency})
        <input type="number" className={field} value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="-4200" />
      </label>
      <label className="text-xs text-lumi-subtle">Revenue change ({currency})
        <input type="number" className={field} value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="18200" />
      </label>
      <label className="text-xs text-lumi-subtle">ROAS change
        <input type="number" step="0.1" className={field} value={roas} onChange={(e) => setRoas(e.target.value)} placeholder="1.8" />
      </label>
      <label className="flex items-center gap-2 text-xs text-lumi-subtle self-end pb-1.5">
        <input type="checkbox" checked={sustained} onChange={(e) => setSustained(e.target.checked)} />
        Result held (sustained)
      </label>
      <label className="text-xs text-lumi-subtle">Window start
        <input type="date" className={field} value={start} min={executedDay} max={today}
          onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="text-xs text-lumi-subtle">Window end
        <input type="date" className={field} value={end} max={today}
          onChange={(e) => setEnd(e.target.value)} />
      </label>
      <label className="col-span-2 text-xs text-lumi-subtle">Measured on
        <input type="date" className={field} value={measured} max={today}
          onChange={(e) => setMeasured(e.target.value)} />
        <span className="mt-1 block text-lumi-muted">
          When you read these numbers — not when you&apos;re typing them in.
        </span>
      </label>
      <p className="col-span-2 text-xs text-lumi-muted">
        These are your numbers. Lumi records them as reported and stores what it holds for this
        {' '}
        {String(decision.entityLevel ?? 'entity').toLowerCase()} over the window you gave.
      </p>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={submit}
        className="col-span-2 rounded-lg bg-lumi-accent px-3 py-2 text-sm font-medium text-lumi-bg hover:bg-lumi-gold disabled:opacity-40"
      >
        {busy ? 'Recording…' : 'Record what actually happened'}
      </button>
      </div>
    </>
  );
}

// ── The panel ───────────────────────────────────────────────────
export default function RecordOutcomePanel({ onRecorded }) {
  const { role } = useCollabRole();
  const { decisions, currency, loading, error, refetch } = usePendingOutcomes();
  const { record, recordingId, error: recordError } = useRecordOutcome();
  const [openId, setOpenId] = useState(null);

  // CLIENT never records outcomes — the route gate is the arbiter, this hides it.
  if (role === WORKSPACE_ROLE.CLIENT) return null;
  if (loading) return <CardSkeleton />;
  // Honest-empty: nothing awaiting an outcome (or no read access) → render nothing.
  if (error || decisions.length === 0) return null;

  const handle = async (decisionId, body) => {
    const ok = await record(decisionId, body);
    if (ok) {
      setOpenId(null);
      refetch();
      onRecorded?.();
    }
  };

  return (
    <div className="rounded-2xl border border-lumi-border bg-lumi-surface p-5">
      <div className="flex items-center gap-2.5 mb-1">
        <ClipboardCheck className="w-4 h-4 text-lumi-accent" strokeWidth={1.5} />
        <h2 className="text-sm font-medium text-lumi-text">Close the loop</h2>
      </div>
      <p className="text-xs text-lumi-muted mb-4">
        {decisions.length} executed {decisions.length === 1 ? 'decision is' : 'decisions are'} waiting on a recorded
        outcome. Recording what actually happened is what lets the Proof Engine measure Lumi&apos;s calibration.
      </p>

      <div className="space-y-2">
        {decisions.map((d) => (
          <div key={d.id} className="rounded-xl border border-lumi-border/60 bg-lumi-elevated p-3">
            <button
              type="button"
              onClick={() => setOpenId(openId === d.id ? null : d.id)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-sm text-lumi-text">
                <span className="font-mono text-lumi-accent">{d.verdict}</span> · {d.diagnosis}
              </span>
              <span className="text-xs text-lumi-subtle">{openId === d.id ? 'Close' : 'Record'}</span>
            </button>
            {openId === d.id && (
              <OutcomeForm decision={d} currency={currency} onSubmit={handle} busy={recordingId === d.id} />
            )}
          </div>
        ))}
      </div>

      {recordError && (
        // A 422 is the one refusal the operator can act on — an impossible
        // window, a measurement dated in the future — so it is quoted verbatim
        // rather than flattened into "try again", which would send them to retry
        // the same rejected dates. Everything else keeps the generic line.
        <p className="mt-3 text-xs text-signal-kill">
          {(recordError.response?.status === 422 && recordError.response?.data?.message)
            || 'Couldn’t record that outcome — try again.'}
        </p>
      )}
    </div>
  );
}
