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

// POST /api/memory/record
// Persists a decision memory row via the canonical service.
// Required body: executionId, decisionType, signalType, diagnosis,
//                actionTaken, outcome, confidence (0–1)
// Optional body: correlationId
router.post('/record', async (req, res) => {
  try {
    const { workspaceId, userId } = req.user;
    if (!workspaceId) return res.status(401).json({ error: 'Unauthenticated' });

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
    const { workspaceId } = req.user;
    if (!workspaceId) return res.status(401).json({ error: 'Unauthenticated' });

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
