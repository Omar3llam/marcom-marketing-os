import { describe, it, expect } from 'vitest';
import { routeByRole, severityCounts, ALERT_KIND, WORKSPACE_ROLE } from './notificationRouter.js';

const alerts = [
  { kind: ALERT_KIND.EXECUTION, severity: 'high', id: 'e1' },
  { kind: ALERT_KIND.PACING, severity: 'medium', id: 'p1' },
  { kind: ALERT_KIND.GOAL, severity: 'low', id: 'g1' },
  { kind: ALERT_KIND.NARRATIVE, severity: 'low', id: 'n1' },
  { kind: ALERT_KIND.RADAR, severity: 'critical', id: 'r1' },
];

describe('notificationRouter', () => {
  it('routes execution + radar to BUYER, not pacing/goal/narrative', () => {
    const routed = routeByRole({ role: WORKSPACE_ROLE.BUYER, alerts });
    const kinds = routed.map((a) => a.kind);
    expect(kinds).toContain(ALERT_KIND.EXECUTION);
    expect(kinds).toContain(ALERT_KIND.RADAR);
    expect(kinds).not.toContain(ALERT_KIND.PACING);
    expect(kinds).not.toContain(ALERT_KIND.NARRATIVE);
  });

  it('routes pacing/goal/radar/narrative to STRATEGIST, not raw execution', () => {
    const routed = routeByRole({ role: WORKSPACE_ROLE.STRATEGIST, alerts });
    const kinds = routed.map((a) => a.kind);
    expect(kinds).toContain(ALERT_KIND.PACING);
    expect(kinds).toContain(ALERT_KIND.GOAL);
    expect(kinds).not.toContain(ALERT_KIND.EXECUTION);
  });

  it('routes only the narrative to CLIENT/leadership', () => {
    const routed = routeByRole({ role: WORKSPACE_ROLE.CLIENT, alerts });
    expect(routed.map((a) => a.kind)).toEqual([ALERT_KIND.NARRATIVE]);
  });

  it('normalizes severity and sorts highest-first', () => {
    const routed = routeByRole({ role: WORKSPACE_ROLE.STRATEGIST, alerts });
    expect(routed[0].severity).toBe('CRITICAL'); // the radar one
    for (let i = 1; i < routed.length; i++) {
      const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
      expect(rank[routed[i - 1].severity]).toBeGreaterThanOrEqual(rank[routed[i].severity]);
    }
  });

  it('severityCounts tallies by bucket', () => {
    const routed = routeByRole({ role: WORKSPACE_ROLE.STRATEGIST, alerts });
    const counts = severityCounts(routed);
    expect(counts.CRITICAL).toBe(1);
    expect(counts.MEDIUM).toBe(1);
  });
});
