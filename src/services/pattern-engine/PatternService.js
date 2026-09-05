// ============================================================
// PatternService — persistence wrapper for the pattern engine
// ============================================================
// Owns DB I/O (the deterministic patternEngine never touches it).
//   getBriefing(): read the workspace's own history → extractPatterns →
//   persist AccountPattern rows (keyed by deterministic patternKey) +
//   their PatternObservation audit trail, then return the briefing.
//
// Writes are bounded (no N+1): explicit UUIDs let one createMany insert
// new patterns; a single $transaction(updates.map(...)) refreshes existing
// ones; one createMany({skipDuplicates}) appends new observations.
// ============================================================
import { randomUUID } from 'crypto';
import { prisma }      from '../../lib/prisma.js';
import { scopeFor } from '../decisions/decisionClassScope.js';
import { logger }      from '../../utils/logger.js';
import { selectOperationalSnapshots } from '../evidence/index.js';
import { CURRENT_OUTCOME_WHERE } from '../decision-accuracy/outcomeSelection.js';
import { evaluateDecisionSuccess } from '../decision-accuracy/decisionSuccess.js';
import { extractPatterns } from './patternEngine.js';
import { checksByPattern, replacementOf } from './patternHistory.js';
import { PATTERN_STATUS, isActionablePattern } from './patternTypes.js';
import { TEMPORAL }         from '../../config/temporal.js';
import { PROVENANCE_SELECT, INTERVENED_WHERE } from '../execution/decisionProvenance.js';


// Bounds MetricSnapshot.date — the SYNC timestamp, not a delivery horizon. A row
// written yesterday may hold a lifetime aggregate. Value unchanged (365).
const SYNC_RECENCY_DAYS = TEMPORAL.patternSyncRecencyDays;

/**
 * Pure: map prisma rows into the pattern engine's input arrays.
 * Exported for unit testing without a DB.
 */
export function buildPatternInputs({ decisions = [], outcomes = [], snapshots = [], tests = [], now = new Date() }) {
  // R10 (I53) — the canonical success evaluation happens HERE, at the seam,
  // mirroring how DecisionAccuracyService derives its engine input. The engine
  // stays pure and stops owning a definition of "right" that competed with
  // SUCCESS_PREDICATES.
  const outcomeByDecision = new Map(outcomes.map((o) => [o.decisionId, o]));

  return {
    decisions: decisions.map((d) => ({
      id: d.id, entityId: d.entityId, entityLevel: d.entityLevel,
      verdict: d.verdict, createdAt: d.createdAt,
    })),
    // One row per DECISION, not per outcome: a decision with no recorded result
    // still needs an entry, because UNMEASURED is a state the engine must see
    // rather than infer from an absent key.
    outcomes: decisions.map((d) => ({
      decisionId: d.id,
      success: evaluateDecisionSuccess(d, outcomeByDecision.get(d.id) ?? null, { now }),
    })),
    snapshots: snapshots.map((s) => ({
      entityId: s.entityId, date: s.date, frequency: s.frequency, roas: s.roas,
      ctr: s.ctr, spendMinor: s.spendMinor,
    })),
    tests: tests.map((t) => ({
      id: t.id, entityId: t.entityId, dimension: t.dimension, status: t.status,
      winnerLabel: t.winnerLabel, confidenceLabel: t.confidenceLabel,
      concludedAt: t.concludedAt, createdAt: t.createdAt,
    })),
  };
}

// Columns refreshed on every extraction (truth/recency move over time).
function dynamicFields(p) {
  return {
    statement: p.statement, basis: p.basis ?? null,
    support: p.support, effectiveSupport: p.effectiveSupport, accuracy: p.accuracy,
    confidence: p.confidence, status: p.status, threshold: p.threshold ?? null,
    lastObservedAt: p.lastObservedAt,
  };
}

/**
 * Extract + persist this workspace's patterns and return the briefing.
 *
 * ── R10 (Phase C) — THIS IS THE WRITE PATH, AND IT IS WORKER-OWNED ─────────
 * It used to be reached only one way: a human opening the Intelligence page,
 * which called GET /api/lumi/briefing, which called this. That made learning a
 * side effect of someone looking. A workspace nobody visited never learned; a
 * FREE or PRO workspace never learned at all, because the route is plan-gated to
 * GROWTH — so a UI entitlement silently decided whether an account's data was
 * processed. Institutional learning is not a page view.
 *
 * The scheduled sweep (learningSweep.js → maintenance queue) now drives this.
 * The route reads `readBriefing` instead, which touches no write path.
 *
 * The name is unchanged deliberately: it is the same operation with the same
 * contract, and renaming it would churn every existing test that pins this
 * behaviour for no gain in truth.
 *
 * @returns {Promise<{ patterns, promotableCount, conflicts }>}
 */
export async function getBriefing(workspaceId, { now = new Date(), lookbackDays = SYNC_RECENCY_DAYS } = {}) {
  if (!workspaceId) throw new Error('getBriefing: workspaceId required');
  const since = new Date(now.getTime() - lookbackDays * 86_400_000);

  const [decisions, snapshots, tests] = await Promise.all([
    // Explicit select, for the reason the MetricSnapshot read below already
    // documents — this one was the exception beside it. buildPatternInputs uses
    // exactly these five fields, and the two reasoning JSONB columns on Decision
    // would otherwise ride along on an unbounded lookback window that never
    // reads them.
    prisma.decision.findMany({
      // ── R10 (I52) — EXECUTED decisions only ──────────────────────
      // This was `{ workspaceId, createdAt: { gte: since } }`: every row, so a
      // proposal nobody touched and a call an operator explicitly REFUSED both
      // fed the same pattern support that decides ESTABLISHED. Learning was
      // counting things that never happened.
      //
      // Causal learning asks "what happened when the recommended intervention
      // was actually carried out", and only an execution timestamp answers that. Dismissals
      // remain in the PROOF population (DecisionAccuracyService.ACTIONED counts
      // them as survivorship) — the two engines ask different questions, and
      // this is the line where they legitimately differ.
      //
      // Deliberately the TIMESTAMP, not `status: 'EXECUTED'`: nothing in this
      // system writes that enum value, so a status filter would silently match
      // an empty set — the exact bug the Proof Engine already climbed out of.
      //
      // B4-A — EITHER provenance. "The intervention was carried out" is true
      // whether the operator did it by hand or Lumi did it on the platform;
      // the causal question is about the campaign changing, not about who
      // changed it. Restricting this to platform executions would have emptied
      // the learning population outright — production holds zero execution
      // requests, so every carried-out intervention there is self-reported.
      where:  {
        workspaceId,
        // C-10 — SIGNAL only. Causal learning asks whether the RECOMMENDATION
        // was right, and only a connector verdict is a recommendation of that
        // kind. Behaviour-preserving today (nothing stamps a foreign class);
        // protective from here.
        ...scopeFor('learning/patterns'),
        // The canonical seam, not a local copy: "somebody intervened" has one
        // definition and this population must move with it. No other `OR` here.
        ...INTERVENED_WHERE,
        createdAt: { gte: since },
      },
      select: {
        id: true, verdict: true, entityId: true, entityLevel: true, createdAt: true,
        // Read by evaluateDecisionSuccess: the intervention instant opens the
        // outcome window (measuring from issuance would charge the result for
        // however long the verdict sat unread), and an unselected column is
        // `undefined`, which silently reverts it to createdAt. PROVENANCE_SELECT
        // names both columns so neither can be forgotten.
        ...PROVENANCE_SELECT,
      },
    }),
    // R3: this service no longer knows how to find its evidence — it asks. The
    // operational population (workspace scope, the LEGACY_UNKNOWN/ROLLING_WINDOW
    // allow-list, and the sync-recency bound) is now stated once, in the Evidence
    // layer, rather than inline here.
    //
    // WHY OPERATIONAL, unchanged (Phase G): pattern extraction reads these as a
    // sequence of observations per entity, so a canonical row is an extra
    // observation of a period nobody asked about.
    //
    // `since` is derived from the CALLER's lookbackDays, not from the config
    // default — getBriefing's parameter stays authoritative and the Evidence
    // layer receives whatever it resolved to.
    //
    // orderBy: null — this query never had one, and it must not acquire one.
    // patternEngine.indexSnapshots sorts each entity's series itself, so the
    // database was never asked to; adding ORDER BY to the widest lookback in the
    // system (365 days) changes the plan without changing a single output.
    //
    // The projection stays HERE, named by the consumer that reads it:
    // buildPatternInputs projects exactly these six fields. Explicit, not
    // `SELECT *` — a new MetricSnapshot column would otherwise widen this read
    // and throw during migration lag (the class that took getLoopState down
    // in #209).
    selectOperationalSnapshots(workspaceId, {
      since,
      select: { entityId: true, date: true, frequency: true, roas: true, ctr: true, spendMinor: true },
      orderBy: null,
    }),
    prisma.testExperiment.findMany({ where: { workspaceId } }),
  ]);
  // R6: the CURRENT outcome of each decision, explicitly projected.
  //
  // Two changes forced by supersession, neither of them a scoring change:
  //   • `supersededAt: null`. Re-recording an outcome now appends instead of
  //     overwriting, so this read would otherwise return several rows for one
  //     decision and extractPatterns would count a corrected result and the
  //     result it corrected as two independent observations of the same call.
  //   • an explicit `select`. This was a SELECT * that survived only because
  //     nothing had been added to the table; the four R6 columns would have
  //     widened it silently and thrown during migration lag (#209). It projects
  //     what buildPatternInputs reads, and nothing else.
  //
  // R10 (I53): the divergence noted here is RESOLVED. The engine no longer has
  // its own definition of a correct KILL — buildPatternInputs runs the canonical
  // SUCCESS_PREDICATES through evaluateDecisionSuccess and hands the engine the
  // verdict. Which is why this projection is now the full predicate surface
  // rather than `sustained` alone: KILL grades on spendDeltaMinor, SCALE and
  // REALLOCATE and HOLD on roasDelta, and the maturity gate reads windowEnd.
  // Projecting less would make the predicates return null and silently mark
  // every measured outcome UNMEASURED.
  const outcomes = decisions.length
    ? await prisma.outcomeSnapshot.findMany({
      where: {
        workspaceId,
        decisionId: { in: decisions.map((d) => d.id) },
        ...CURRENT_OUTCOME_WHERE,
      },
      select: {
        decisionId: true, sustained: true,
        spendDeltaMinor: true, revenueDeltaMinor: true, roasDelta: true, windowEnd: true,
      },
    })
    : [];

  const inputs = buildPatternInputs({ decisions, outcomes, snapshots, tests, now });
  const patterns = extractPatterns({ ...inputs, now });

  // ── R10 (I49) — concurrency-safe persistence ────────────────────────
  // The previous shape was read-then-write: findMany the existing rows, mint a
  // randomUUID for every key that was not among them, then createMany. Two
  // extractions overlapping — which the worker cadence in Phase C makes routine,
  // and which a user opening /briefing during a sweep already could — both saw
  // the key as absent, both minted a DIFFERENT uuid for it, and the second
  // createMany hit @@unique([workspaceId, patternKey]) with a P2002 that took
  // the whole request down.
  //
  // upsert keyed on the NATURAL key removes the race rather than catching it:
  // the database decides who creates and who updates, and the loser is handed
  // the winner's row. `skipDuplicates` was rejected as the fix — it would have
  // silently DISCARDED the newer derived state (accuracy, support, status) that
  // the losing run had just computed, which is worse than the crash.
  //
  // TWO PASSES, because supersededById points at another pattern's row id and a
  // new pattern has no id until it exists. Pass 1 establishes identity for every
  // key; pass 2 wires the references using ids that are now real. Splitting it
  // is what lets a concurrent run's ids win cleanly — the pre-assigned uuid is
  // only a proposal until the upsert returns.
  //
  // `promotedRuleId` is deliberately absent from dynamicFields, so re-extraction
  // never unlinks a pattern an operator promoted to a guardrail.
  const idByKey = new Map();
  await prisma.$transaction(async (tx) => {
    for (const p of patterns) {
      const row = await tx.accountPattern.upsert({
        where:  { workspaceId_patternKey: { workspaceId, patternKey: p.key } },
        update: dynamicFields(p),
        create: {
          id: randomUUID(), workspaceId, patternKey: p.key, kind: p.kind, ...dynamicFields(p),
          metric: p.metric ?? null, scopeLevel: p.scopeLevel ?? null, audienceTag: p.audienceTag ?? null,
          comparator: p.comparator ?? null, unit: p.unit ?? null, emitVerdict: p.emitVerdict ?? null,
          sustainedDays: p.sustainedDays ?? null,
          firstObservedAt: p.firstObservedAt, lastObservedAt: p.lastObservedAt,
        },
        select: { id: true },
      });
      idByKey.set(p.key, row.id);
    }

    // Pass 2 — supersession links, now that every key has a real id. Only the
    // patterns that actually name a winner are touched, so an account with no
    // conflicts issues no writes here at all.
    for (const p of patterns) {
      const supersededById = p.supersededByKey ? idByKey.get(p.supersededByKey) ?? null : null;
      if (supersededById === null) continue;
      await tx.accountPattern.update({ where: { id: idByKey.get(p.key) }, data: { supersededById } });
    }
  });

  const observationRows = patterns.flatMap((p) =>
    (p.observations ?? []).map((o) => ({
      workspaceId, patternId: idByKey.get(p.key), occurrenceKey: o.occurrenceKey,
      decisionId: o.decisionId ?? null, entityId: o.entityId ?? null,
      predicted: o.predicted, actual: o.actual ?? null, correct: o.correct ?? null,
      observedAt: o.observedAt,
    })),
  );

  // Observations are append-only and idempotent by @@unique([patternId,
  // occurrenceKey]); skipDuplicates is correct HERE because a re-observation of
  // the same occurrence carries no new information — unlike a pattern row,
  // whose derived state genuinely changes between runs.
  if (observationRows.length) await prisma.patternObservation.createMany({ data: observationRows, skipDuplicates: true });

  const enriched = patterns.map((p) => ({ id: idByKey.get(p.key), ...p }));
  const promotableCount = enriched.filter((p) => p.promotable).length;
  const conflicts = enriched.filter((p) => p.status === PATTERN_STATUS.CONFLICTED);

  logger.info({ workspaceId, patterns: enriched.length, promotableCount, conflicts: conflicts.length }, '[PatternService] briefing built');
  return { patterns: enriched, promotableCount, conflicts };
}

// ============================================================
// readBriefing — the READ path (R10 · Phase C)
// ============================================================
// What GET /api/lumi/briefing serves. It runs no extraction, writes nothing,
// and states only what is already persisted.
//
// WHY THE SPLIT EXISTS. getBriefing above re-derives every pattern in the
// workspace from a 365-day evidence window and then writes them back. Doing that
// inside a page load meant a multi-table write on a GET, an unbounded read on
// the request path, and — the reason that actually matters — learning that only
// happened when somebody was watching. The extraction is now scheduled; this is
// the surface.
//
// STALENESS IS HONEST HERE. If the sweep has not run for this workspace yet,
// this returns an empty list, which is true: nothing has been learned yet.
// `generatedAt` on the route says when the request was served; the rows carry
// their own `lastObservedAt` and `updatedAt` for when the learning happened.
// Nothing here invents a pattern to fill the gap.

/** The columns every briefing consumer reads. Explicit — an unprojected read on
 *  this table widens with the next migration (#209). */
// EXPORTED for `briefingFieldParity.contract.test.js` — the ratchet asserting
// that the client schema declares nothing this projection cannot send. Reading
// the real object beats matching its source text, and the constant is a
// contract rather than an internal.
export const BRIEFING_SELECT = Object.freeze({
  id: true, patternKey: true, kind: true, statement: true, basis: true,
  support: true, effectiveSupport: true, accuracy: true, confidence: true, status: true,
  metric: true, scopeLevel: true, audienceTag: true, comparator: true, threshold: true,
  unit: true, emitVerdict: true, sustainedDays: true, promotedRuleId: true,
  firstObservedAt: true, lastObservedAt: true, updatedAt: true,
  // C-14 — the pointer B8-05's "what replaced this" is built on. It has been a
  // column since the pattern engine shipped, is written in a deliberate
  // two-pass transaction (below), and was never once selected — while the
  // client schema declared it, so the field LOOKED available for as long as it
  // has existed. Selecting it is the whole of B's substrate.
  supersededById: true,
});

/**
 * Read this workspace's persisted learnings. No extraction, no writes.
 *
 * @param {string} workspaceId
 * @returns {Promise<{ patterns, promotableCount, conflicts, lastLearnedAt }>}
 *   `lastLearnedAt` is null when nothing has ever been extracted — an honest
 *   "we have not learned yet", never a fabricated timestamp.
 */
export async function readBriefing(workspaceId) {
  if (!workspaceId) throw new Error('readBriefing: workspaceId required');

  const rows = await prisma.accountPattern.findMany({
    where: { workspaceId },
    select: BRIEFING_SELECT,
    // Same ordering rule as the Lumi feed, including `nulls: 'last'` — an
    // UNMEASURED pattern's null confidence must not sort above a proven one
    // (PostgreSQL puts NULLS FIRST on DESC by default).
    orderBy: [{ status: 'asc' }, { confidence: { sort: 'desc', nulls: 'last' } }],
  });

  // C-14 — the two temporal facts that could not cross the wire. Both are
  // derived at READ: `PatternObservation` and `supersededById` already hold the
  // truth, and a stored copy would drift the moment an observation lands
  // between extractions. Issued after the rows, because both are keyed by ids
  // this read has just produced.
  //
  // Neither can fail the briefing. A memory surface that 500s because a
  // supplementary count was unavailable would trade a missing figure for a
  // missing page — so both publish a C-06 knowledge token instead, and the
  // patterns themselves arrive either way.
  const [checks, replacedBy] = await Promise.all([
    checksByPattern(workspaceId, rows.map((r) => r.id)),
    replacementOf(workspaceId, rows),
  ]);

  const patterns = rows.map((p) => ({
    ...p,
    promotable: isActionablePattern(p),
    // RAW counts, published BESIDE the recency-weighted `accuracy` and never
    // instead of it. They will disagree — 0.85 beside 3 of 5 is correct, not a
    // contradiction — and nothing here recomputes `accuracy` from them.
    checks:     checks.get(p.id),
    replacedBy: replacedBy.get(p.id),
  }));

  return {
    patterns,
    promotableCount: patterns.filter((p) => p.promotable).length,
    conflicts:       patterns.filter((p) => p.status === PATTERN_STATUS.CONFLICTED),
    lastLearnedAt:   rows.reduce(
      (latest, r) => (latest == null || r.updatedAt > latest ? r.updatedAt : latest),
      null,
    ),
  };
}
