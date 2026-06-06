// ============================================================
// GuardrailSweepService — persistence wrapper for the engine
// ============================================================
// Owns DB I/O (the deterministic guardrailEngine never touches it).
// Each sweep: load enabled rules → build per-entity windows from
// recent MetricSnapshots → evaluate → record each hit as a Decision
// (status PROPOSED). A guardrail NEVER auto-executes: the PROPOSED
// Decision is a radar verdict the human confirms, which then flows
// through the existing /api/execute/meta governance.
// ============================================================
import { prisma }              from '../../lib/prisma.js';
import { logger }              from '../../utils/logger.js';
import { evaluateGuardrails }  from './guardrailEngine.js';
import { fromMinor }           from '../../lib/money.js';

const LOOKBACK_DAYS = Number(process.env.GUARDRAIL_LOOKBACK_DAYS || 14);

/**
 * Derive the metric values a rule can reference from a snapshot.
 * Money stays in minor units; ratios pass through.
 */
function valuesFromSnapshot(s) {
  return {
    frequency:   s.frequency ?? 0,
    roas:        s.roas ?? 0,
    ctr:         s.ctr ?? 0,
    cpaMinor:    s.cpaMinor ?? 0,
    spendMinor:  s.spendMinor ?? 0,
    cpa:         s.cpaMinor != null ? fromMinor(s.cpaMinor, s.currency || 'USD') : 0,
  };
}

/**
 * Run the guardrail sweep for one workspace.
 * @returns {Promise<{ rules:number, hits:number, decisionsCreated:number }>}
 */
export async function sweepGuardrails(workspaceId) {
  if (!workspaceId) throw new Error('sweepGuardrails: workspaceId required');

  const rules = await prisma.guardrailRule.findMany({ where: { workspaceId, enabled: true } });
  if (rules.length === 0) return { rules: 0, hits: 0, decisionsCreated: 0 };

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const snapshots = await prisma.metricSnapshot.findMany({
    where:   { workspaceId, date: { gte: since } },
    orderBy: { date: 'asc' },
  });

  // Group snapshots into per-entity time-series windows.
  const byEntity = new Map();
  for (const s of snapshots) {
    const key = `${s.entityId}:${s.entityLevel}`;
    if (!byEntity.has(key)) {
      byEntity.set(key, { entityId: s.entityId, entityLevel: s.entityLevel, audienceTag: null, series: [] });
    }
    byEntity.get(key).series.push({ date: s.date, values: valuesFromSnapshot(s) });
  }
  const entities = [...byEntity.values()];

  const hits = evaluateGuardrails({ rules, entities });

  // Record each hit as a PROPOSED Decision (radar verdict, human confirms).
  // Single batched write — never an N+1 create loop.
  const decisionRows = hits.map((hit) => ({
    workspaceId,
    entityId:    hit.entityId,
    entityLevel: hit.entityLevel,
    verdict:     hit.verdict,
    confidence:  0.9, // guardrail rules are user-asserted policy
    diagnosis:   hit.rationale,
    rootCause:   `guardrail:${hit.ruleName}`,
    status:      'PROPOSED',
  }));
  if (decisionRows.length > 0) {
    await prisma.decision.createMany({ data: decisionRows });
  }

  const decisionsCreated = decisionRows.length;
  logger.info({ workspaceId, rules: rules.length, hits: hits.length, decisionsCreated },
    '[GuardrailSweep] complete');
  return { rules: rules.length, hits: hits.length, decisionsCreated };
}
