// ============================================================
// MARCOM / Lumi — PlansPanel  (Phase 6A · forward-looking plans)
// ------------------------------------------------------------
// Lists plans, (STRATEGIST) builds one, expands to LIVE tracking, and promotes
// a plan's mix into PROPOSED REALLOCATE Decisions (which still require a human
// confirm in Decisions — promote never auto-executes).
//
// HONEST BY CONSTRUCTION (governing law):
//   • loading → skeleton; error → mapped; empty → honest "build your first plan".
//   • the goal-tracker landing is a RANGE {low–high, expected} — NEVER collapsed
//     to a single number — carried with its assumptions and % of period elapsed.
//   • no actuals yet → "not enough data to estimate a landing", not a fake range.
//   • create + promote are STRATEGIST-only; the server is the real arbiter.
// ============================================================
import { useState } from 'react';
import { ClipboardList, ChevronRight, ChevronDown, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatCurrency, toMinor } from '@/lib/money';
import { ROW } from '@/lib/rowIntegrity.js';
import { promotionCopyFor, isPromoted } from './promotionCopy.js';

const METRIC_LABEL = { blendedRoas: 'Blended ROAS', blendedCac: 'Blended CAC', mer: 'MER' };
const CMP_SYMBOL = { GT: '>', GTE: '≥', LT: '<', LTE: '≤' };

const planTone = {
  DRAFT:  'text-lumi-subtle bg-lumi-elevated border-lumi-border',
  ACTIVE: 'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  // C-18 gave CLOSED a writer. Until then this style existed for a state
  // nothing could reach: a plan whose period ended stayed ACTIVE forever.
  CLOSED: 'text-lumi-muted bg-lumi-elevated border-lumi-border',
};
const goalTone = {
  ON_TRACK:  'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  ACHIEVED:  'text-signal-scale bg-signal-scale-bg border-signal-scale/25',
  AT_RISK:   'text-signal-hold bg-signal-hold-bg border-signal-hold/25',
  OFF_TRACK: 'text-signal-kill bg-signal-kill-bg border-signal-kill/25',
  MISSED:    'text-signal-kill bg-signal-kill-bg border-signal-kill/25',
};
// Phase 6B — the approval gate's reflected state on a plan.
const approvalMeta = {
  PENDING:  { label: 'Awaiting approval',  tone: 'text-signal-hold bg-signal-hold-bg border-signal-hold/25' },
  APPROVED: { label: 'Approved',           tone: 'text-signal-scale bg-signal-scale-bg border-signal-scale/25' },
  REJECTED: { label: 'Revision requested', tone: 'text-signal-kill bg-signal-kill-bg border-signal-kill/25' },
};

const fmtDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function Section({ children }) {
  return (
    <section className="mt-10">
      <div className="section-label flex items-center gap-1.5">
        <ClipboardList className="w-3.5 h-3.5" strokeWidth={1.5} /> Plans
      </div>
      <p className="mt-1 text-lumi-muted text-sm mb-4">
        A budget + channel-mix + testing plan for a period. Expand to track its goals live; promote it to stage the moves as proposals.
      </p>
      {children}
    </section>
  );
}

// ── One goal's live landing (a RANGE, never a point) ────────────
function GoalLanding({ metric, landing }) {
  const label = METRIC_LABEL[metric] ?? metric;
  if (!landing) {
    return (
      <div className="text-xs text-lumi-subtle">
        {label} — not enough actuals to estimate a landing yet.
      </div>
    );
  }
  const { low, expected, high } = landing.trendBasedLandingEstimate ?? {};
  const t = landing.target ?? {};
  return (
    <div className="rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-lumi-text">
          {label} target {CMP_SYMBOL[t.comparator] ?? t.comparator} {t.targetValue}
        </span>
        <span className={cn('font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border', goalTone[landing.status] || goalTone.ON_TRACK)}>
          {(landing.status || 'ON_TRACK').replace('_', ' ')}
        </span>
        {landing.pctOfPeriodElapsed != null && (
          <span className="font-mono text-[10px] text-lumi-subtle">{Math.round(landing.pctOfPeriodElapsed * 100)}% of period elapsed</span>
        )}
      </div>
      <p className="mt-1 font-mono text-xs text-lumi-muted">
        Trend-based landing estimate:{' '}
        <span className="text-lumi-text">{low}–{high}</span>{' '}
        <span className="text-lumi-subtle">(expected {expected})</span>
      </p>
      {landing.leadingRisk && (
        <p className="mt-1 text-[11px] text-signal-hold">A leading signal projects a breach before period end — flagged early.</p>
      )}
      {Array.isArray(landing.assumptions) && landing.assumptions.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {landing.assumptions.map((a, i) => <li key={i} className="text-[11px] text-lumi-subtle">• {a}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── Approval gate (Phase 6B) — submit / status / reviewer's note ─
// State comes from the plan row (immediate); the reviewer's note (on REJECTED)
// comes from the lazily-loaded detail. Backend is the real arbiter — these are
// affordances, not the security boundary.
function ApprovalControls({ plan, detail, canSubmit, onSubmit, submitting }) {
  const state = plan?.approvalState ?? null;
  const reason = detail?.latestApproval?.reason ?? null;

  if (state === 'PENDING') {
    return <p className="text-xs text-signal-hold">Awaiting STRATEGIST approval — promotion is blocked until it’s approved.</p>;
  }
  if (state === 'APPROVED') {
    return <p className="text-xs text-signal-scale">Approved — this plan can be promoted.</p>;
  }
  if (state === 'REJECTED') {
    return (
      <div className="text-xs text-signal-kill">
        <span>Revision requested{reason ? `: ${reason}` : '.'}</span>
        {canSubmit && (
          <button type="button" onClick={() => onSubmit?.(plan.id)} disabled={submitting}
            className="ml-2 underline hover:no-underline disabled:opacity-40">
            {submitting ? 'Resubmitting…' : 'Resubmit for approval'}
          </button>
        )}
      </div>
    );
  }
  if (canSubmit) {
    return (
      <button type="button" onClick={() => onSubmit?.(plan.id)} disabled={submitting}
        className="rounded-lg border border-lumi-border px-3 py-1.5 text-xs font-semibold text-lumi-text hover:border-lumi-accent/50 disabled:opacity-40 disabled:cursor-not-allowed">
        {submitting ? 'Submitting…' : 'Submit for approval'}
      </button>
    );
  }
  return null;
}

// ── Expanded plan detail (lazy-loaded live tracking) ────────────
function PlanDetail({ plan, detail, loading, canManage, canSubmit, onSubmit, submitting, onPromote, promoting, promoteResult }) {
  if (loading) return <div className="px-4 py-3 text-xs text-lumi-subtle">Loading live tracking…</div>;
  if (!detail) return <div className="px-4 py-3 text-xs text-signal-kill">Couldn’t load this plan’s tracking right now.</div>;

  const tracked = detail.tracking?.goals ?? [];
  const gateBlocks = plan?.requiresApproval === true && plan?.approvalState !== 'APPROVED';
  // C-18 — a promotion with no budget moves writes no AllocationPlan, so the id
  // is null on a plan that IS promoted. Guarding on it would re-arm the button.
  const promoted = isPromoted(detail);
  const promotionCopy = promotionCopyFor(promoteResult);
  return (
    <div className="px-4 py-3 border-t border-lumi-border bg-lumi-elevated/40 space-y-2">
      {tracked.length === 0 ? (
        <p className="text-xs text-lumi-subtle">No goal attached to this plan — nothing to track yet.</p>
      ) : (
        tracked.map((g) => <GoalLanding key={g.goalId} metric={g.metric} landing={g.landing} />)
      )}

      {/* Approval gate — governance precedes execution. */}
      <div className="pt-1">
        <ApprovalControls plan={plan} detail={detail} canSubmit={canSubmit} onSubmit={onSubmit} submitting={submitting} />
      </div>

      {canManage && (
        <div className="pt-1">
          <button
            type="button"
            disabled={promoting || promoted || gateBlocks}
            onClick={() => onPromote?.(detail.id)}
            className="rounded-lg bg-lumi-accent px-3 py-1.5 text-xs font-semibold text-lumi-bg hover:bg-lumi-gold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {promoted ? 'Already promoted' : promoting ? 'Promoting…' : 'Promote mix → proposals'}
          </button>
          {gateBlocks && (
            <p className="mt-1 text-[11px] text-signal-hold">Blocked until approved — submit it for STRATEGIST review first.</p>
          )}
          {promotionCopy && (
            <p className={cn('mt-1.5 text-xs', promotionCopy.tone === 'success' ? 'text-signal-scale' : 'text-lumi-muted')}>
              {promotionCopy.message}
            </p>
          )}
          <p className="mt-1 text-[11px] text-lumi-subtle">Promote stages PROPOSED moves only — Lumi never moves budget without a human confirm.</p>
        </div>
      )}
    </div>
  );
}

// ── Create form (STRATEGIST only) ───────────────────────────────
function PlanForm({ currency, onCreate, creating }) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const budgetMajor = Number(budget);
  const valid = Number.isFinite(budgetMajor) && budgetMajor > 0 && !!start && !!end && new Date(end) > new Date(start);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || creating) return;
    const created = await onCreate({
      name: name.trim() || undefined,
      totalBudgetMinor: toMinor(budgetMajor, currency),
      periodStart: start,
      periodEnd: end,
      currency,
    });
    if (created) { setName(''); setBudget(''); setStart(''); setEnd(''); }
  };

  const field = 'w-full rounded-lg border border-lumi-border bg-lumi-surface px-3 py-2 text-sm text-lumi-text focus:border-lumi-accent/50 outline-none';
  return (
    <form onSubmit={submit} className="mt-4 rounded-2xl border border-lumi-border bg-lumi-elevated p-5 grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-lumi-muted sm:col-span-2">Plan name <span className="text-lumi-subtle">(optional)</span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 growth plan" aria-label="Plan name" />
      </label>
      <label className="text-xs text-lumi-muted">Monthly budget ({currency})
        <input className={field} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 50000" aria-label="Total budget" />
      </label>
      <label className="text-xs text-lumi-muted">Currency
        <input className={cn(field, 'text-lumi-muted')} value={currency} readOnly aria-label="Currency" />
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
          {creating ? 'Building…' : 'Build plan'}
        </button>
        <span className="text-xs text-lumi-subtle">Assembles a channel mix + testing agenda from your real data. It doesn’t move budget until you promote it.</span>
      </div>
    </form>
  );
}

// ── Pure-ish, prop-driven panel (own expand/detail state) ───────
export function PlansPanel({
  plans = [], planRows = null, loading = false, error = null,
  onCreate, creating = false, canManage = false, currency = 'USD',
  getPlanDetail, onPromote, promotingId = null,
  canSubmit = false, onSubmit, submittingId = null,
}) {
  const [expandedId, setExpandedId] = useState(null);
  // Tier 2b — render from the POSITIONAL rows when the hook supplies them.
  // `plans` stays the readable-only collection for anything that counts.
  const rows = planRows ?? plans.map((p, index) => ({ state: ROW.READABLE, index, value: p }));
  const [details, setDetails] = useState({});       // id → plan-with-tracking
  const [detailLoadingId, setDetailLoadingId] = useState(null);
  const [promoteResults, setPromoteResults] = useState({}); // id → { decisionsCreated }

  const toggle = async (id) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!details[id] && getPlanDetail) {
      setDetailLoadingId(id);
      const d = await getPlanDetail(id);
      setDetails((prev) => ({ ...prev, [id]: d }));
      setDetailLoadingId(null);
    }
  };

  const promote = async (id) => {
    const result = await onPromote?.(id);
    if (result) {
      setPromoteResults((prev) => ({ ...prev, [id]: result }));
      if (getPlanDetail) { const d = await getPlanDetail(id); setDetails((prev) => ({ ...prev, [id]: d })); }
    }
  };

  const submit = async (id) => {
    const ok = await onSubmit?.(id);
    // Refresh the cached detail so the reviewer's note + reflected state stay
    // in sync with the row (which the hook already refetched).
    if (ok && getPlanDetail) { const d = await getPlanDetail(id); setDetails((prev) => ({ ...prev, [id]: d })); }
  };

  if (loading) {
    return <Section><div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading plans…</div></Section>;
  }
  if (error) {
    return (
      <Section>
        <div className="rounded-2xl border border-signal-kill/25 bg-signal-kill-bg p-6 text-center text-sm text-signal-kill">
          <AlertCircle className="w-5 h-5 mx-auto mb-1.5" strokeWidth={1.5} /> Couldn’t load plans right now. Try again shortly.
        </div>
      </Section>
    );
  }

  return (
    <Section>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-8 text-center">
          <ClipboardList className="w-10 h-10 mx-auto text-lumi-subtle" strokeWidth={1.5} />
          <p className="mt-3 font-display text-lumi-text">No plans yet.</p>
          <p className="mt-1 text-lumi-muted text-sm">
            {canManage ? 'Build your first plan below.' : 'A strategist can build the account’s plans.'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-lumi-border bg-lumi-surface overflow-hidden">
          {rows.map((row) => {
            if (row.state === ROW.UNREADABLE) {
              /* The ruled shape: preserve the row, mark it. Dropping it would
                 make this list shorter than the truth while claiming to be
                 complete — a false absence. */
              return (
                <div key={'unreadable-' + row.index} className="border-b border-lumi-border/60 last:border-b-0 px-4 py-3">
                  <span className="text-sm text-signal-kill">This plan couldn’t be read.</span>
                </div>
              );
            }
            const p = row.value;
            const open = expandedId === p.id;
            return (
              <div key={p.id} className="border-b border-lumi-border/60 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-lumi-elevated/40 transition-colors"
                >
                  {open ? <ChevronDown className="w-4 h-4 text-lumi-subtle flex-shrink-0" strokeWidth={1.5} /> : <ChevronRight className="w-4 h-4 text-lumi-subtle flex-shrink-0" strokeWidth={1.5} />}
                  <span className="flex-1 min-w-0 text-sm text-lumi-text truncate">{p.name}</span>
                  <span className="font-mono text-xs text-lumi-subtle hidden sm:inline">{fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</span>
                  <span className="font-mono text-xs text-lumi-text">{formatCurrency(p.totalBudgetMinor, p.currency || currency)}</span>
                  <span className={cn('font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border', planTone[p.status] || planTone.DRAFT)}>
                    {p.status}
                  </span>
                  {p.approvalState && approvalMeta[p.approvalState] && (
                    <span className={cn('font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border', approvalMeta[p.approvalState].tone)}>
                      {approvalMeta[p.approvalState].label}
                    </span>
                  )}
                </button>
                {open && (
                  <PlanDetail
                    plan={p}
                    detail={details[p.id]}
                    loading={detailLoadingId === p.id}
                    canManage={canManage}
                    canSubmit={canSubmit}
                    onSubmit={submit}
                    submitting={submittingId === p.id}
                    onPromote={promote}
                    promoting={promotingId === p.id}
                    promoteResult={promoteResults[p.id]}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage && <PlanForm currency={currency} onCreate={onCreate} creating={creating} />}
    </Section>
  );
}
