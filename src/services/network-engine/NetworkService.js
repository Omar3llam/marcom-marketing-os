// ============================================================
// NetworkService — gated, opt-in cross-account insights
// ============================================================
// Owns DB I/O + anonymization (the deterministic networkEngine never
// touches either). Sharing is OFF by default — a governance decision.
//
//   setConsent():        opt this workspace in/out. The cohort is assigned by
//   the server (see cohort.js) — it is never accepted from the caller.
//   getNetworkInsights(): if not consented → NOT_CONSENTED. Else aggregate
//   ONLY anonymized, ESTABLISHED+accurate patterns from OTHER consenting
//   workspaces in the same cohort, behind the engine's k-anonymity gate.
//   Other workspaces' raw rows never leave this service.
// ============================================================
import { createHash } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { aggregateNetwork }  from './networkEngine.js';
import { NETWORK_STATUS }    from './networkTypes.js';
import { assignCohort, cohortWhere, CohortUnavailableError } from './cohort.js';

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

/**
 * Opt a workspace in/out of the anonymized network.
 *
 * R11 (F12 · RU-5): takes NO cohort. The cohort is derived from the
 * workspace's own controlled attribute, so opting in cannot also be a request
 * to join a chosen population.
 *
 * Opting in with no assignable cohort REFUSES. Writing networkConsent=true
 * with cohortTag=null would record a consent the network can never honour, and
 * the workspace would then be told "NOT_CONSENTED" on every read — a consent
 * state contradicted by the row that stores it.
 *
 * Opting out clears the cohort: a cohort is a participation attribute, and a
 * workspace outside the network is not standing in a population.
 */
export async function setConsent(workspaceId, { optIn } = {}) {
  if (!workspaceId) throw new Error('setConsent: workspaceId required');

  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId }, select: { currency: true },
  });
  if (!ws) throw new Error('setConsent: workspace not found');

  const cohortTag = optIn ? assignCohort(ws) : null;
  if (optIn && !cohortTag) throw new CohortUnavailableError();

  return prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      networkConsent: !!optIn,
      consentedAt:    optIn ? new Date() : null,
      cohortTag,
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
    where: { id: workspaceId }, select: { networkConsent: true, currency: true },
  });
  if (!me?.networkConsent) return { status: NETWORK_STATUS.NOT_CONSENTED };

  // R11 (F12 · RU-5): the cohort is re-derived from the controlled attribute on
  // every read rather than read back from the stored `cohortTag` column. The
  // column is a label this service writes; the attribute is the fact. Deriving
  // it here means a stale or hand-edited label cannot place a workspace in a
  // population, however it got there.
  const cohortTag = assignCohort(me);
  const where = cohortWhere(me);
  if (!cohortTag || !where) {
    // Consented, but no cohort can be established. That is our problem to fix,
    // not a governance fact about the workspace — reporting NOT_CONSENTED here
    // would tell an account that opted in that it had not.
    logger.warn({ workspaceId }, '[NetworkService] consented workspace has no assignable cohort');
    return { status: NETWORK_STATUS.UNAVAILABLE };
  }

  // Only OTHER consenting workspaces in the same cohort contribute.
  //
  // R11 (F12 · RU-5): `id: { not: workspaceId }` is new. The aggregate used to
  // include the requesting workspace's own patterns, so part of what came back
  // as "across N consenting accounts" was that account's own history returned
  // to it as external corroboration — and with K peers it was up to 1/K of the
  // weight. That is a self-reinforcing loop, not a network finding: the reader
  // could not tell an independent signal from an echo, and downstream Planning
  // and Scenario surfaces consumed it as independent. Excluding self makes the
  // count honest — N now means N OTHERS — and K=5 becomes five other accounts.
  const peers = await prisma.workspace.findMany({
    where: { ...where, networkConsent: true, id: { not: workspaceId } },
    select: { id: true },
  });
  const patterns = await prisma.accountPattern.findMany({
    where: { workspaceId: { in: peers.map((p) => p.id) }, status: 'ESTABLISHED', accuracy: { not: null } },
    select: { workspaceId: true, kind: true, metric: true, threshold: true, accuracy: true, effectiveSupport: true },
  });

  const contributions = buildContributions(patterns, cohortTag);
  const insights = aggregateNetwork({ contributions, config });

  logger.info({ workspaceId, cohortTag, peers: peers.length, insights: insights.length }, '[NetworkService] aggregated');
  return { status: NETWORK_STATUS.OK, cohortTag, insights };
}
