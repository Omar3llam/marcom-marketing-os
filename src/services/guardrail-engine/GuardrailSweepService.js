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
import { TEMPORAL }            from '../../config/temporal.js';
import { selectOperationalSnapshots } from '../evidence/index.js';

// Bounds MetricSnapshot.date — the SYNC timestamp. This sweep writes PROPOSED
// Decisions, so the distinction is load-bearing: "rows synced in the last 14
// days" is not "14 days of delivery", and each row's real period is whatever its
// sync requested. Value unchanged (14).
const SYNC_RECENCY_DAYS = TEMPORAL.guardrailSyncRecencyDays;

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

  const since = new Date(Date.now() - SYNC_RECENCY_DAYS * 86_400_000);
  // R3: this service no longer knows how to find its evidence — it asks for it.
  // The operational population (workspace scope, the LEGACY_UNKNOWN/ROLLING_WINDOW
  // allow-list, and the sync-recency bound) is now stated once, in the Evidence
  // layer, instead of inline here.
  //
  // WHY OPERATIONAL AND NOT CANONICAL, still true and still the reason this
  // filter exists at all (Phase G): the loop below builds a per-entity TIME
  // SERIES with no per-day collapse, so a canonical row would land as a second
  // point at a date that already has one — a step change between two readings of
  // different periods that never happened, which is precisely what a guardrail
  // rule fires on. The hits become PROPOSED Decisions, so the cost is a
  // fabricated verdict.
  //
  // The projection stays HERE, named by the consumer that reads it:
  // valuesFromSnapshot uses exactly these six, plus the two grouping keys.
  const snapshots = await selectOperationalSnapshots(workspaceId, {
    since,
    select: {
      entityId: true, entityLevel: true, date: true,
      frequency: true, roas: true, ctr: true, cpaMinor: true, spendMinor: true, currency: true,
    },
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
