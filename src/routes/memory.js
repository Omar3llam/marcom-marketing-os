// ============================================================
// /api/memory — Legacy decision memory routes
// ============================================================
// POST /api/memory/record   → thin wrapper over DecisionMemoryService
// GET  /api/memory/patterns → aggregate stats over recent memory rows
//
// NOTE: As of PR #20, the canonical write path is
// DecisionMemoryService.recordDecisionMemory().  This router
// remains for backward compatibility but delegates to the same
// service layer.
// ============================================================
import { Router }                 from 'express';
import { prisma }                 from '../lib/prisma.js';
import { logger }                 from '../utils/logger.js';
import { decisionMemoryService }  from '../services/decision-memory/index.js';

const router = Router();

/**
 * Resolve the caller's workspace UUID.
 *
 * firebaseAuthMiddleware normally sets req.workspaceId, but a transient DB
 * lookup miss can leave it null for a fully authenticated user. Fall back to a
 * direct lookup keyed on the Firebase uid (stored in the clerkId column).
 *
 * Returns null only when the user genuinely has no workspace — never throws.
 */
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({
      where:  { clerkId: req.userId },
      select: { workspaceId: true },
    });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[memory] workspaceId fallback lookup failed');
    return null;
  }
}

// POST /api/memory/record
// Persists a decision memory row via the canonical service.
// Required body: executionId, decisionType, signalType, diagnosis,
//                actionTaken, outcome, confidence (0–1)
// Optional body: correlationId
router.post('/record', async (req, res) => {
  try {
    const userId = req.userId;
    const workspaceId = await resolveWorkspaceId(req);
    // 403, not 401: the user is authenticated (requireAuth already passed);
    // they just have no resolvable workspace to write into.
    if (!workspaceId) {
      return res.status(403).json({
        error: 'Workspace not found.',
        hint:  'Complete onboarding to create your workspace.',
      });
    }

    const record = await decisionMemoryService.recordDecisionMemory({
      workspaceId,
      ...req.body,
    });

    logger.info({ id: record.id, workspaceId, userId }, '[memory] decision recorded');
    return res.status(201).json({ success: true, id: record.id });

  } catch (err) {
    const isValidation = err.message.includes('is required') ||
                         err.message.includes('must be a number');
    if (isValidation) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err: err.message }, '[memory] record failed');
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/memory/patterns
// Aggregates the last 50 memory rows into per-decisionType stats.
router.get('/patterns', async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    // No workspace → graceful empty result (the sidebar polls this 4x/load).
    // The user is authenticated; an empty pattern set is the correct answer,
    // never a 401.
    if (!workspaceId) {
      return res.json({ patterns: [], narratives: [], total: 0 });
    }

    const memories = await prisma.decisionMemory.findMany({
      where:   { workspaceId },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });

    const byDecisionType = {};
    for (const m of memories) {
      if (!byDecisionType[m.decisionType]) {
        byDecisionType[m.decisionType] = {
          count:         0,
          totalConfidence: 0,
          outcomeFreq:   {},
        };
      }
      const g = byDecisionType[m.decisionType];
      g.count++;
      g.totalConfidence += m.confidence;
      g.outcomeFreq[m.outcome] = (g.outcomeFreq[m.outcome] || 0) + 1;
    }

    const patterns = Object.entries(byDecisionType).map(([decisionType, stats]) => ({
      decisionType,
      count:          stats.count,
      avgConfidence:  stats.count > 0
        ? Math.round((stats.totalConfidence / stats.count) * 100) / 100
        : 0,
      outcomeFreq:    stats.outcomeFreq,
    }));

    const narratives = memories.slice(0, 5).map((m) => ({
      id:         m.id,
      line:       `${m.decisionType} — ${m.diagnosis.slice(0, 80)} → ${m.outcome}`,
      confidence: m.confidence,
      recorded:   m.createdAt,
    }));

    return res.json({ patterns, narratives, total: memories.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
