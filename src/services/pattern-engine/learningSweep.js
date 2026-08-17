// ============================================================
// learningSweep — extraction on a schedule, not on a page view
// ============================================================
// R10 (Phase C). Pattern extraction used to run in exactly one place: inside
// GET /api/lumi/briefing, on a route gated to the GROWTH plan. Three
// consequences, none of them intended:
//
//   • a workspace nobody opened never learned anything;
//   • a FREE or PRO workspace never learned at all, because a UI entitlement
//     was silently deciding whether an account's data got processed;
//   • the learning a workspace DID have was always a side effect of somebody
//     looking at it, which is not a property an institutional memory should
//     have.
//
// This sweep is the fix: extraction is now something the system does, and the
// briefing is something a human reads.
//
// WHY THE MAINTENANCE QUEUE, AND NOT THE AGENTIC ONE
//   The agentic cron is opt-in (AGENTIC_CRON_ENABLED) for a specific reason —
//   every tick fans out to the AI gateway and SPENDS. Learning extraction is
//   deterministic: patternEngine has no LLM, no randomness, and no network. It
//   only reads rows and writes derived ones. Putting it behind an AI-spend flag
//   would recreate the starvation this PR exists to end, one config key later.
//
//   The maintenance queue is always-on and already says in its own header that
//   the next scheduled job should share it rather than mint another. So no new
//   queue, no new worker process, no new Redis surface.
//
// FAILURE ISOLATION
//   One workspace's extraction failing must not stop the others: a single
//   account with a malformed row would otherwise silently freeze learning for
//   every account behind it in the loop. Failures are counted and logged, and
//   the sweep reports them — a sweep that quietly did nothing is
//   indistinguishable from one that worked.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getBriefing } from './PatternService.js';

// Same bound and the same reasoning as AGENTIC_MAX_WORKSPACES: the sweep must
// be finite even if the workspace table is not.
const MAX_WORKSPACES = Number(process.env.LEARNING_MAX_WORKSPACES || 500);

/**
 * Run pattern extraction for every workspace, once.
 *
 * Serial, not `Promise.all`: each extraction reads a 365-day evidence window
 * and writes a transaction, and fanning every workspace at those two costs
 * simultaneously is how a background sweep becomes a production incident. The
 * job has no deadline; the database does.
 *
 * @param {{ now?: Date, maxWorkspaces?: number }} [opts]
 * @returns {Promise<{ workspaces:number, learned:number, failed:number }>}
 */
export async function runLearningSweep({ now = new Date(), maxWorkspaces = MAX_WORKSPACES } = {}) {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true },
    take: maxWorkspaces,
  });

  let learned = 0;
  let failed = 0;
  for (const ws of workspaces) {
    try {
      await getBriefing(ws.id, { now });
      learned += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ err: err.message, workspaceId: ws.id }, '[learningSweep] workspace extraction failed');
    }
  }

  logger.info({ workspaces: workspaces.length, learned, failed }, '[learningSweep] complete');
  return { workspaces: workspaces.length, learned, failed };
}
