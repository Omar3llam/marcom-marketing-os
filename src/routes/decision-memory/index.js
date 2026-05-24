// ============================================================
// GET /api/decision-memory/recent
// ============================================================
// Returns the last 20 strategic decision memory rows for the
// authenticated workspace, reverse-chronological.
//
// Purpose: prove memory exists. Not intelligence.
// Filtering, ranking, and retrieval UX are downstream concerns.
// ============================================================
import { Router }                  from 'express';
import { firebaseAuthMiddleware }  from '../../middleware/firebaseAuth.js';
import { contextGuard }            from '../../middleware/contextGuard.js';
import { decisionMemoryService }   from '../../services/decision-memory/index.js';
import { logger }                  from '../../utils/logger.js';

const router = Router();

router.use(firebaseAuthMiddleware);
router.use(contextGuard);

router.get('/recent', async (req, res) => {
  const { workspaceId, userId } = req.user;

  try {
    const memories = await decisionMemoryService.getRecentMemories(workspaceId, 20);

    logger.debug({
      workspaceId,
      userId,
      count: memories.length,
    }, '[DecisionMemory] recent fetched');

    return res.json({ memories, count: memories.length });
  } catch (err) {
    logger.error({
      workspaceId,
      userId,
      error: err.message,
    }, '[DecisionMemory] recent fetch failed');

    return res.status(500).json({
      error: 'Failed to fetch decision memories',
      code:  'MEMORY_FETCH_ERROR',
    });
  }
});

export default router;
