// ============================================================
// MARCOM / Lumi — GoalsPanel  (Phase 6A · north-star goals)
// ------------------------------------------------------------
// Lists the workspace's north-star goals and (STRATEGIST only) creates one.
// Each goal shows its target (metric + comparator + value), period, and its
// PERSISTED status badge. The status is the stored GoalStatus — the goal-tracker
// landing ESTIMATE runs only for plan-attached goals (on the Plan surface), so
// a standalone goal here states its stored status, never a fabricated landing.
//
// HONEST BY CONSTRUCTION (governing law):
//   • loading → skeleton; error → mapped message; empty → honest "create your
//     first goal" (never a placeholder row).
//   • create is STRATEGIST-only (canCreate); the server is the real arbiter.
// ============================================================
import { useState } from 'react';
import { Target, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { ROW } from '@/lib/rowIntegrity.js';

// blendedCac / blendedRoas / mer are the metrics the goal-tracker series
// supports (see PlanService.buildActualsSeries) — not free text.
const METRICS = [
  { value: 'blendedRoas', label: 'Blended ROAS' },
  { value: 'blendedCac',  label: 'Blended CAC' },
  { value: 'mer',         label: 'MER' },
];
const METRIC_LABEL = Object.fromEntries(METRICS.map((m) => [m.value, m.label]));

// Full 5-value GoalStatus tone map (engine emits 3; the row can also be
// ACHIEVED / MISSED once a period closes).
const statusTone = {
  ON_TRACK:  'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  ACHIEVED:  'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  AT_RISK:   'text-signal-hold bg-signal-hold-bg border-signal-hold/25',
  OFF_TRACK: 'text-signal-kill bg-signal-kill-bg border-signal-kill/25',
  MISSED:    'text-signal-kill bg-signal-kill-bg border-signal-kill/25',
};
const CMP_SYMBOL = { GT: '>', GTE: '≥', LT: '<', LTE: '≤' };

const fmtDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function Section({ children }) {
  return (
    <section className="mt-10">
      <div className="section-label flex items-center gap-1.5">
        <Target className="w-3.5 h-3.5" strokeWidth={1.5} /> North-Star Goals
      </div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        The metric targets every decision is measured against. Plan-attached goals get a live landing estimate on the Plan surface.
      </p>
      {children}
    </section>
  );
}

// ── Create form (STRATEGIST only) ───────────────────────────────
function GoalForm({ currency, onCreate, creating }) {
  const [name, setName] = useState('');
  const [metric, setMetric] = useState('blendedRoas');
  const [comparator, setComparator] = useState('GTE');
  const [target, setTarget] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const targetNum = parseFloat(target);
  const valid =
    Number.isFinite(targetNum) && !!start && !!end && new Date(end) > new Date(start);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || creating) return;
    const created = await onCreate({
      name: name.trim() || undefined,
      metric,
      comparator,
      targetValue: targetNum,
      periodStart: start,
      periodEnd: end,
      currency,
    });
    if (created) {
      setName(''); setTarget(''); setStart(''); setEnd('');
    }
  };

  const field = 'w-full rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2 text-sm text-lumi-text focus:border-lumi-accent/50 outline-none';
  return (
    <form onSubmit={submit} className="mt-4 rounded-2xl border border-lumi-border bg-lumi-elevated p-5 grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-lumi-muted sm:col-span-2">Goal name <span className="text-lumi-subtle">(optional)</span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 efficiency target" aria-label="Goal name" />
      </label>
      <label className="text-xs text-lumi-muted">Metric
        <select className={field} value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric">
          {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
      <label className="text-xs text-lumi-muted">Direction
        <select className={field} value={comparator} onChange={(e) => setComparator(e.target.value)} aria-label="Comparator">
          <option value="GTE">At least (≥)</option>
          <option value="LTE">At most (≤)</option>
        </select>
      </label>
      <label className="text-xs text-lumi-muted">Target value
        <input className={field} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 2.5" aria-label="Target value" />
      </label>
      <label className="text-xs text-lumi-muted">Currency
        <input className={cn(field, 'bg-lumi-elevated text-lumi-muted')} value={currency} readOnly aria-label="Currency" />
      </label>
      <label className="text-xs text-lumi-muted">Period start
        <input type="date" className={field} value={start} onChange={(e) => setStart(e.target.value)} aria-label="Period start" />
      </label>
      <label className="text-xs text-lumi-muted">Period end
        <input type="date" className={field} value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Period end" />
      </label>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button type="submit" disabled={!valid || creating}
          className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg hover:bg-lumi-gold disabled:opacity-40 disabled:cursor-not-allowed">
          {creating ? 'Creating…' : 'Create goal'}
        </button>
        <span className="text-xs text-lumi-subtle">Sets a target; it doesn’t move budget. Lumi tracks progress against it.</span>
      </div>
    </form>
  );
}

// ── Pure, prop-driven panel (unit-tested directly) ──────────────
export function GoalsPanel({
  goals = [], goalRows = null,
  loading = false, error = null, onCreate, creating = false, canCreate = false, currency = 'USD',
}) {
  // Tier 2b — render from the POSITIONAL rows when the hook supplies them, so a
  // row we could not read keeps its place instead of closing the gap. `goals`
  // remains the readable-only collection for anything that counts.
  const rows = goalRows ?? goals.map((g, index) => ({ state: ROW.READABLE, index, value: g }));
  if (loading) {
    return <Section><div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading goals…</div></Section>;
  }
  if (error) {
    return (
      <Section>
        <div className="rounded-2xl border border-signal-kill/25 bg-signal-kill-bg p-6 text-center text-sm text-signal-kill">
          <AlertCircle className="w-5 h-5 mx-auto mb-1.5" strokeWidth={1.5} /> Couldn’t load goals right now. Try again shortly.
        </div>
      </Section>
    );
  }

  return (
    <Section>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-8 text-center">
          <Target className="w-10 h-10 mx-auto text-lumi-subtle" strokeWidth={1.5} />
          <p className="mt-3 font-display text-lumi-text">No goals set yet.</p>
          <p className="mt-1 text-lumi-muted text-sm">
            {canCreate ? 'Create your first north-star goal below.' : 'A strategist can set the account’s north-star goals.'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-lumi-subtle border-b border-lumi-border">
                <th className="px-4 py-2.5 font-medium">Goal</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
                <th className="px-4 py-2.5 font-medium">Period</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (row.state === ROW.UNREADABLE ? (
                /* The ruled shape: A / UNREADABLE / C. Dropping this row would
                   make the table shorter than the truth while it claims to be
                   complete — a false absence. */
                <tr key={'unreadable-' + row.index} className="border-b border-lumi-border/60">
                  <td className="px-4 py-2.5 text-signal-kill" colSpan={4}>
                    This goal couldn’t be read.
                  </td>
                </tr>
              ) : (
                <tr key={row.value.id} className="border-b border-lumi-border/60">
                  <td className="px-4 py-2.5 text-lumi-text">{row.value.name}</td>
                  <td className="px-4 py-2.5 text-lumi-muted font-mono">
                    {METRIC_LABEL[row.value.metric] ?? row.value.metric} {CMP_SYMBOL[row.value.comparator] ?? row.value.comparator} {row.value.targetValue}
                  </td>
                  <td className="px-4 py-2.5 text-lumi-subtle font-mono text-xs">
                    {fmtDate(row.value.periodStart)} – {fmtDate(row.value.periodEnd)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn('font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border', statusTone[row.value.status] || statusTone.ON_TRACK)}>
                      {(row.value.status || 'ON_TRACK').replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create — STRATEGIST only. The server gate (requireStrategist) is the
          real arbiter; this just hides the affordance from a BUYER. */}
      {canCreate && <GoalForm currency={currency} onCreate={onCreate} creating={creating} />}
    </Section>
  );
}
