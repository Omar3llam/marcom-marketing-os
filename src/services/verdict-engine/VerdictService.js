// ============================================================
// VerdictService — persistence wrapper for the verdict engine
// ============================================================
// Owns DB I/O (the deterministic verdictEngine never touches it).
// Walks an annotated entity tree (from rollupVerdicts) and records a
// Decision per entity level, appending to the verdict timeline only
// when a level's verdict changes (so the multi-level verdict graph is
// persisted and consistent with the rollup, without unbounded rows).
// ============================================================
import { prisma }         from '../../lib/prisma.js';
import { logger }         from '../../utils/logger.js';
import { rollupVerdicts } from './verdictEngine.js';

async function persistNode(workspaceId, node, created) {
  // Only persist real entity ids (uuids); skip synthetic roots.
  if (node.id && node.level) {
    const latest = await prisma.decision.findFirst({
      where:   { workspaceId, entityId: node.id, entityLevel: node.level },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest || latest.verdict !== node.verdict) {
      await prisma.decision.create({
        data: {
          workspaceId,
          entityId:    node.id,
          entityLevel: node.level,
          verdict:     node.verdict,
          confidence:  node.verdictConfidence ?? 0.5,
          diagnosis:   node.rationale ?? '',
          rootCause:   node.signalType ?? null,
          status:      'PROPOSED',
        },
      });
      created.push({ entityId: node.id, level: node.level, verdict: node.verdict });
    }
  }
  for (const child of node.children ?? []) {
    await persistNode(workspaceId, child, created);
  }
}

/**
 * Evaluate + persist multi-level verdicts for an entity tree.
 * @param {string} workspaceId
 * @param {object} entityTree — Account/Campaign tree with leaf metrics
 * @param {object} [opts] — passed to rollupVerdicts (currency, guardrailHitsByEntity)
 * @returns {Promise<{ annotated:object, created:Array }>}
 */
export async function persistLevelVerdicts(workspaceId, entityTree, opts = {}) {
  if (!workspaceId) throw new Error('persistLevelVerdicts: workspaceId required');
  const annotated = rollupVerdicts(entityTree, opts);
  const created = [];
  await persistNode(workspaceId, annotated, created);
  logger.info({ workspaceId, decisions: created.length }, '[VerdictService] level verdicts persisted');
  return { annotated, created };
}
