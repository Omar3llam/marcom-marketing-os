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
import { getAccuracy } from '../../services/decision-accuracy/DecisionAccuracyService.js';
import { accuracySurface } from '../../services/decision-accuracy/accuracyTypes.js';

export const accuracyRouter = Router();

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
    return res.status(500).json({ error: 'AccuracyUnavailable', message: err.message });
  }
});
