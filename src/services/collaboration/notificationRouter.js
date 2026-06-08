// ============================================================
// notificationRouter — pure role+severity routing over EXISTING alerts
// ============================================================
// Phase 8 does NOT add a notification table or a worker. It routes the alert
// streams feed.js already builds (pacing, radar/execution, goal) plus the
// persisted narratives — by role and severity:
//   BUYER      ← execution / radar verdicts
//   STRATEGIST ← pacing / goal / radar
//   LEADERSHIP ← the weekly/monthly narrative
//
// Pure, deterministic, no DB. InboxService composes the live result.
// ============================================================
import { WORKSPACE_ROLE, normalizeRole } from './roleScope.js';

// The kinds of alert that flow through the system.
export const ALERT_KIND = Object.freeze({
  EXECUTION: 'EXECUTION', // an action executed / failed
  RADAR:     'RADAR',     // a radar verdict (Decision PROPOSED)
  PACING:    'PACING',    // budget pacing (P3)
  GOAL:      'GOAL',      // north-star pacing (P6)
  NARRATIVE: 'NARRATIVE', // a stakeholder narrative was generated
});

export const SEVERITY = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });

// Which alert kinds each role receives.
const KINDS_BY_ROLE = Object.freeze({
  STRATEGIST: [ALERT_KIND.PACING, ALERT_KIND.GOAL, ALERT_KIND.RADAR, ALERT_KIND.NARRATIVE],
  BUYER:      [ALERT_KIND.EXECUTION, ALERT_KIND.RADAR],
  CLIENT:     [ALERT_KIND.NARRATIVE],
});

const SEVERITY_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });

function normalizeSeverity(s) {
  const up = typeof s === 'string' ? s.toUpperCase() : '';
  return SEVERITY[up] ?? SEVERITY.MEDIUM;
}

/**
 * Filter + severity-tag a stream of alerts for one role, highest severity
 * first. Pure: operates only on the objects passed in.
 *
 * @param {{ role:string, alerts:Array<{kind, severity?, ...}> }} args
 * @returns {Array<object>} the role's alerts, severity-normalized + sorted
 */
export function routeByRole({ role, alerts = [] } = {}) {
  const allowed = new Set(KINDS_BY_ROLE[normalizeRole(role)] ?? KINDS_BY_ROLE.STRATEGIST);
  return alerts
    .filter((a) => a && allowed.has(a.kind))
    .map((a) => ({ ...a, severity: normalizeSeverity(a.severity) }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

/** Count of routed alerts by severity — for a compact feed badge. */
export function severityCounts(routed = []) {
  const counts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const a of routed) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
  return counts;
}

export { WORKSPACE_ROLE };
