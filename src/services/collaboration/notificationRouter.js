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

// C-16 — an UNRANKED alert sorts between LOW and MEDIUM: visible without
// claiming urgency, and never sorted to the floor, because "we could not rank
// this" is not "this barely matters".
const UNRANKED_RANK = 0.5;
const rankOf = (s) => (s == null ? UNRANKED_RANK : SEVERITY_RANK[s] ?? UNRANKED_RANK);

/**
 * A radar alert's severity, derived from the Decision's confidence.
 *
 * C-16 — null when nothing was measured. `decisions.confidence` used to be NOT
 * NULL, so a bare `confidence >= 0.6` could not meet an absence; now it can,
 * and `null >= 0.6` is false — which would have published a call Lumi never
 * scored as a real LOW. The alert is still delivered; we simply do not claim a
 * severity we did not compute.
 */
export function radarSeverity(confidence) {
  if (!Number.isFinite(confidence)) return null;
  if (confidence >= 0.85) return SEVERITY.HIGH;
  if (confidence >= 0.6) return SEVERITY.MEDIUM;
  return SEVERITY.LOW;
}

function normalizeSeverity(s) {
  // C-16 — an ABSENT severity stays absent. The old `?? SEVERITY.MEDIUM`
  // invented a middle band for an alert nobody had ranked. An unrecognised
  // STRING is a different question — a malformed value, not an absence — and
  // still normalises to MEDIUM.
  if (s == null) return null;
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
    .sort((a, b) => rankOf(b.severity) - rankOf(a.severity));
}

/** Count of routed alerts by severity — for a compact feed badge. */
export function severityCounts(routed = []) {
  const counts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  // C-16 — an unranked alert is counted in no band. A `null` key would put a
  // fabricated bucket on the badge; folding it into LOW or MEDIUM would be the
  // same invention one layer up.
  for (const a of routed) if (a.severity != null) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
  return counts;
}

export { WORKSPACE_ROLE };
