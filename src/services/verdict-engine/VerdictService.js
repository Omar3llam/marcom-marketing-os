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
import { SIGNAL_TYPE }             from '../diagnosis-engine/index.js';

// The rootCauses persistConnectorVerdicts writes: a diagnosis signalType, or
// null when the engine set none (persistNode: `node.signalType ?? null`).
// Guardrail / allocation / test / incrementality decisions all use their own
// non-null prefixes, so this set + null identifies connector verdicts exactly.
const CONNECTOR_ROOT_CAUSES = Object.freeze(Object.values(SIGNAL_TYPE));

async function persistNode(workspaceId, node, created) {
  // Only persist real entity ids (uuids); skip synthetic roots.
  if (node.id && node.level) {
    const latest = await prisma.decision.findFirst({
      // Compare against the latest ACTIVE verdict (PROPOSED or EXECUTED). A row we
      // SUPERSEDED (a campaign that had dropped out of the eligible set, below)
      // must NOT block a fresh PROPOSED when the campaign re-enters with the same
      // verdict — otherwise it would silently vanish from the agenda.
      where:   { workspaceId, entityId: node.id, entityLevel: node.level, status: { not: 'SUPERSEDED' } },
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
 * Resolve STALE connector verdicts. persistNode only ever appends (a campaign
 * that flips verdicts leaves a timeline) and only for campaigns in the CURRENT
 * eligible set — so a campaign that drops below the revenue/engagement gate, or
 * is deleted, would keep its last PROPOSED verdict forever and go on inflating
 * the agenda (buyer band = latest PROPOSED verdict per entity). Each sweep we
 * mark those orphaned verdicts SUPERSEDED so the agenda reflects only currently
 * eligible campaigns.
 *
 * Scope is EXACT: campaign-level PROPOSED decisions whose rootCause is a diagnosis
 * signalType or null — i.e. connector verdicts only. Guardrail / allocation /
 * test / incrementality decisions (own non-null prefixes) are never touched.
 *
 * @param {string} workspaceId
 * @param {string[]} eligibleIds — entityIds scored THIS sweep (kept as-is)
 * @returns {Promise<number>} rows superseded
 */
async function supersedeDroppedConnectorVerdicts(workspaceId, eligibleIds) {
  const where = {
    workspaceId,
    status:      'PROPOSED',
    entityLevel: 'CAMPAIGN',
    OR: [{ rootCause: { in: CONNECTOR_ROOT_CAUSES } }, { rootCause: null }],
  };
  // Empty eligible set ⇒ nothing is current (whole account went dataless) ⇒
  // supersede EVERY connector verdict. Omit the entityId filter entirely —
  // Prisma treats `notIn: []` inconsistently across versions.
  if (eligibleIds.length) where.entityId = { notIn: eligibleIds };
  const { count } = await prisma.decision.updateMany({ where, data: { status: 'SUPERSEDED' } });
  if (count) logger.info({ workspaceId, superseded: count }, '[VerdictService] stale connector verdicts superseded');
  return count;
}

/**
 * Read live connector campaigns, score them through the verdict engine, and
 * PERSIST the campaign-level verdicts as PROPOSED Decisions. This is the write
 * twin of connectorVerdictService.getConnectorVerdicts (which is deliberately
 * read-only): same tree, same engine, same revenue gate — only this path
 * commits rows. (connectorVerdictService stays pure; persistence lives here, per
 * its own contract comment.)
 *
 * Three correctness seams:
 *  - REVENUE GATE: buildConnectorVerdictTree drops campaigns with no measured
 *    revenue, so a workspace with no real revenue persists NOTHING (never a
 *    fabricated verdict) — tree is null and we write no new rows.
 *  - SYNTHETIC ROOT: that tree's ACCOUNT root is keyed by workspaceId (not a
 *    real entity), so we hand persistLevelVerdicts a ROOTLESS account node —
 *    only the real campaign children (entity-graph UUIDs) become Decision rows.
 *  - STALE PRUNE: verdicts for entities NOT in this sweep's eligible set are
 *    superseded (runs even when nothing is eligible) so the agenda never carries
 *    a verdict for a campaign that no longer qualifies or no longer exists.
 *
 * Invoked from the agentic-loop sweep (cron / gated POST /loop/run /
 * rate-limited on-read) — never from a GET, never auto-executed (PROPOSED).
 *
 * @returns {Promise<{ created:Array, gatedOut:Array, superseded:number, status:string }>}
 */
export async function persistConnectorVerdicts(workspaceId) {
  if (!workspaceId) throw new Error('persistConnectorVerdicts: workspaceId required');
  const campaigns = await getConnectorCampaigns(workspaceId);
  const { tree, gatedOut } = buildConnectorVerdictTree(workspaceId, campaigns);
  const eligibleIds = tree ? tree.children.map((c) => c.id) : [];

  // Prune stale verdicts BEFORE (and regardless of) this sweep's writes — a
  // campaign that lost eligibility, or the whole account going dataless, must
  // not leave a lingering PROPOSED verdict behind.
  const superseded = await supersedeDroppedConnectorVerdicts(workspaceId, eligibleIds);

  if (!tree) {
    return { created: [], gatedOut, superseded, status: gatedOut.length ? 'NO_ELIGIBLE_CAMPAIGNS' : 'NO_CAMPAIGNS' };
  }
  const { created } = await persistLevelVerdicts(workspaceId, { level: 'ACCOUNT', children: tree.children });
  logger.info({ workspaceId, created: created.length, gatedOut: gatedOut.length, superseded }, '[VerdictService] connector verdicts persisted');
  return { created, gatedOut, superseded, status: 'OK' };
}
