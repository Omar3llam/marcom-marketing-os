// ============================================================
// AgentHomeService — the unified home (two bands + loop status)
// ============================================================
// Decomposed to avoid a God Service (architect note): three INDEPENDENT pure
// builders + one thin DB-touching composer.
//   buildBuyerBand(agenda)        — "what needs a decision today"
//   buildStrategistBand(agenda)   — "how the portfolio tracks to goal"
//   buildLoopStatus(agenda, loop) — the closed-loop ring + health + timing
//   getHome(workspaceId, role)    — the ONLY function that reads the DB; loads
//                                   the substrate once, plans, composes.
//
// Role-aware (P8 collabRole): a CLIENT sees the strategist band only; a BUYER
// leads with the buyer band; a STRATEGIST sees both. Read-only; the on-read
// stale-sweep keeps the loop proactive when no cron is running (dev/no-Redis).
// ============================================================
import { logger } from '../../utils/logger.js';
import { prisma } from '../../lib/prisma.js';
import { planAgenda } from './agenticPlanner.js';
import { buildLoopInputs, runSweep, getLoopState, LOOP_MIN_INTERVAL_MS } from './AgenticLoopService.js';
import { normalizeRole, WORKSPACE_ROLE } from '../collaboration/roleScope.js';
import { getAccuracy } from '../decision-accuracy/DecisionAccuracyService.js';
import { accuracySurface } from '../decision-accuracy/accuracyTypes.js';

// ── Pure builders (independently unit-tested) ───────────────────

/** "What needs a decision today." */
export function buildBuyerBand(agenda) {
  const items = agenda.buyerBand ?? [];
  return {
    title: 'What needs a decision today',
    items,
    count: items.length,
    empty: items.length === 0,
  };
}

/** "How the portfolio is tracking to goal." */
export function buildStrategistBand(agenda) {
  const items = agenda.strategistBand ?? [];
  return {
    title: 'How the portfolio is tracking to goal',
    items,
    count: items.length,
    empty: items.length === 0,
  };
}

/** The closed-loop ring: per-stage freshness + health + run timing. */
export function buildLoopStatus(agenda, { lastRunAt = null, nextRunAt = null, intervalMs = null } = {}) {
  return {
    stageStatus: agenda.stageStatus ?? [],
    closed: agenda.closed ?? false,
    staleStages: agenda.staleStages ?? [],
    loopHealth: agenda.loopHealth ?? 'STALLED',
    lastRunAt,
    nextRunAt,
    intervalMs,
  };
}

// ── The one DB-touching composer ────────────────────────────────

/**
 * Compose the unified home for a role.
 * @returns {Promise<{ role, summary, buyerBand, strategistBand, loop }>}
 */
export async function getHome(workspaceId, role) {
  if (!workspaceId) throw new Error('getHome: workspaceId required');
  const r = normalizeRole(role);
  const now = new Date();

  const loopState = await getLoopState(workspaceId);
  const lastRun = loopState.lastRun;
  const stale = !lastRun || (now.getTime() - new Date(lastRun.createdAt).getTime() > LOOP_MIN_INTERVAL_MS);

  // On-read stale-sweep: keeps the loop proactive without a cron. Best-effort —
  // a sweep failure must never blank the home.
  let agenda;
  let runAt = lastRun?.createdAt ?? null;
  if (stale) {
    try {
      const swept = await runSweep(workspaceId, { trigger: 'ON_READ', now });
      agenda = swept.agenda;
      runAt = swept.loopRun?.createdAt ?? runAt;
    } catch (err) {
      logger.warn({ err: err.message, workspaceId }, '[AgentHome] on-read sweep skipped');
    }
  }
  if (!agenda) {
    const inputs = await buildLoopInputs(workspaceId, { now });
    agenda = planAgenda(inputs);
  }

  const loop = buildLoopStatus(agenda, {
    lastRunAt: runAt ? new Date(runAt).toISOString() : null,
    nextRunAt: runAt ? new Date(new Date(runAt).getTime() + loopState.intervalMs).toISOString() : null,
    intervalMs: loopState.intervalMs,
  });

  // Role scoping: a client sees only the strategist altitude.
  const buyerBand = r === WORKSPACE_ROLE.CLIENT ? null : buildBuyerBand(agenda);
  const strategistBand = buildStrategistBand(agenda);

  // Proof Engine headline (Phase X) — strategist altitude only, best-effort, and
  // GATED: accuracySurface() emits a calibration number only when coverage is
  // RELIABLE, else just "still learning". A failure here never blanks the home.
  let proof = null;
  try {
    proof = accuracySurface(await getAccuracy(workspaceId, { now }));
  } catch (err) {
    logger.warn({ err: err.message, workspaceId }, '[AgentHome] accuracy headline skipped');
  }

  // AI Insight — pre-generated briefing from the latest LoopRun. Null when no
  // sweep has generated one yet (honest empty state on Overview).
  let aiInsight = null;
  try {
    const latestRun = await prisma.loopRun.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: { aiInsight: true },
    });
    aiInsight = latestRun?.aiInsight ?? null;
  } catch (err) {
    logger.warn({ err: err.message, workspaceId }, '[AgentHome] aiInsight read skipped');
  }

  logger.info({ workspaceId, role: r, loopHealth: loop.loopHealth }, '[AgentHome] composed');
  return { role: r, summary: agenda.summary, buyerBand, strategistBand, loop, proof, aiInsight };
}
