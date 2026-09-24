// ============================================================
// InboxService — the role+severity inbox (read-only, no new table)
// ============================================================
// Notifications are NOT persisted as their own table or pushed by a worker.
// They are composed live for one role from three existing sources:
//   • alerts   — routed by notificationRouter over streams the caller passes
//                (pacing/radar/execution/goal already built by feed.js)
//   • narratives — the persisted StakeholderNarratives for the role's audience
//   • approvals  — PENDING ApprovalRequests the role can act on
//
// Pure routing (notificationRouter) + thin reads here. Leadership gets the
// narrative; buyers get execution; strategists get pacing/goal + approvals.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { routeByRole, severityCounts, ALERT_KIND } from './notificationRouter.js';
import { WORKSPACE_ROLE, normalizeRole } from './roleScope.js';

// The audience a role reads narratives as.
const AUDIENCE_BY_ROLE = Object.freeze({
  STRATEGIST: 'STRATEGIST',
  BUYER:      'BUYER',
  CLIENT:     'LEADERSHIP',
});

// Keep the failed source identifiable in server logs while the route publishes
// only its existing, safe InboxUnavailable response.
export async function readInboxSource(source, read) {
  try {
    return await read();
  } catch (cause) {
    const error = new Error(`Inbox ${source} read failed`, { cause });
    error.source = source;
    throw error;
  }
}

/**
 * Compose the inbox for a role. `alerts` are the live streams the caller
 * already has (feed.js); we route + tag them, attach the latest narrative,
 * and (for strategists) the pending approvals.
 *
 * @returns {Promise<{ role, alerts, severity, latestNarrative, pendingApprovals }>}
 */
export async function inboxFor(workspaceId, role, { alerts = [] } = {}) {
  if (!workspaceId) throw new Error('inboxFor: workspaceId required');
  const r = normalizeRole(role);

  const routed = routeByRole({ role: r, alerts });

  const [latestNarrative, pendingApprovals] = await Promise.all([
    readInboxSource('NARRATIVE', () => prisma.stakeholderNarrative.findFirst({
      where: { workspaceId, audience: AUDIENCE_BY_ROLE[r] },
      orderBy: { createdAt: 'desc' },
      select: { id: true, headline: true, period: true, confidenceScore: true, createdAt: true },
    })),
    r === WORKSPACE_ROLE.STRATEGIST
      ? readInboxSource('APPROVAL', () => prisma.approvalRequest.findMany({
          where: { workspaceId, state: 'PENDING' },
          orderBy: { createdAt: 'desc' }, take: 10,
        }))
      : Promise.resolve([]),
  ]);

  // A new narrative surfaces in the inbox as a NARRATIVE alert too.
  const withNarrativeAlert = latestNarrative
    ? routeByRole({ role: r, alerts: [...alerts, { kind: ALERT_KIND.NARRATIVE, severity: 'LOW', id: latestNarrative.id, headline: latestNarrative.headline }] })
    : routed;

  return {
    role: r,
    alerts: withNarrativeAlert,
    severity: severityCounts(withNarrativeAlert),
    latestNarrative,
    pendingApprovals,
  };
}
