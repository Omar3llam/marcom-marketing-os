// ============================================================
// MARCOM / Lumi — Decision lifecycle signals
//   PATCH /api/lumi/decisions/by-entity/:entityId/explain
//   PATCH /api/lumi/decisions/by-entity/:entityId/intent
//   PATCH /api/lumi/decisions/:id/execute
//   PATCH /api/lumi/decisions/:id/dismiss
// ------------------------------------------------------------
// Two moments the product could not previously observe: a human OPENED the
// reasoning behind a verdict, and a human went and ACTED on it (copied the
// recommendation, or opened the ad platform). Neither executes anything.
//
// ── Why by-entity and not by decision id ─────────────────────────────────────
// The Campaigns and Home surfaces never receive a Decision id. getConnectorVerdicts
// recomputes verdicts in memory from the entity graph and returns `id = entityId`;
// it does not read the Decision table at all. Keying on entityId means the
// clickable surfaces work as they are, and the server resolves the click to
// whichever verdict was actually live at that moment — which is the correct
// attribution anyway.
//
// ── Written ONCE ─────────────────────────────────────────────────────────────
// A second click is not a second engagement. Re-stamping would silently change
// "when did someone first look at this" into "when did someone last click",
// which answers a different question than the column name promises.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { getSimilarOutcomes } from '../../services/analysis/decisionLearning.js';

export const decisionsRouter = Router();

// NOTE: this router is FLAT-MOUNTED at '/' alongside its siblings, so every
// path here carries its own '/decisions' prefix and the role gate is attached
// PER ROUTE. A path-less `router.use(gate)` would leak onto every sibling
// mounted after it — the bug that 403'd half the app in PR #226.
const BASE = '/decisions/by-entity/:entityId';

// Recording that a human engaged with a decision is a BUYER/STRATEGIST signal.
// A CLIENT seat is read-only by construction and must not seed the learning
// loop: their view is not an operator's intent.
const OPERATORS = [WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST];

/**
 * Stamp a lifecycle timestamp on the live verdict for an entity, once.
 * `field` is a fixed literal from the two call sites below — never user input.
 */
async function stampOnce(req, res, field) {
  const { entityId } = req.params;
  if (!req.workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  try {
    const decision = await prisma.decision.findFirst({
      where:   { workspaceId: req.workspaceId, entityId, status: 'PROPOSED' },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, [field]: true },
    });

    // No live verdict for this entity. An honest 404 rather than a silent 200:
    // the caller asked us to record something about a decision that isn't there,
    // and a cheerful ok:true would make a missing signal indistinguishable from
    // a recorded one when the learning query later comes up empty.
    if (!decision) return res.status(404).json({ error: 'NoLiveDecision', message: 'No live decision for this entity' });

    // Already stamped — report the ORIGINAL timestamp, unchanged. `recorded`
    // tells an honest caller which of the two happened.
    if (decision[field]) {
      return res.json({ ok: true, recorded: false, [field]: decision[field] });
    }

    const at = new Date();
    await prisma.decision.update({ where: { id: decision.id }, data: { [field]: at } });
    return res.json({ ok: true, recorded: true, [field]: at });
  } catch (err) {
    logger.error({ err: err.message, entityId, field }, '[lumi/decisions] lifecycle stamp failed');
    return res.status(500).json({ error: 'DecisionUnavailable', message: 'Request failed' });
  }
}

// A human opened the reasoning. Not intent — reading is not acting.
decisionsRouter.patch(`${BASE}/explain`, requireCollabRole(...OPERATORS), (req, res) =>
  stampOnce(req, res, 'explainedAt'));

// A human took the decision somewhere they could act on it (copied it, or opened
// the ad platform). This is the column getSimilarOutcomes gates on — it is what
// separates a verdict someone acted on from one that merely sat in a list.
decisionsRouter.patch(`${BASE}/intent`, requireCollabRole(...OPERATORS), (req, res) =>
  stampOnce(req, res, 'intentAt'));

// ------------------------------------------------------------
// The two HUMAN signals: "I acted on this" / "I rejected this".
// ------------------------------------------------------------
// Keyed by DECISION ID, not by entity, unlike the two stamps above. Those record
// engagement with whatever verdict happened to be live at the moment of a click,
// which is the right attribution for a click. This records a claim ABOUT a
// specific call, and it is the row the accuracy surface will later score — so it
// has to name which one, not "whichever was live".
//
// They do NOT move `status`. Four readers gate on status = 'PROPOSED' (the feed,
// the agentic planner, the collaboration queue, and stampOnce right above), so
// flipping it would drop the decision out of three queues and make /explain and
// /intent 404 on it — an operator who executes first and reads the reasoning
// second would lose their explainedAt entirely. Whether status should follow is
// a separate change with a separate blast radius.
//
// Mutually exclusive by construction: executing and dismissing the same call are
// contradictory claims, and letting both land would leave a row that reports
// itself as acted-on AND rejected. Whichever arrived first wins, and the second
// gets a 409 naming it.
const SIGNALS = Object.freeze({
  executedAt:  { opposite: 'dismissedAt', oppositeError: 'AlreadyDismissed' },
  dismissedAt: { opposite: 'executedAt',  oppositeError: 'AlreadyExecuted' },
});

/**
 * Record a human signal against ONE decision, once.
 * `field` is a fixed literal from the two call sites below — never user input.
 */
async function recordSignal(req, res, field) {
  const { id } = req.params;
  if (!req.workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  const { opposite, oppositeError } = SIGNALS[field];

  try {
    // Found by id + workspace, with NO status filter: a decision that has moved
    // on is a 409 that says what it moved to, not a 404 that implies it never
    // existed. The two are different facts and the caller can act on only one.
    const decision = await prisma.decision.findFirst({
      where:  { id, workspaceId: req.workspaceId },
      select: { id: true, status: true, executedAt: true, dismissedAt: true },
    });

    if (!decision) return res.status(404).json({ error: 'DecisionNotFound', message: 'No such decision in this workspace' });

    // Already stamped — report the ORIGINAL timestamp. Idempotent, and checked
    // BEFORE the status gate: a decision executed while live and superseded by
    // the next sweep must still report its own signal rather than 409 on a
    // claim that was already true when it was made.
    if (decision[field]) {
      return res.json({ ok: true, recorded: false, [field]: decision[field] });
    }

    if (decision[opposite]) {
      return res.status(409).json({
        error: oppositeError,
        message: `This decision was already recorded as ${opposite === 'executedAt' ? 'executed' : 'dismissed'}`,
        [opposite]: decision[opposite],
      });
    }

    // Only a live call can be acted on. A SUPERSEDED verdict has been replaced;
    // recording an intervention against it would attribute the operator's action
    // to a call the engine no longer stands behind.
    if (decision.status !== 'PROPOSED') {
      return res.status(409).json({
        error: 'DecisionNotActionable',
        message: `Decision is ${decision.status}; only a live (PROPOSED) decision can be acted on`,
        status: decision.status,
      });
    }

    const at = new Date();
    await prisma.decision.update({ where: { id: decision.id }, data: { [field]: at } });
    return res.json({ ok: true, recorded: true, [field]: at });
  } catch (err) {
    logger.error({ err: err.message, id, field }, '[lumi/decisions] signal failed');
    return res.status(500).json({ error: 'DecisionUnavailable', message: 'Request failed' });
  }
}

// A human says they acted on this call. The strongest signal the product has,
// and the one the accuracy surface will score against.
decisionsRouter.patch('/decisions/:id/execute', requireCollabRole(...OPERATORS), (req, res) =>
  recordSignal(req, res, 'executedAt'));

// A human says they looked at this call and chose not to act. NOT the absence of
// a signal: an explicit rejection is survivorship data the accuracy surface
// counts in coverage, and it is the only way a wrong call can be recorded as
// wrong by the person who saw it.
decisionsRouter.patch('/decisions/:id/dismiss', requireCollabRole(...OPERATORS), (req, res) =>
  recordSignal(req, res, 'dismissedAt'));

// The track record behind this entity's live verdict: how comparable decisions
// turned out after someone acted on them.
//
// `learning: null` is the NORMAL response and never an error — no live verdict,
// too small a sample, or nothing that improved all return it, and the UI renders
// nothing. A 404 here would make "we have no track record yet" look like a
// failure, and a young workspace has no track record for almost everything.
decisionsRouter.get(`${BASE}/learning`, requireCollabRole(...OPERATORS), async (req, res) => {
  const { entityId } = req.params;
  if (!req.workspaceId) return res.json({ learning: null });

  try {
    // The similarity key comes from the decision being ASKED about, not from
    // the caller — a client that could name its own key could ask for the
    // flattering comparison rather than the true one.
    const decision = await prisma.decision.findFirst({
      where:   { workspaceId: req.workspaceId, entityId, status: 'PROPOSED' },
      orderBy: { createdAt: 'desc' },
      select:  { verdict: true, rootCause: true, entityLevel: true, objective: true, channel: true },
    });
    if (!decision) return res.json({ learning: null });

    const learning = await getSimilarOutcomes({ workspaceId: req.workspaceId, ...decision });
    return res.json({ learning });
  } catch (err) {
    logger.error({ err: err.message, entityId }, '[lumi/decisions] learning read failed');
    // Still `learning: null`, still 200: this is decoration on a decision the
    // user is already looking at. Failing the panel over a missing track record
    // would cost more than the line is worth.
    return res.json({ learning: null });
  }
});
