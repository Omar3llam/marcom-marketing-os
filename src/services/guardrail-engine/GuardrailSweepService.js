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
import { scopeFor } from '../decisions/decisionClassScope.js';
import { logger }              from '../../utils/logger.js';
import { evaluateGuardrails, GUARDRAIL_OUTCOME } from './guardrailEngine.js';
import { openHitKey }         from './guardrailHitIdentity.js';
import { fromMinor }           from '../../lib/money.js';
import { TEMPORAL }            from '../../config/temporal.js';
import { selectOperationalSnapshots } from '../evidence/index.js';
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import {
  toEvidenceReference, EVIDENCE_POPULATION, EVIDENCE_SELECTOR, EVIDENCE_REDUCTION,
} from '../verdict-engine/evidenceReference.js';

// Bounds MetricSnapshot.date — the SYNC timestamp. This sweep writes PROPOSED
// Decisions, so the distinction is load-bearing: "rows synced in the last 14
// days" is not "14 days of delivery", and each row's real period is whatever its
// sync requested. Value unchanged (14).
const SYNC_RECENCY_DAYS = TEMPORAL.guardrailSyncRecencyDays;

/**
 * R5 / I18: describe the evidence series a guardrail hit was evaluated over.
 *
 * TWO FACTS ARE HONESTLY UNESTABLISHED HERE, and both absences are the point.
 *
 *   The measured PERIOD. The operational population admits two of them, and this
 *   reader does not project the column that says which — so the key is omitted
 *   and the reference records "not established". Naming either would invent a
 *   measurement period out of a filter's allow-list.
 *
 *   `sources` — this projection has never selected `source`, so no contributing
 *   row carries one. `null` is "not captured", which the reference keeps
 *   distinct from `[]` ("there were none"). Widening the projection to fix that
 *   is a deliberate, test-visible change to a pinned select contract and belongs
 *   to whoever decides to make it, not to a provenance PR smuggling it in.
 *
 * Returns null when the series is missing entirely — a hit with nothing behind
 * it is not a thing this sweep can produce, and inventing an empty reference for
 * it would claim a read that did not happen.
 */
function guardrailEvidenceReference(entityWindow) {
  const series = entityWindow?.series;
  if (!Array.isArray(series) || series.length === 0) return null;
  try {
    return toEvidenceReference({
      population: EVIDENCE_POPULATION.OPERATIONAL,
      selector:   EVIDENCE_SELECTOR.OPERATIONAL,
      reduction:  EVIDENCE_REDUCTION.SERIES,
      // Every row in the window CONTRIBUTED — a guardrail evaluates the series,
      // it does not reduce it to a winner. So rowCount and the contributing rows
      // agree here, which they deliberately do not on a latest-per-entity read.
      rowCount:          series.length,
      rows: series.map((p) => ({
        entityId:   entityWindow.entityId,
        source:     null,
        observedAt: p.date, // the evidence row's own observation timestamp
      })),
    });
  } catch (err) {
    logger.warn({ err: err.message, entityId: entityWindow?.entityId }, '[GuardrailSweep] evidence reference not recorded');
    return null;
  }
}

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
 * @returns {Promise<{ rules:number, hits:number, decisionsCreated:number, episodesClosed:number }>}
 */
export async function sweepGuardrails(workspaceId) {
  if (!workspaceId) throw new Error('sweepGuardrails: workspaceId required');

  const rules = await prisma.guardrailRule.findMany({ where: { workspaceId, enabled: true } });
  // No enabled rules is NOT EVALUATED for every pair — nothing is closed here.
  if (rules.length === 0) return { rules: 0, hits: 0, decisionsCreated: 0, episodesClosed: 0 };

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

  const { hits, evaluated } = evaluateGuardrails({ rules, entities });

  // ── C-02 · episodes, not rows ──────────────────────────────────────────────
  // `evaluated` holds only the (rule, entity) pairs this pass reached a
  // conclusion about. A pair absent from it was never judged — a disabled rule,
  // an entity that fell out of the sync window, an out-of-scope level — and its
  // open episode must survive untouched. That absence is load-bearing: treating
  // it as an all-clear would let switching a rule off close every breach it was
  // holding, and an ingest gap read as "the problem went away".
  const evaluatedKeys = evaluated
    .map((e) => ({ ...e, key: openHitKey(e) }))
    .filter((e) => e.key !== null);

  // Which of the pairs we JUDGED already have an episode running. Scoped to this
  // pass's keys rather than reading every open episode in the workspace: pairs we
  // did not judge are not our business this sweep.
  const openByKey = new Map(
    evaluatedKeys.length === 0 ? [] : (await prisma.decision.findMany({
      where:  { workspaceId, ...scopeFor('guardrail/open-episodes'), openHitKey: { in: evaluatedKeys.map((e) => e.key) } },
      select: { id: true, openHitKey: true },
    })).map((d) => [d.openHitKey, d.id]),
  );

  // A pair we judged CLEAR whose episode is running: the breach ended.
  const closingIds = evaluatedKeys
    .filter((e) => e.outcome === GUARDRAIL_OUTCOME.CLEAR && openByKey.has(e.key))
    .map((e) => openByKey.get(e.key));

  // Record each NEW hit as a PROPOSED Decision (radar verdict, human confirms).
  // Single batched write — never an N+1 create loop.
  const decisionRows = hits.map((hit) => ({
    workspaceId,
    entityId:    hit.entityId,
    entityLevel: hit.entityLevel,
    verdict:     hit.verdict,
    confidence:  0.9, // guardrail rules are user-asserted policy
    diagnosis:   hit.rationale,
    rootCause:   `guardrail:${hit.ruleName}`,
    // C-10 — the KIND of row, as a token. `rootCause` above still carries the
    // display string every current consumer matches on; this is what anything
    // may scope by, and what stops three separate modules parsing that prefix.
    decisionClass: DECISION_CLASS.GUARDRAIL,
    status:      'PROPOSED',
    // The stable identity. `rootCause` above keeps the display string every
    // current consumer still matches on; this is what anything may key off.
    guardrailRuleId: hit.ruleId ?? null,
    openHitKey:      openHitKey(hit),
    // R5 / I18 — the SERIES this rule fired on, described rather than copied.
    // A guardrail decision is the sharpest multi-row case in the product: an
    // entity's whole window of observations is evaluated and what survived was
    // one rationale string. rowCount is the length of that series, so a stored
    // hit can no longer imply it came from a single reading.
    evidenceReference: guardrailEvidenceReference(byEntity.get(`${hit.entityId}:${hit.entityLevel}`)),
  }));

  // Only hits whose episode is not already running. A hit with no key cannot be
  // deduplicated, so it is written — unidentifiable is not a reason to drop a
  // breach, and the null key is exempt from the unique index by construction.
  const openingRows = decisionRows.filter((row) => row.openHitKey === null || !openByKey.has(row.openHitKey));

  // One transaction. A close and an open can land on the SAME (rule, entity) in
  // one pass only across different rules, but the two writes are still one
  // statement about what this sweep concluded, and a partial application would
  // leave an episode both closed and re-opened — or neither.
  if (closingIds.length > 0 || openingRows.length > 0) {
    await prisma.$transaction([
      ...(closingIds.length > 0 ? [prisma.decision.updateMany({
        where: { id: { in: closingIds } },
        data: {
          status:     'RESOLVED',
          resolvedAt: new Date(),
          // C-05 — WHY it ended. A revoked rule now closes episodes too, and
          // `RESOLVED + resolvedAt + openHitKey NULL` describes both endings
          // identically. Stating the reason here is what keeps a NULL meaning
          // "written before this column existed" instead of quietly meaning
          // "the condition cleared".
          closureReason: 'CONDITION_CLEARED',
          // `resolution` is deliberately NOT written here, and no substitute for
          // it belongs in this slice. Closing an episode says the breach ended;
          // it does not claim the outcome was good. Nor would the claim stay
          // decorative: `decisionLearning` admits a row on `resolution IS NOT
          // NULL` + INTERVENED_WHERE, so setting one would enrol every executed
          // Guardrail decision into institutional memory — a population that
          // has an owner, and it is not this sweep. Guardrail lifecycle is not
          // outcome semantics.
          // Closing the episode IS releasing the key. Any number of closed
          // episodes coexist because PostgreSQL exempts NULL from the unique
          // index, so the same breach returning opens a genuinely new row.
          openHitKey: null,
        },
      })] : []),
      ...(openingRows.length > 0 ? [prisma.decision.createMany({
        data: openingRows,
        // Backstop, not the mechanism. `openByKey` is read before the write, so
        // two sweeps racing on one workspace could both see no episode; the
        // unique index rejects the loser and this keeps that a no-op rather than
        // a failed sweep. The filter above is what makes the intent explicit.
        skipDuplicates: true,
      })] : []),
    ]);
  }

  const decisionsCreated = openingRows.length;
  const episodesClosed   = closingIds.length;
  logger.info(
    {
      workspaceId, rules: rules.length, hits: hits.length,
      evaluated: evaluatedKeys.length, decisionsCreated, episodesClosed,
      // Hits suppressed because their episode was already running. Logged
      // because it is the number that proves this sweep stopped duplicating.
      alreadyOpen: decisionRows.length - openingRows.length,
    },
    '[GuardrailSweep] complete',
  );
  return {
    rules: rules.length, hits: hits.length, decisionsCreated, episodesClosed,
  };
}
