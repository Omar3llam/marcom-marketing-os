// ============================================================
// agenticPlanner — the one new deterministic engine of Phase 9
// ============================================================
// Public API: planAgenda({ ...detections, now })
//
// DETERMINISM CONTRACT:
//   Same input → same output. No DB, no Redis, no HTTP, no clock (`now`
//   injected), no randomness. It receives what the existing organs already
//   surfaced and returns a banded, prioritized agenda + the loop-stage status.
//
// ISOLATION CONTRACT:
//   AgenticLoopService / AgentHomeService load the real rows and feed this
//   engine; nothing here reads the DB.
//
// THE GUARD:
//   Every agenda item is a PROPOSAL with a human verb — Lumi initiates, the
//   human confirms. The engine NEVER marks anything executed. An empty account
//   yields honest empty bands, never fabricated work.
// ============================================================
import { logger } from '../../utils/logger.js';
import {
  AGENDA_BAND, AGENDA_TYPE, LOOP_STAGE, LOOP_STAGE_ORDER, STAGE_STATE, LOOP_HEALTH,
  SEVERITY, SEVERITY_RANK, HUMAN_ACTION, STAGE_ACTIVE_DAYS, STAGE_STALE_DAYS, agendaItem,
} from './agenticTypes.js';
// NOTE: verdictToActionType is deliberately NOT imported here any more. It answers
// "does this verdict have a Meta ActionType?", which #351 used to pick the human
// verb. That question turned out not to bear on the verb at all — see the
// humanAction line in buyerAgenda. It remains canonical for the execution layer
// that consumes it; it is simply not what decides what the buyer is asked to do.

const DAY_MS = 86_400_000;

// Onboarding objective id → the lens the buyer reads the agenda through. Frames
// the summary; never changes severity or humanAction (those stay data-driven).
// Unknown/absent objective → no lens (backward-compatible summary).
const OBJECTIVE_LENS = Object.freeze({
  roas:        'return on ad spend',
  conversions: 'new conversions',
  ltv:         'lifetime value',
  custom:      'your stated goal',
});

// A KILL is urgent and a WATCH is treated as urgent too (a flagged entity the
// buyer must eyeball now); reallocate/refresh/scale are medium; a HOLD is low.
// Keeps the buyer's eye on what bleeds — or is about to — first.
const VERDICT_SEVERITY = Object.freeze({
  KILL: SEVERITY.HIGH, REFRESH: SEVERITY.MEDIUM, REALLOCATE: SEVERITY.MEDIUM,
  SCALE: SEVERITY.MEDIUM, WATCH: SEVERITY.HIGH, HOLD: SEVERITY.LOW,
});

/**
 * Verdicts that are real Decisions but ask the buyer for NOTHING, and so do not
 * belong in a band titled "what needs a decision today".
 *
 * The buyer band is NOT a mirror of the persisted PROPOSED rows. Two separate
 * questions, deliberately answered in two places:
 *
 *   BUYER_ACTIONABLE_ROOT_CAUSES (decisionIdentity.js) → which persisted
 *     connector Decisions are even CANDIDATES? (authorship / cause)
 *   NON_BUYER_VERDICTS (here)                          → of those candidates,
 *     which actually need a buyer? (verdict actionability)
 *
 * HOLD means "the engine looked and there is nothing to do". Every other surface
 * already says so: verdictToActionType('HOLD') is null, nextActionFor('HOLD') is
 * null, it draws no ActionBar and no decision lifecycle, and Overview files it
 * under "Doing well" in a section whose own header calls it "the band with
 * nothing to do". Only this band disagreed — and it did so with humanAction
 * CONFIRM, which agenticTypes defines as "→ execution motion", something HOLD
 * structurally cannot have.
 *
 * WATCH is NOT here, deliberately. It also has no Meta action, so executability
 * is the wrong test for ADMISSION; ATTENTION is the right one. WATCH means
 * "something is off, a human should look", and it rides at HIGH severity. HOLD
 * means "nothing is off". Same lack of a button, opposite meaning.
 *
 * The VERB is a third question, answered at the humanAction line below — and its
 * answer turns out not to depend on executability either. #351 read this comment
 * as "executable ⇒ CONFIRM"; #354 found that no agenda item's destination can
 * execute anything, so every verdict earns REVIEW. Executability decides neither
 * admission nor the verb. See the humanAction line for the full reasoning.
 *
 * Where a guardrail WATCH actually comes from, since the obvious answer is wrong:
 * NOT the HOLD → WATCH upgrade in verdictEngine. That branch reads
 * `guardrailHits`, which rollupVerdicts sources from `opts.guardrailHitsByEntity`
 * — and no production caller supplies it (persistLevelVerdicts passes only
 * `{ relativeRanking: true }`; connectorVerdictService passes no opts at all). It
 * is wired and unfed, the same latent-defect shape as SIGNAL_TYPE.UNDIAGNOSABLE.
 * The live path is GuardrailSweepService writing its own Decision with
 * `rootCause: 'guardrail:<rule>'` and `verdict: rule.emitVerdict ?? 'WATCH'`,
 * which AgenticLoopService admits on the `startsWith: 'guardrail:'` clause. Since
 * GuardrailRule.emitVerdict defaults to WATCH, that is the DEFAULT verdict of any
 * rule the operator configured without naming one — which is why WATCH cannot
 * leave this band without silently muting configured policy.
 *
 * HOLD is untouched everywhere else: still persisted PROPOSED, still superseded,
 * still in Decision Memory and history, still shown by Campaigns and Overview.
 * It stays institutional memory — it just stops being asked about.
 */
export const NON_BUYER_VERDICTS = Object.freeze(['HOLD']);

function bySeverityDesc(a, b) {
  const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (d !== 0) return d;
  // Within a severity tier, the higher-impact lever first (the same 1-10 the
  // Campaigns page shows). An unscored item (null) sinks below any real score.
  const im = (b.impactScore ?? -1) - (a.impactScore ?? -1);
  if (im !== 0) return im;
  return String(a.id).localeCompare(String(b.id)); // stable tiebreak
}

/** Days between two instants (positive if `then` is in the past). */
function ageDays(then, now) {
  if (!then) return Infinity;
  return (now.getTime() - new Date(then).getTime()) / DAY_MS;
}

// ── Buyer band — "what needs a decision today" ──────────────────
function buyerAgenda({ verdicts = [], fatiguePredictions = [], pacing = [], testAgenda = [], openTests = [], labelsById = new Map(), impactById = new Map(), now }) {
  const items = [];

  for (const d of verdicts) {
    if (d.status && d.status !== 'PROPOSED') continue;
    // A real Decision that asks the buyer for nothing. Dropped HERE rather than
    // in the loader's query: the query answers "which persisted Decisions are
    // candidates", this answers "which candidates need a buyer". Keeping the row
    // loaded means Decision Memory, history and every other reader see it exactly
    // as before — only this band stops counting it.
    if (NON_BUYER_VERDICTS.includes(d.verdict)) continue;
    const label = labelsById.get(d.entityId) ?? d.entityId;
    items.push(agendaItem({
      id: `verdict:${d.id}`, band: AGENDA_BAND.BUYER, type: AGENDA_TYPE.VERDICT,
      title: `${d.verdict} ${label}`, rationale: d.rationale ?? d.diagnosis ?? '',
      severity: VERDICT_SEVERITY[d.verdict] ?? SEVERITY.MEDIUM,
      // THE THIRD QUESTION. Admission (above) asks whether the buyer is asked at
      // all; this asks what they are asked to DO. And the honest answer for EVERY
      // verdict is REVIEW, because of where the click actually goes.
      //
      // agenticTypes defines CONFIRM as "confirm a proposed verdict/reallocation
      // → execution motion". This item navigates to Campaigns (agendaItemRoute:
      // `${campaigns}?entity=…`) and Campaigns cannot execute. What is there is
      // ActionBar's "Copy decision" and "Open in {channel}", plus DecisionLifecycle's
      // "I executed this" — a clipboard write, a link to Meta Ads Manager, and a
      // self-report. The marketer executes IN META, by hand. Lumi never mutates.
      //
      // The execution half of the system is real but orphaned: POST /api/execute/meta
      // → ExecutionRequest → executionQueue → executionWorker → Meta Graph API is
      // mounted, guarded and worker-backed, and has ZERO production client callers.
      // Nothing routes from a verdict to it. So a verdict's Meta ActionType is a
      // fact about a path nobody walks, which makes it the wrong basis for a verb
      // the human reads.
      //
      // That is why this is a CONSTANT rather than derived from verdictToActionType.
      // #351 derived it, which was right for the question it asked then ("does this
      // verdict have an action type?") and wrong for the one that matters ("can the
      // destination act?"). A KILL and a WATCH ask the same thing of the human here:
      // go look, then act in Meta yourself. Deriving the verb from executability
      // encoded a capability the product does not have.
      //
      // If Lumi ever executes on confirm, this becomes derived again — but from the
      // DESTINATION's capability, not from an enum's non-nullness.
      evidenceRef: d.id,
      humanAction: HUMAN_ACTION.REVIEW,
      entityId: d.entityId,
      impactScore: impactById.get(d.entityId) ?? null,
    }));
  }

  for (const f of fatiguePredictions) {
    const days = ageDays(now, new Date(f.projectedBreachDate)); // negative ⇒ in future
    const within = -days; // days until breach
    const sev = within <= 3 ? SEVERITY.HIGH : within <= 7 ? SEVERITY.MEDIUM : SEVERITY.LOW;
    const label = labelsById.get(f.entityId) ?? f.entityId;
    items.push(agendaItem({
      id: `fatigue:${f.entityId}:${f.metric}`, band: AGENDA_BAND.BUYER, type: AGENDA_TYPE.FATIGUE,
      title: `${label} ${f.metric} nearing ceiling`,
      rationale: f.basis ?? `Projected to breach ${f.ceiling ?? ''} around ${new Date(f.projectedBreachDate).toISOString().slice(0, 10)}.`,
      severity: sev, evidenceRef: f.id ?? null, humanAction: HUMAN_ACTION.REVIEW, entityId: f.entityId,
    }));
  }

  for (const p of pacing) {
    if (p.status !== 'OVER') continue; // over-pacing is the buyer's fire
    items.push(agendaItem({
      id: `pacing:${p.channelId ?? p.scope ?? 'portfolio'}`, band: AGENDA_BAND.BUYER, type: AGENDA_TYPE.PACING,
      title: `${p.channel ?? p.channelId ?? 'Budget'} over-pacing`,
      rationale: p.daysEarly != null ? `Exhausts ~${p.daysEarly} days early at the current run rate.` : 'Projected to overspend the period.',
      severity: SEVERITY.MEDIUM, evidenceRef: p.channelId ?? null, humanAction: HUMAN_ACTION.CONFIRM,
    }));
  }

  // This week's tests — agenda suggestions + anything already running to read.
  for (const t of testAgenda.slice(0, 5)) {
    items.push(agendaItem({
      id: `test-agenda:${t.entityId ?? t.name}`, band: AGENDA_BAND.BUYER, type: AGENDA_TYPE.TEST,
      title: `Test: ${t.name}`, rationale: t.hypothesis ?? '',
      severity: t.priority === 'HIGH' ? SEVERITY.MEDIUM : SEVERITY.LOW,
      evidenceRef: null, humanAction: HUMAN_ACTION.REVIEW, entityId: t.entityId ?? null,
    }));
  }
  for (const t of openTests) {
    items.push(agendaItem({
      id: `test-open:${t.id}`, band: AGENDA_BAND.BUYER, type: AGENDA_TYPE.TEST,
      title: `Running test: ${t.dimension ?? ''}`.trim(), rationale: t.hypothesis ?? 'In flight — read when concluded.',
      severity: SEVERITY.LOW, evidenceRef: t.id, humanAction: HUMAN_ACTION.REVIEW,
    }));
  }

  return items.sort(bySeverityDesc);
}

// ── Strategist band — "how the portfolio tracks to goal" ────────
function strategistAgenda({ planTracking = null, blended = null, pacing = [], now }) {
  void now;
  const items = [];

  for (const g of planTracking?.goals ?? []) {
    const status = g.landing?.status ?? 'ON_TRACK';
    if (status === 'ON_TRACK' || status === 'ACHIEVED') continue; // only what needs a strategist
    const sev = status === 'OFF_TRACK' || status === 'MISSED' ? SEVERITY.HIGH : SEVERITY.MEDIUM;
    items.push(agendaItem({
      id: `goal:${g.goalId}`, band: AGENDA_BAND.STRATEGIST, type: AGENDA_TYPE.PLAN_ADJUSTMENT,
      title: `Goal ${g.metric} is ${status.replace(/_/g, ' ').toLowerCase()}`,
      rationale: g.landing?.basis ?? 'Trend-based landing estimate drifting from target.',
      severity: sev, evidenceRef: g.goalId, humanAction: HUMAN_ACTION.ADJUST,
    }));
  }

  if (blended?.portfolio && typeof blended.portfolio.gapPct === 'number' && Math.abs(blended.portfolio.gapPct) >= 20) {
    items.push(agendaItem({
      id: 'blended:gap', band: AGENDA_BAND.STRATEGIST, type: AGENDA_TYPE.PLAN_ADJUSTMENT,
      title: `Platform over-reports revenue by ${Math.round(blended.portfolio.gapPct)}%`,
      rationale: 'Blended truth diverges from platform claims — review allocation against reconciled performance.',
      severity: SEVERITY.MEDIUM, evidenceRef: null, humanAction: HUMAN_ACTION.REVIEW,
    }));
  }

  const under = pacing.filter((p) => p.status === 'UNDER');
  if (under.length > 0) {
    items.push(agendaItem({
      id: 'pacing:under', band: AGENDA_BAND.STRATEGIST, type: AGENDA_TYPE.PACING,
      title: `${under.length} channel${under.length === 1 ? '' : 's'} under-pacing`,
      rationale: 'Budget left on the table — consider reallocating toward proven performers.',
      severity: SEVERITY.LOW, evidenceRef: null, humanAction: HUMAN_ACTION.ADJUST,
    }));
  }

  return items.sort(bySeverityDesc);
}

// ── Loop-stage status — is the loop closed? ─────────────────────
function stageState(lastAt, now) {
  const age = ageDays(lastAt, now);
  if (age <= STAGE_ACTIVE_DAYS) return STAGE_STATE.ACTIVE;
  if (age <= STAGE_STALE_DAYS) return STAGE_STATE.IDLE;
  return STAGE_STATE.STALE;
}

function loopStatus({ plans = [], allocationPlans = [], executedActions = [], openTests = [], testAgenda = [], recentOutcomes = [], recentMemory = [], buyerCount = 0, now }) {
  const freshest = (rows, field) => rows.reduce((acc, r) => {
    const t = r[field] ? new Date(r[field]).getTime() : 0;
    return t > acc ? t : acc;
  }, 0);

  const lastByStage = {
    [LOOP_STAGE.PLAN]:     freshest(plans, 'createdAt'),
    [LOOP_STAGE.ALLOCATE]: freshest(allocationPlans, 'createdAt'),
    [LOOP_STAGE.EXECUTE]:  freshest(executedActions, 'executedAt'),
    [LOOP_STAGE.TEST]:     Math.max(freshest(openTests, 'startedAt'), testAgenda.length ? now.getTime() : 0),
    [LOOP_STAGE.MEASURE]:  freshest(recentOutcomes, 'createdAt'),
    [LOOP_STAGE.LEARN]:    freshest(recentMemory, 'createdAt'),
  };
  const countByStage = {
    [LOOP_STAGE.PLAN]: plans.length, [LOOP_STAGE.ALLOCATE]: allocationPlans.length,
    [LOOP_STAGE.EXECUTE]: executedActions.length, [LOOP_STAGE.TEST]: openTests.length + testAgenda.length,
    [LOOP_STAGE.MEASURE]: recentOutcomes.length, [LOOP_STAGE.LEARN]: recentMemory.length,
  };

  const stageStatus = LOOP_STAGE_ORDER.map((stage) => {
    const lastMs = lastByStage[stage] || null;
    const lastAt = lastMs ? new Date(lastMs).toISOString() : null;
    return { stage, state: lastMs ? stageState(lastMs, now) : STAGE_STATE.STALE, lastAt, count: countByStage[stage] };
  });

  const staleStages = stageStatus.filter((s) => s.state === STAGE_STATE.STALE).map((s) => s.stage);
  const closed = stageStatus.every((s) => s.lastAt != null);

  // STALLED when buyers have proposals waiting but EXECUTE has gone stale —
  // the loop is detecting but not turning. DEGRADED when something's ageing.
  const executeStale = stageStatus.find((s) => s.stage === LOOP_STAGE.EXECUTE)?.state === STAGE_STATE.STALE;
  let loopHealth = LOOP_HEALTH.HEALTHY;
  if ((buyerCount > 0 && executeStale) || !closed) loopHealth = LOOP_HEALTH.STALLED;
  else if (staleStages.length > 0) loopHealth = LOOP_HEALTH.DEGRADED;

  return { stageStatus, staleStages, closed, loopHealth };
}

/**
 * Unify the organs' detections into a two-band agenda + loop status.
 * @returns {{ buyerBand, strategistBand, stageStatus, staleStages, closed, loopHealth, summary }}
 */
export function planAgenda({
  verdicts = [], fatiguePredictions = [], pacing = [], testAgenda = [], openTests = [],
  planTracking = null, blended = null, plans = [], allocationPlans = [], executedActions = [],
  recentOutcomes = [], recentMemory = [], labelsById = new Map(), impactById = new Map(), objective = null, now = new Date(),
} = {}) {
  const buyerBand = buyerAgenda({ verdicts, fatiguePredictions, pacing, testAgenda, openTests, labelsById, impactById, now });
  const strategistBand = strategistAgenda({ planTracking, blended, pacing, now });

  const loop = loopStatus({
    plans, allocationPlans, executedActions, openTests, testAgenda, recentOutcomes, recentMemory,
    buyerCount: buyerBand.length, now,
  });

  const base = buyerBand.length === 0 && strategistBand.length === 0
    ? 'Nothing needs a decision right now — the loop is quiet.'
    : `${buyerBand.length} to decide, ${strategistBand.length} to steer.`;
  // Frame the summary through the account's objective when one is set.
  const lens = OBJECTIVE_LENS[objective] ?? null;
  const summary = lens ? `Optimizing for ${lens} — ${base}` : base;

  logger.debug({ buyer: buyerBand.length, strategist: strategistBand.length, loopHealth: loop.loopHealth }, '[agenticPlanner] planned');
  return { buyerBand, strategistBand, ...loop, summary };
}
