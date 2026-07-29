// ============================================================
// MARCOM / Lumi — Decision lifecycle signals
//   PATCH /api/lumi/decisions/by-entity/:entityId/explain
//   PATCH /api/lumi/decisions/by-entity/:entityId/intent
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
