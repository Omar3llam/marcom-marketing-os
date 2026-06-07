// ============================================================
// NetworkService — gated, opt-in cross-account insights
// ============================================================
// Owns DB I/O + anonymization (the deterministic networkEngine never
// touches either). Sharing is OFF by default — a governance decision.
//
//   setConsent():        opt this workspace in/out + set its cohort.
//   getNetworkInsights(): if not consented → NOT_CONSENTED. Else aggregate
//   ONLY anonymized, ESTABLISHED+accurate patterns from OTHER consenting
//   workspaces in the same cohort, behind the engine's k-anonymity gate.
//   Other workspaces' raw rows never leave this service.
// ============================================================
import { createHash } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { aggregateNetwork, NETWORK_STATUS } from './networkEngine.js';

// Opaque, non-reversible workspace token used ONLY to count distinct
// contributors for k-anonymity. Never returned to any caller.
function anonKey(workspaceId) {
  return createHash('sha256').update(`network:${workspaceId}`).digest('hex').slice(0, 16);
}

/**
 * Pure: turn consenting workspaces' ESTABLISHED patterns into anonymized
 * engine contributions (no workspaceId, weighted by effective support).
 * Exported for unit testing.
 */
export function buildContributions(patterns, cohortTag) {
  return patterns
    .filter((p) => p.status === 'ESTABLISHED' && p.accuracy != null && p.metric)
    .map((p) => ({
      cohortTag,
      workspaceKey: anonKey(p.workspaceId),   // opaque — distinct-count only
      kind: p.kind, metric: p.metric, threshold: p.threshold,
      accuracy: p.accuracy, weight: p.effectiveSupport || 1,
    }));
}

/** Opt a workspace in/out of the anonymized network. */
export async function setConsent(workspaceId, { optIn, cohortTag } = {}) {
  if (!workspaceId) throw new Error('setConsent: workspaceId required');
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      networkConsent: !!optIn,
      consentedAt:    optIn ? new Date() : null,
      ...(cohortTag !== undefined && { cohortTag }),
    },
    select: { id: true, networkConsent: true, cohortTag: true, consentedAt: true },
  });
}

/**
 * Gated network insights for a workspace.
 * @returns {Promise<{ status, cohortTag?, insights? }>}
 */
export async function getNetworkInsights(workspaceId, { config = {} } = {}) {
  if (!workspaceId) throw new Error('getNetworkInsights: workspaceId required');

  const me = await prisma.workspace.findUnique({
    where: { id: workspaceId }, select: { networkConsent: true, cohortTag: true },
  });
  if (!me?.networkConsent || !me.cohortTag) {
    return { status: NETWORK_STATUS.NOT_CONSENTED };
  }

  // Only consenting workspaces in the same cohort contribute.
  const peers = await prisma.workspace.findMany({
    where: { networkConsent: true, cohortTag: me.cohortTag }, select: { id: true },
  });
  const patterns = await prisma.accountPattern.findMany({
    where: { workspaceId: { in: peers.map((p) => p.id) }, status: 'ESTABLISHED', accuracy: { not: null } },
    select: { workspaceId: true, kind: true, metric: true, threshold: true, accuracy: true, effectiveSupport: true },
  });

  const contributions = buildContributions(patterns, me.cohortTag);
  const insights = aggregateNetwork({ contributions, config });

  logger.info({ workspaceId, cohortTag: me.cohortTag, peers: peers.length, insights: insights.length }, '[NetworkService] aggregated');
  return { status: NETWORK_STATUS.OK, cohortTag: me.cohortTag, insights };
}
