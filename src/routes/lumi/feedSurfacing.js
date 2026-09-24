// ============================================================
// feedSurfacing — best-effort feed enrichments (keeps feed.js lean)
// ============================================================
// Pulled out of feed.js so the route file stays under the arch-check budget.
// Each helper is best-effort: it returns null/empty on failure and never
// throws into the feed path.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { asKnownRole } from '../../services/collaboration/roleScope.js';

/**
 * Phase 8 — role-scoped collaboration surfacing: the latest narrative headline
 * for the caller's audience + (strategist) the pending-approval count.
 * @returns {Promise<{role, latestNarrative, pendingApprovals}|null>}
 */
export async function surfaceCollaboration(wsId, collabRole) {
  try {
    const role = asKnownRole(collabRole);
    // The feed itself is role-neutral; this enrichment is not. With no known
    // seat there is no audience or approval count to publish.
    if (!role) return null;
    const audience = role === 'CLIENT' ? 'LEADERSHIP' : role;
    const [latestNarrative, pendingApprovals] = await Promise.all([
      prisma.stakeholderNarrative.findFirst({
        where:   { workspaceId: wsId, audience },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, headline: true, period: true, confidenceScore: true },
      }),
      role === 'STRATEGIST'
        ? prisma.approvalRequest.count({ where: { workspaceId: wsId, state: 'PENDING' } })
        : Promise.resolve(0),
    ]);
    return {
      role,
      latestNarrative: latestNarrative
        ? { id: latestNarrative.id, headline: latestNarrative.headline, period: latestNarrative.period, confidence: latestNarrative.confidenceScore }
        : null,
      pendingApprovals,
    };
  } catch (err) {
    logger.debug({ err: err.message, wsId }, '[lumi/feed] collaboration best-effort skipped');
    return null;
  }
}
