// ============================================================
// MARCOM / Lumi — Decision Accuracy (Phase X · Proof Engine)
//   GET /api/lumi/accuracy — the calibration report for this workspace
//                            ({ accountLift, calibration, velocity, coverage }).
//
// Read-only. The Proof Engine measures; it never mutates a Decision or Outcome.
// Per-account only — every query is workspace-scoped (no cross-workspace read).
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import {
  getAccuracy, recordOutcome, listPendingOutcomes, validateOutcomeBody,
} from '../../services/decision-accuracy/DecisionAccuracyService.js';
import { accuracySurface } from '../../services/decision-accuracy/accuracyTypes.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';

export const accuracyRouter = Router();

// Recording / observing outcomes is the BUYER+STRATEGIST operator tier (mirrors
// lumi/testing.js). A CLIENT reads the narrative; it never asserts what
// actually happened. The READ surface (GET /accuracy) stays open to all roles —
// the gated `surface` already suppresses calibration numbers below RELIABLE.
const requireOperator = requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST);

// Resolve workspaceId — mirrors lumi/agentic.js. Never fabricate a uuid.
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/accuracy] workspaceId fallback failed');
    return null;
  }
}

async function need(req, res) {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) { res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' }); return null; }
  return wsId;
}

// ─────────────────────────────────────────────────────────────
// GET /accuracy — calibration report + the gated one-line surface.
// The surface SUPPRESSES every calibration number unless coverage is RELIABLE.
// ─────────────────────────────────────────────────────────────
accuracyRouter.get('/accuracy', async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const result = await getAccuracy(wsId);
    return res.json({
      workspaceId: wsId,
      generatedAt: new Date().toISOString(),
      surface: accuracySurface(result),
      ...result,
    });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/accuracy] failed');
    return res.status(500).json({ error: 'AccuracyUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /decisions/pending-outcomes — EXECUTED decisions still missing an
// outcome. The manual-entry queue: until a causal realized-metrics source is
// wired, the loop is closed by a human recording what actually happened.
// ─────────────────────────────────────────────────────────────
accuracyRouter.get('/decisions/pending-outcomes', requireOperator, async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const out = await listPendingOutcomes(wsId);
    return res.json({ workspaceId: wsId, ...out });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/accuracy] pending-outcomes failed');
    return res.status(500).json({ error: 'PendingOutcomesUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /decisions/:id/outcome — record the realized outcome (human-asserted).
// 422 bad body · 404 wrong workspace / unknown id · 409 not EXECUTED · 201 ok.
// ─────────────────────────────────────────────────────────────
accuracyRouter.post('/decisions/:id/outcome', requireOperator, async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  const verr = validateOutcomeBody(req.body ?? {});
  if (verr) return res.status(422).json({ error: 'BadOutcome', message: verr });
  try {
    const out = await recordOutcome(wsId, req.params.id, req.body);
    logger.info({ wsId, decisionId: req.params.id }, '[lumi/accuracy] outcome recorded');
    return res.status(201).json(out);
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: 'DecisionNotFound', message: err.message });
    if (/not EXECUTED/i.test(err.message)) return res.status(409).json({ error: 'DecisionNotExecuted', message: err.message });
    logger.error({ err: err.message, wsId, decisionId: req.params.id }, '[lumi/accuracy] record outcome failed');
    return res.status(500).json({ error: 'RecordOutcomeFailed', message: 'Request failed' });
  }
});
