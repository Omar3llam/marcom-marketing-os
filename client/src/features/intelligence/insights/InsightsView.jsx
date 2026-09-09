// ============================================================
// MARCOM / Lumi — GrowthStrategyBoard  (/app/intelligence/insights)
// ------------------------------------------------------------
// The account's macro metrics, goals, plans, approval queue and unit economics.
// MRR / LTV:CAC don't exist as backend endpoints yet — those tiles render the
// section label with an honest "—" rather than fabricating a number.
//
// FE-02 — the ACROSS axis left: the memory-layer timeline and the account
// briefing moved to /app/memory (B7 Ruling 2).
//
// FE-03 — and the SUBJECT half left with the substrate behind it. "Active
// Strategic Bets" was built from campaigns[].alerts[], and the Blended CPA tile
// from that same feed's roll-up. S1-B deleted the array, so for every workspace
// the strip rendered
//
//     "No strategic bets active. Analyze your first campaign to generate
//      strategic recommendations."
//
// and the tile read "—  ·  No campaigns yet". Both are claims about an account,
// made from a field that does not exist.
//
// Deleted rather than repointed, on S1-B's own precedent. A "bet" here was a
// PENDING Action, and no Action row has been minted anywhere since B3-C; the
// live equivalents are the connector verdict queue on /app/campaigns and the
// agenda on /app/overview. Rebuilding this strip over those would be inventing
// a third view of them under cover of a repoint.
// ============================================================
import { useGrowthStrategySummary } from '@/hooks/useGrowthStrategySummary.js';
import { useEconomics, useSaveEconomics } from '@/hooks/useEconomics.js';
import { cn } from '@/lib/utils.js';
// Exhaustive over the verdict enum, and already the single source for urgency.
import { VERDICT_RANK } from '@/lib/verdictRank.js';
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

export default function GrowthStrategyBoard() {
  // The connector substrate, so this count matches CampaignsView rather than
  // "campaigns with a pending Action" — a population that stopped growing at B3-C.
  const { summary: growth, loading: growthLoading } = useGrowthStrategySummary();
  const { forecast: fatigueForecast, isLoading: fatigueLoading } = useFatigueForecast();
  const { role: collabRole } = useCollabRole();
  const { data: economics, loading: economicsLoading, error: economicsError, refetch: refetchEconomics } = useEconomics();
  const { save: saveEconomics, saving: economicsSaving } = useSaveEconomics();
  const onSaveEconomics = async (inputs) => { const ok = await saveEconomics(inputs); if (ok) await refetchEconomics(); };

  // North-star goals (Phase 6A). Viewable by everyone who reaches this page
  // (STRATEGIST/BUYER); creating one is STRATEGIST-only.
  const { goals, goalRows, isLoading: goalsLoading, error: goalsError, createGoal, isCreating: goalCreating } = useGoals();
  const canSetGoals = collabRole === WORKSPACE_ROLE.STRATEGIST;
  const goalsCurrency = economics?.economics?.currency || economics?.currentCac?.currency || 'USD';

  // Forward-looking plans (Phase 6A). View all who reach this page; build +
  // promote are STRATEGIST-only.
  const { plans, planRows, isLoading: plansLoading, error: plansError, createPlan, isCreating: planCreating, getPlan, promotePlan, promotingId: planPromotingId, submitForApproval, submittingId: planSubmittingId } = usePlans();
  // Submitting a plan for sign-off is a BUYER/STRATEGIST workflow action (matches
  // the POST /approvals gate); a CLIENT seat is read-only.
  const canSubmitPlan = collabRole === WORKSPACE_ROLE.STRATEGIST || collabRole === WORKSPACE_ROLE.BUYER;

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
      {/* Three tiles, not four — Blended CPA left with its substrate. */}
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-10">
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
          label="Active Campaigns"
          primary={growthLoading ? '…' : growth.total}
          secondary={growthLoading ? 'Loading…' : <ActiveCampaignsBreakdown g={growth} />}
        />
      </section>

      {/* FE-03 — "Active Strategic Bets" stood here, and the Blended CPA tile
          above it. Both read the retired CampaignState feed; see the header. */}

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
        goalRows={goalRows}
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
        planRows={planRows}
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
  const { pendingApprovals, unreadableCount, isLoading, error, decide, decidingId } = useApprovals();
  return (
    <ApprovalsPanel
      approvals={pendingApprovals}
      unreadableCount={unreadableCount}
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
// The word this surface shows for each verdict. The four that stood here were a
// LIST, and a list forgot REALLOCATE and REFRESH — so the parts are built from
// the counts the hook received instead, and a verdict with no word here still
// appears under its own token rather than vanishing.
const VERDICT_WORD = Object.freeze({
  KILL: 'Killing', REFRESH: 'Refreshing', REALLOCATE: 'Reallocating',
  WATCH: 'Watching', HOLD: 'Holding', SCALE: 'Scaling',
});

function ActiveCampaignsBreakdown({ g }) {
  const byVerdict = g.byVerdict ?? {};
  // Ordered by VERDICT_RANK, which is exhaustive over the enum and already the
  // single source for urgency — not a second hand-typed order. Anything the
  // ranking has never heard of sorts last rather than being dropped.
  const parts = Object.keys(byVerdict)
    .filter((v) => byVerdict[v] > 0)
    .sort((a, b) => (VERDICT_RANK[a] ?? 99) - (VERDICT_RANK[b] ?? 99))
    .map((v) => `${byVerdict[v]} ${VERDICT_WORD[v] ?? v}`);

  const gated = g.gated ?? [];

  // Three different facts, stated separately. "Awaiting verdicts" is a claim
  // about LUMI and "No connected campaigns yet" is a claim about the ACCOUNT;
  // collapsing either onto "the words this file knows matched nothing" is what
  // let two live verdicts render as "still deciding".
  if (parts.length === 0 && gated.length === 0) {
    if (g.total === 0) return <>No connected campaigns yet</>;
    if ((g.scored ?? 0) === 0) return <>Awaiting verdicts</>;
    // Verdicts arrived and none of them produced a part. Unreachable while the
    // counts and `scored` agree — but saying either sentence above here would
    // be false, so this states only the count it actually has.
    return <>{g.scored} scored</>;
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

// FE-03 — `BetCard`, `EmptyBets` and `Sparkline` stood here. The first two
// rendered the Strategic Bets strip; the third drew the Blended CPA tile's
// footer, and had no other caller. All three are gone with the substrate that
// fed them. `cn` stays — ActiveCampaignsBreakdown and MetricCard still use it.
