// ============================================================
// MARCOM / Lumi — Agentic OS (Phase 9)
//   GET  /api/lumi/home      — the unified two-band home + loop status
//   GET  /api/lumi/loop      — loop state (last/next run, stage status)
//   POST /api/lumi/loop/run  — manual steer: re-run the sweep (re-propose)
//
// Lumi initiates, the human confirms. The sweep only writes PROPOSED rows +
// a LoopRun audit — NEVER auto-executes. Proposals confirmed on the home flow
// through the existing /api/execute/meta governance.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getHome } from '../../services/agentic-loop/AgentHomeService.js';
import { runSweep, getLoopState } from '../../services/agentic-loop/AgenticLoopService.js';
import { resolveCollabRole } from '../../middleware/requireCollabRole.js';

export const agenticRouter = Router();

// Resolve workspaceId — mirrors lumi/measurement.js. Never fabricate a uuid.
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/agentic] workspaceId fallback failed');
    return null;
  }
}

async function need(req, res) {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) { res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' }); return null; }
  return wsId;
}

// ─────────────────────────────────────────────────────────────
// GET /home — buyer band + strategist band + loop status (role-aware)
// ─────────────────────────────────────────────────────────────
agenticRouter.get('/home', async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const role = await resolveCollabRole(req);
    const home = await getHome(wsId, role);
    return res.json({ workspaceId: wsId, generatedAt: new Date().toISOString(), ...home });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/agentic] home failed');
    return res.status(500).json({ error: 'HomeUnavailable', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /loop — loop state (last/next run, stage status, health)
// ─────────────────────────────────────────────────────────────
agenticRouter.get('/loop', async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    return res.json({ workspaceId: wsId, ...(await getLoopState(wsId)) });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/agentic] loop state failed');
    return res.status(500).json({ error: 'LoopStateUnavailable', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /loop/run — manual steer. Re-runs the sweep (re-proposes).
// Human-in-the-loop trigger — NEVER executes anything.
// ─────────────────────────────────────────────────────────────
agenticRouter.post('/loop/run', async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const result = await runSweep(wsId, { trigger: 'MANUAL', force: true });
    logger.info({ wsId, loopHealth: result.loopRun?.loopHealth }, '[lumi/agentic] manual sweep');
    return res.status(201).json({ workspaceId: wsId, loopRun: result.loopRun, agenda: result.agenda });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/agentic] manual sweep failed');
    return res.status(500).json({ error: 'SweepFailed', message: err.message });
  }
});
