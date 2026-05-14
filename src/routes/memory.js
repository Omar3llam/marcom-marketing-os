import { Router }  from 'express';
import { prisma }  from '../lib/prisma.js';
import { logger }  from '../utils/logger.js';

const router = Router();

// POST /api/memory/record
// Called after every committed decision to persist it with outcome metadata
router.post('/record', async (req, res) => {
  try {
    const { workspaceId } = req;
    if (!workspaceId) return res.status(401).json({ error: 'Unauthenticated' });

    const {
      campaignId,
      actionType,
      decisionRationale,
      resultStatus = 'PENDING',
      deltaCtr     = null,
      deltaRoas    = null,
    } = req.body;

    if (!campaignId || !actionType || !decisionRationale) {
      return res.status(400).json({
        error: 'campaignId, actionType, and decisionRationale are required',
      });
    }

    const record = await prisma.decisionMemory.create({
      data: {
        campaignId,
        workspaceId,
        actionType,
        decisionRationale,
        resultStatus,
        deltaCtr,
        deltaRoas,
      },
    });

    logger.info({ id: record.id, campaignId }, '[memory] decision recorded');
    res.status(201).json({ success: true, id: record.id });

  } catch (err) {
    logger.error({ err: err.message }, '[memory] record failed');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/memory/patterns
// Returns semantic memory patterns for the CMO — "what worked before"
router.get('/patterns', async (req, res) => {
  try {
    const { workspaceId } = req;
    if (!workspaceId) return res.status(401).json({ error: 'Unauthenticated' });

    const memories = await prisma.decisionMemory.findMany({
      where:   { workspaceId },
      orderBy: { recordedAt: 'desc' },
      take:    50,
    });

    // Group by actionType and compute pattern stats
    const byAction = {};
    for (const m of memories) {
      if (!byAction[m.actionType]) {
        byAction[m.actionType] = { count: 0, avgDeltaRoas: 0, sustainable: 0, total: 0 };
      }
      const g = byAction[m.actionType];
      g.count++;
      if (m.deltaRoas !== null) { g.avgDeltaRoas += m.deltaRoas; g.total++; }
      if (m.isSustainable === true) g.sustainable++;
    }

    const patterns = Object.entries(byAction).map(([action, stats]) => ({
      action,
      count: stats.count,
      avgDeltaRoas: stats.total > 0
        ? Math.round((stats.avgDeltaRoas / stats.total) * 100) / 100
        : null,
      sustainableRate: stats.count > 0
        ? Math.round((stats.sustainable / stats.count) * 100)
        : 0,
    }));

    // Recent narrative lines for CMO display
    const narratives = memories.slice(0, 5).map(m => ({
      id:       m.id,
      line:     `${m.actionType} on ${m.campaignId.slice(-8)} — ${m.decisionRationale.slice(0, 80)}`,
      roas:     m.deltaRoas,
      recorded: m.recordedAt,
    }));

    res.json({ patterns, narratives, total: memories.length });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
