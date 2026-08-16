// ============================================================
// Shell — recent decisions (R7)
// ============================================================
// Reads the CANONICAL decision spine. What this replaced deserves recording,
// because it is the exact failure R7 exists to remove: the sidebar called
// /api/memory/patterns, which rendered legacy DecisionMemory rows into a
// display string, and this file parsed a verdict back out of that string —
//
//   if (line.includes('KILL')) return 'KILL';  … else return 'TEST';
//
// so a row mentioning none of the keywords was shown to the user as TEST, a
// verdict no engine ever issued. The "campaign name" was the first segment of
// the same string, which was the decisionType, not a campaign.
//
// Every field below now comes off a real Decision row. Nothing is derived from
// prose, and nothing is invented when a field is absent.
// ============================================================
import { api } from '@/api/client';

/**
 * Recent decisions for the sidebar, newest first.
 *
 * Shapes the server rows for the renderer and does no more: no defaulting, no
 * inference, no reconstruction. `campaign` stays null when the server could not
 * name the entity, and `timestamp` stays null when there is no date — the
 * renderer shows an honest gap rather than a plausible-looking one.
 */
export async function fetchRecentDecisions() {
  const response = await api.get('/api/lumi/decisions/recent');
  const decisions = response.data?.decisions || [];
  return decisions.map(toSidebarDecision);
}

/** PURE: server row → the four fields RecentDecisions renders. */
export function toSidebarDecision(decision) {
  return {
    id:        decision?.id ?? null,
    // Null propagates. An unnamed entity is not a campaign called "Unknown".
    campaign:  decision?.campaign ?? null,
    // The engine's verdict, straight off the row. No keyword matching, and no
    // fallback — an absent verdict renders as absent.
    verdict:   decision?.verdict ?? null,
    timestamp: formatRelativeTimestamp(decision?.decidedAt),
  };
}

/**
 * PURE: a real timestamp as relative text, or null.
 *
 * Returns null — not 'recent' — for a missing or unparseable date. "recent" is
 * a claim about when something happened, and this function would have been
 * making it on the strength of no data at all.
 */
function formatRelativeTimestamp(date) {
  if (!date) return null;

  const then = new Date(date);
  const diffMs = Date.now() - then.getTime();
  if (!Number.isFinite(diffMs)) return null;

  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs  = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24)  return `${diffHrs}h ago`;
  return `${diffDays}d ago`;
}
