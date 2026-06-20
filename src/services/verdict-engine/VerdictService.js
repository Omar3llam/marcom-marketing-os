// ============================================================
// VerdictService — persistence wrapper for the verdict engine
// ============================================================
// Owns DB I/O (the deterministic verdictEngine never touches it).
// Walks an annotated entity tree (from rollupVerdicts) and records a
// Decision per entity level, appending to the verdict timeline only
// when a level's verdict changes (so the multi-level verdict graph is
// persisted and consistent with the rollup, without unbounded rows).
// ============================================================
import { prisma }                  from '../../lib/prisma.js';
import { logger }                  from '../../utils/logger.js';
import { rollupVerdicts }          from './verdictEngine.js';
import { getConnectorCampaigns }   from '../entity-graph/index.js';
import { buildConnectorVerdictTree } from './connectorVerdictService.js';

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

/**
 * Read live connector campaigns, score them through the verdict engine, and
 * PERSIST the campaign-level verdicts as PROPOSED Decisions. This is the write
 * twin of connectorVerdictService.getConnectorVerdicts (which is deliberately
 * read-only): same tree, same engine, same revenue gate — only this path
 * commits rows. (connectorVerdictService stays pure; persistence lives here, per
 * its own contract comment.)
 *
 * Two correctness seams:
 *  - REVENUE GATE: buildConnectorVerdictTree drops campaigns with no measured
 *    revenue, so a workspace with no real revenue persists NOTHING (never a
 *    fabricated verdict) — tree is null and we no-op.
 *  - SYNTHETIC ROOT: that tree's ACCOUNT root is keyed by workspaceId (not a
 *    real entity), so we hand persistLevelVerdicts a ROOTLESS account node —
 *    only the real campaign children (entity-graph UUIDs) become Decision rows.
 *
 * Invoked from the agentic-loop sweep (cron / gated POST /loop/run /
 * rate-limited on-read) — never from a GET, never auto-executed (PROPOSED).
 *
 * @returns {Promise<{ created:Array, gatedOut:Array, status:string }>}
 */
export async function persistConnectorVerdicts(workspaceId) {
  if (!workspaceId) throw new Error('persistConnectorVerdicts: workspaceId required');
  const campaigns = await getConnectorCampaigns(workspaceId);
  const { tree, gatedOut } = buildConnectorVerdictTree(workspaceId, campaigns);
  if (!tree) {
    return { created: [], gatedOut, status: gatedOut.length ? 'NO_ELIGIBLE_CAMPAIGNS' : 'NO_CAMPAIGNS' };
  }
  const { created } = await persistLevelVerdicts(workspaceId, { level: 'ACCOUNT', children: tree.children });
  logger.info({ workspaceId, created: created.length, gatedOut: gatedOut.length }, '[VerdictService] connector verdicts persisted');
  return { created, gatedOut, status: 'OK' };
}
