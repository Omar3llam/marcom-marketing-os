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
import { needWorkspace as need } from '../../lib/workspaceResolution.js';
import { requireWorkspace } from '../../middleware/requireWorkspace.js';
import { logger } from '../../utils/logger.js';
import { getHome } from '../../services/agentic-loop/AgentHomeService.js';
import { runSweep, getLoopState } from '../../services/agentic-loop/AgenticLoopService.js';
import { requireResolvedCollabRole, requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';

export const agenticRouter = Router();
agenticRouter.use(['/home', '/loop'], requireWorkspace);

// ─────────────────────────────────────────────────────────────
// GET /home — buyer band + strategist band + loop status (role-aware)
// ─────────────────────────────────────────────────────────────
agenticRouter.get('/home', requireResolvedCollabRole, async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const home = await getHome(wsId, req.collabRole);
    return res.json({ workspaceId: wsId, generatedAt: new Date().toISOString(), ...home });
  } catch (err) {
    logger.error({ err: err.message, source: err.source ?? null, wsId }, '[lumi/agentic] home failed');
    return res.status(500).json({ error: 'HomeUnavailable', message: 'Request failed' });
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
    return res.status(500).json({ error: 'LoopStateUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /loop/run — manual steer. Re-runs the sweep (re-proposes).
// Human-in-the-loop trigger — NEVER executes anything.
// ─────────────────────────────────────────────────────────────
// Manually steering the loop (re-propose sweep) is an operator action — a
// CLIENT seat is read-only and must not trigger it.
agenticRouter.post('/loop/run', requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST), async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const result = await runSweep(wsId, { trigger: 'MANUAL', force: true });
    logger.info({ wsId, loopHealth: result.loopRun?.loopHealth }, '[lumi/agentic] manual sweep');
    return res.status(201).json({ workspaceId: wsId, loopRun: result.loopRun, agenda: result.agenda });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/agentic] manual sweep failed');
    return res.status(500).json({ error: 'SweepFailed', message: 'Request failed' });
  }
});
