// ============================================================
// MARCOM / Lumi — GrowthStrategyBoard  (/app/intelligence/insights)
// ------------------------------------------------------------
// 4 macro metrics + an active-bets strip + the account's goals, plans, approval
// queue and unit economics. MRR / LTV:CAC / CAC don't exist as backend
// endpoints yet — those tiles render the section label with an honest "—"
// placeholder rather than fabricating numbers.
//
// FE-02 — the ACROSS axis is no longer here. The memory-layer timeline and the
// account briefing moved to /app/memory, which is the destination for the
// object they are two readings of (B7 Ruling 2).
//
// STILL OPEN, and named rather than left to be discovered: `bets` and the
// Blended CPA tile read `campaigns` off `useCampaignFeed`, and `GET /lumi/feed`
// stopped publishing that array in S1-B. Both therefore render a claim about an
// account from a field that does not exist — "No strategic bets active" and "No
// campaigns yet". They are the SUBJECT axis and FE-03 repoints them together
// with the hook's other two consumers; splitting that across two slices is how
// a half-repointed hook gets left behind.
// ============================================================
import { useMemo } from 'react';
import { Target } from 'lucide-react';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { useGrowthStrategySummary } from '@/hooks/useGrowthStrategySummary.js';
import { useEconomics, useSaveEconomics } from '@/hooks/useEconomics.js';
import { cn } from '@/lib/utils.js';
import { PriorityBadge, StageBadge } from '@/layouts';
import RoleGate from '@/components/auth/RoleGate.jsx';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useGoals } from '@/hooks/useGoals.js';
import { usePlans } from '@/hooks/usePlans.js';
import { useApprovals } from '@/hooks/useApprovals.js';
import { useFatigueForecast } from '@/hooks/useFatigueForecast.js';
import IntelligenceSubNav from '../IntelligenceSubNav.jsx';
import { FatigueForecastPanel } from './FatigueForecastPanel.jsx';
import { UnitEconomicsPanel } from './UnitEconomicsPanel.jsx';
import { GoalsPanel } from './GoalsPanel.jsx';
import { PlansPanel } from './PlansPanel.jsx';
import { ApprovalsPanel } from './ApprovalsPanel.jsx';

const STAGES = ['DYING', 'FATIGUED', 'TESTING', 'SCALING', 'STABLE'];

export default function GrowthStrategyBoard() {
  // Legacy CampaignState feed — the source for Strategic Bets, and structurally
  // empty since S1-B. See the header: FE-03 owns the repoint.
  const { campaigns, summary, loading } = useCampaignFeed();
  // Active Campaigns tile ONLY — repointed to the connector substrate so its
  // count matches CampaignsView instead of "campaigns with a pending Action".
  const { summary: growth, loading: growthLoading } = useGrowthStrategySummary();
  const { forecast: fatigueForecast, isLoading: fatigueLoading } = useFatigueForecast();
  const { role: collabRole } = useCollabRole();
  const { data: economics, loading: economicsLoading, error: economicsError, refetch: refetchEconomics } = useEconomics();
  const { save: saveEconomics, saving: economicsSaving } = useSaveEconomics();
  const onSaveEconomics = async (inputs) => { const ok = await saveEconomics(inputs); if (ok) await refetchEconomics(); };

  // North-star goals (Phase 6A). Viewable by everyone who reaches this page
  // (STRATEGIST/BUYER); creating one is STRATEGIST-only.
  const { goals, isLoading: goalsLoading, error: goalsError, createGoal, isCreating: goalCreating } = useGoals();
  const canSetGoals = collabRole === WORKSPACE_ROLE.STRATEGIST;
  const goalsCurrency = economics?.economics?.currency || economics?.currentCac?.currency || 'USD';

  // Forward-looking plans (Phase 6A). View all who reach this page; build +
  // promote are STRATEGIST-only.
  const { plans, isLoading: plansLoading, error: plansError, createPlan, isCreating: planCreating, getPlan, promotePlan, promotingId: planPromotingId, submitForApproval, submittingId: planSubmittingId } = usePlans();
  // Submitting a plan for sign-off is a BUYER/STRATEGIST workflow action (matches
  // the POST /approvals gate); a CLIENT seat is read-only.
  const canSubmitPlan = collabRole === WORKSPACE_ROLE.STRATEGIST || collabRole === WORKSPACE_ROLE.BUYER;

  // Active bets = pending alerts, treated as hypotheses under test.
  const bets = useMemo(() => {
    const out = [];
    for (const c of campaigns) {
      for (const a of c.alerts ?? []) {
        out.push({
          id:        a.action_id,
          status:    a.action_plan?.status === 'PENDING' ? 'ACTIVE' : 'CONCLUDED',
          title:     a.action_plan?.action || a.analysis?.root_cause || c.campaign_id,
          campaign:  c.campaign_id,
          // Real signals straight off the alert/campaign — never an inferred %.
          priority:  a.priority || 'MEDIUM',
          verdict:   a.analysis?.verdict || 'HOLD',
          stage:     STAGES.includes(c.stage) ? c.stage : null,
          conclusion: a.action_plan?.status === 'PENDING' ? null : 'Awaiting outcome data',
        });
      }
    }
    return out.slice(0, 12);
  }, [campaigns]);

  // FE-02 — a `learnings` memo stood here. It walked
  // campaigns[].alerts[].memory[] out of `useCampaignFeed` and rendered a
  // "System Learnings — The Memory Layer" timeline, and when it came back
  // empty the section printed "The memory layer is empty."
  //
  // `GET /lumi/feed` stopped publishing `campaigns` in S1-B, so it came back
  // empty for EVERY workspace, and that sentence was a false claim about the
  // account — contradicted a hundred lines lower on this same page, where the
  // account briefing rendered the patterns Lumi actually holds.
  //
  // Deleted rather than repointed, on S1-B's own precedent: the real memory is
  // the briefing, and both readings of it now live at /app/memory. Building a
  // replacement timeline here would be inventing a surface for a retired
  // capability under cover of an IA change.

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 lg:p-8 animate-fade-in">
      {/* ── HEADER ──────────────────────────────────────────── */}
      {/* The "Memory Layer: N learnings" badge that stood here counted the
          deleted feed's rows, so it read "0 learnings" for every workspace on
          every render — a count of an account's beliefs, taken from a field
          that no longer exists. The sub-title claimed the same thing in prose. */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="decision-title text-lumi-text">Growth Strategy</h1>
          <p className="text-lumi-muted text-sm mt-1">Goals, plans and unit economics for the account</p>
        </div>
      </header>

      <IntelligenceSubNav />

      {/* ── MACRO METRICS ───────────────────────────────────── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        <MetricCard
          label="MRR Target"
          primary="—"
          secondary="No revenue source connected"
          footer="Connect Stripe to populate"
        />
        <MetricCard
          label="LTV:CAC"
          primary="—"
          secondary="No CRM source connected"
          footer="Awaiting customer-data integration"
        />
        <MetricCard
          label="Blended CPA"
          primary={summary.blendedCpa != null ? `$${summary.blendedCpa.toFixed(2)}` : '—'}
          secondary={loading ? 'Loading…' : (summary.pending ? 'Avg across pending decisions' : 'No campaigns yet')}
          footer={summary.blendedCpa != null ? <Sparkline values={[summary.blendedCpa]} /> : null}
        />
        <MetricCard
          label="Active Campaigns"
          primary={growthLoading ? '…' : growth.total}
          secondary={growthLoading ? 'Loading…' : <ActiveCampaignsBreakdown g={growth} />}
        />
      </section>

      {/* ── ACTIVE STRATEGIC BETS ───────────────────────────── */}
      <section className="mb-10">
        <div className="section-label">Active Strategic Bets</div>
        <p className="mt-1 text-lumi-muted text-sm mb-4">Hypotheses currently being tested by the system</p>

        {bets.length === 0 ? (
          <EmptyBets loading={loading} />
        ) : (
          <div
            className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2"
            role="list"
            aria-label="Active strategic bets"
          >
            {bets.map((b) => <BetCard key={b.id} bet={b} />)}
          </div>
        )}
      </section>

      {/* ── FATIGUE FORECAST (forward signal · per-campaign, named) ─── */}
      <FatigueForecastPanel forecast={fatigueForecast} loading={fatigueLoading} />

      {/* ── FE-02 · the ACROSS axis left this board ──────────────
          The "System Learnings — The Memory Layer" timeline and the account
          briefing both stood here. They are the two readings of ONE object
          (B7 Ruling 2) and they now live at /app/memory, which is where a
          person can link to them. Nothing about either reading changed in the
          move — only its address. ── */}

      {/* ── NORTH-STAR GOALS (Phase 6A · view all; create STRATEGIST) ─── */}
      <GoalsPanel
        goals={goals}
        loading={goalsLoading}
        error={goalsError}
        onCreate={createGoal}
        creating={goalCreating}
        canCreate={canSetGoals}
        currency={goalsCurrency}
      />

      {/* ── PLANS (Phase 6A · view all; build/promote STRATEGIST) ───
          Phase 6B adds the approval gate: submit-for-approval (BUYER/STRATEGIST)
          + reflected status + the reviewer's note on a revision. */}
      <PlansPanel
        plans={plans}
        loading={plansLoading}
        error={plansError}
        onCreate={createPlan}
        creating={planCreating}
        canManage={canSetGoals}
        currency={goalsCurrency}
        getPlanDetail={getPlan}
        onPromote={promotePlan}
        promotingId={planPromotingId}
        canSubmit={canSubmitPlan}
        onSubmit={submitForApproval}
        submittingId={planSubmittingId}
      />

      {/* ── PLAN APPROVALS (Phase 6B · STRATEGIST decision queue) ───
          Only mounted for a STRATEGIST so the fetch + queue stay scoped to the
          one role that can decide; the server is the real arbiter. */}
      <RoleGate role={['STRATEGIST']}>
        <StrategistApprovals />
      </RoleGate>

      {/* ── UNIT ECONOMICS (Phase 4-D · STRATEGIST only) ─────── */}
      <RoleGate role={['STRATEGIST']}>
        <UnitEconomicsPanel
          data={economics}
          loading={economicsLoading}
          error={economicsError}
          onSave={onSaveEconomics}
          saving={economicsSaving}
        />
      </RoleGate>
    </div>
  );
}

// Thin wrapper so useApprovals only fetches when a STRATEGIST is actually
// viewing (mounted behind the RoleGate above).
function StrategistApprovals() {
  const { pendingApprovals, isLoading, error, decide, decidingId } = useApprovals();
  return (
    <ApprovalsPanel
      approvals={pendingApprovals}
      loading={isLoading}
      error={error}
      onDecide={decide}
      decidingId={decidingId}
    />
  );
}

// ── Sub-components ─────────────────────────────────────────

// Connector-sourced verdict breakdown for the Active Campaigns tile. Zero
// buckets are omitted; GATED campaigns are surfaced honestly, one entry per
// reason (never folded into a verdict count, and never collapsed into one
// number — C-07: "N need revenue data" was the wrong instruction for the two
// reasons out of three that a sync fixes).
function ActiveCampaignsBreakdown({ g }) {
  const parts = [
    g.scaling  > 0 && `${g.scaling} Scaling`,
    g.holding  > 0 && `${g.holding} Holding`,
    g.watching > 0 && `${g.watching} Watching`,
    g.killing  > 0 && `${g.killing} Killing`,
  ].filter(Boolean);

  const gated = g.gated ?? [];

  if (parts.length === 0 && gated.length === 0) {
    return <>{g.total > 0 ? 'Awaiting verdicts' : 'No connected campaigns yet'}</>;
  }

  return (
    <>
      {parts.join(' · ')}
      {gated.map((entry, i) => (
        <span key={entry.reason ?? `unknown-${i}`} className="text-lumi-subtle">
          {parts.length > 0 || i > 0 ? ' · ' : ''}{entry.count} {entry.label}
        </span>
      ))}
    </>
  );
}

function MetricCard({ label, primary, secondary, footer }) {
  return (
    <article className="bg-lumi-surface border border-lumi-border rounded-xl p-5 flex flex-col">
      <div className="section-label">{label}</div>
      <div className="mt-2 metric-display text-lumi-text">{primary}</div>
      <div className="mt-1 text-xs text-lumi-muted">{secondary}</div>
      {footer && <div className="mt-3">{footer}</div>}
    </article>
  );
}

function BetCard({ bet }) {
  const statusColor =
    bet.status === 'ACTIVE'    ? 'text-lumi-accent  bg-lumi-accent-soft'
  : bet.status === 'PAUSED'    ? 'text-signal-hold  bg-signal-hold-bg'
  :                              'text-signal-scale bg-signal-scale-bg';

  const verdictColor =
    bet.verdict === 'KILL'  ? 'text-signal-kill'
  : bet.verdict === 'SCALE' ? 'text-signal-scale'
  :                           'text-signal-hold';

  return (
    <article
      role="listitem"
      className="w-72 flex-shrink-0 bg-lumi-surface border border-lumi-border rounded-2xl p-5 hover:border-lumi-border-strong transition-all"
    >
      <span className={cn('inline-block font-mono text-xs uppercase px-2 py-0.5 rounded', statusColor)}>
        {bet.status}
      </span>
      <h3 className="font-display font-semibold text-sm text-lumi-text leading-snug mt-2 line-clamp-3">{bet.title}</h3>
      <p className="text-xs text-lumi-subtle mt-1 truncate">{bet.campaign}</p>

      {/* Real per-alert/-campaign signals via the frozen primitives — priority
          + stage + verdict from the feed, never an inferred confidence number. */}
      <div className="mt-4 flex items-center flex-wrap gap-2 font-mono text-xs">
        <PriorityBadge priority={bet.priority} />
        {bet.stage && <StageBadge stage={bet.stage} />}
        <span className={cn('uppercase', verdictColor)}>{bet.verdict}</span>
      </div>

      {bet.conclusion && (
        <div className="bg-signal-scale-bg border-t border-signal-scale/25 -mx-5 -mb-5 px-5 py-2 mt-4 rounded-b-2xl">
          <p className="font-mono text-xs text-signal-scale">Result: {bet.conclusion}</p>
        </div>
      )}
    </article>
  );
}

function Sparkline({ values = [] }) {
  if (values.length === 0) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * 60;
    const y = 16 - ((v - min) / range) * 16;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="60" height="16" viewBox="0 0 60 16" aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.25" points={pts} className="text-lumi-accent" />
    </svg>
  );
}

function EmptyBets({ loading }) {
  if (loading) return <div className="rounded-xl border border-dashed border-lumi-border p-6 text-center text-sm text-lumi-subtle">Loading…</div>;
  return (
    <div className="rounded-2xl border border-dashed border-lumi-border bg-lumi-surface/40 p-10 text-center">
      <Target className="w-12 h-12 mx-auto text-lumi-subtle" strokeWidth={1.5} />
      <p className="mt-3 font-display text-lumi-text">No strategic bets active.</p>
      <p className="mt-1 text-lumi-muted text-sm">
        Analyze your first campaign to generate strategic recommendations.
      </p>
    </div>
  );
}
