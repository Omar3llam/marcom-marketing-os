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
// ============================================================
import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { usePendingOutcomes } from '@/hooks/usePendingOutcomes.js';
import { useRecordOutcome } from '@/hooks/useRecordOutcome.js';
import { toMinor } from '@/lib/money.ts';
import { CardSkeleton } from '@/components/ui/Skeleton.jsx';

const field = 'w-full rounded-lg border border-lumi-border bg-lumi-surface px-2.5 py-1.5 text-sm text-lumi-text';

// ── One decision's outcome form (own local state) ───────────────
function OutcomeForm({ decision, currency, onSubmit, busy }) {
  const [spend, setSpend] = useState('');
  const [revenue, setRevenue] = useState('');
  const [roas, setRoas] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [sustained, setSustained] = useState(false);

  const ready = spend !== '' && revenue !== '' && roas !== '' && start !== '' && end !== ''
    && new Date(end) > new Date(start);

  const submit = () => {
    if (!ready) return;
    onSubmit(decision.id, {
      spendDeltaMinor: toMinor(Number(spend), currency),
      revenueDeltaMinor: toMinor(Number(revenue), currency),
      roasDelta: Number(roas),
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(end).toISOString(),
      sustained,
    });
  };

  return (
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
        <input type="date" className={field} value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="text-xs text-lumi-subtle">Window end
        <input type="date" className={field} value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={submit}
        className="col-span-2 rounded-lg bg-lumi-accent px-3 py-2 text-sm font-medium text-lumi-bg hover:bg-lumi-accent-hover disabled:opacity-40"
      >
        {busy ? 'Recording…' : 'Record what actually happened'}
      </button>
    </div>
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
        <p className="mt-3 text-xs text-signal-kill">Couldn&apos;t record that outcome — try again.</p>
      )}
    </div>
  );
}
