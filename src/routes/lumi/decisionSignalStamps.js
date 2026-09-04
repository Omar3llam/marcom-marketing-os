// ============================================================
// MARCOM / Lumi — Decision signal stamping
// ------------------------------------------------------------
// The four handlers behind the decision-lifecycle routes. They were extracted
// from decisions.js because that file had drifted to 476 lines against a
// 400-line route budget, and arch-check FAILS above max × 1.2 — so a single
// added comment broke CI. Route files should mount; this is the work.
//
// What they share is one shape: resolve a Decision, then write exactly one
// timestamp to it under a guard. Nothing here mounts a route, and nothing here
// knows about the flat-mount prefix rule — that stays with the router.
//
// TWO KEYINGS, and the difference is the whole reason there are four:
//   by-entity  → "the live Signal verdict for this entity", a query the server
//                re-resolves at write time
//   by-id      → one named row, which is what the accuracy surface scores
//
// C-01 — every by-entity resolution here is scoped with connectorDecisionScope().
// `by-entity` can only address a class that is singular per entity, and
// supersession makes Signal that class; a Guardrail entity holds several open
// episodes at once. Unscoped, `createdAt desc` meant "whichever class wrote
// last", which under a standing breach is always the 15-minute guardrail sweep.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { scopeFor } from '../../services/decisions/decisionClassScope.js';

/**
 * Stamp a lifecycle timestamp on the live verdict for an entity, once.
 * `field` is a fixed literal from the two call sites below — never user input.
 */
export async function stampOnce(req, res, field) {
  const { entityId } = req.params;
  if (!req.workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  try {
    const decision = await prisma.decision.findFirst({
      // C-01 — scoped to Signal, and deliberately given no class parameter:
      // `by-entity` can only address a class that is singular per entity, which
      // supersession makes Signal and nothing else. A Guardrail entity holds
      // several open episodes, so widening this route would only let it miss
      // more precisely; stamping those needs item addressing (C-11).
      //
      // Unscoped, `createdAt desc` meant "whichever class wrote last" — always
      // the 15-minute guardrail sweep under a standing breach — so reading a
      // Signal's reasoning stamped `explainedAt` onto a Guardrail episode.
      where:   { workspaceId: req.workspaceId, entityId, status: 'PROPOSED', ...scopeFor('decisions/stamp-by-entity') },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, [field]: true },
    });

    // No live verdict for this entity. An honest 404 rather than a silent 200:
    // the caller asked us to record something about a decision that isn't there,
    // and a cheerful ok:true would make a missing signal indistinguishable from
    // a recorded one when the learning query later comes up empty.
    if (!decision) return res.status(404).json({ error: 'NoLiveDecision', message: 'No live decision for this entity' });

    // Already stamped — report the ORIGINAL timestamp, unchanged. `recorded`
    // tells an honest caller which of the two happened.
    if (decision[field]) {
      return res.json({ ok: true, recorded: false, [field]: decision[field] });
    }

    const at = new Date();
    await prisma.decision.update({ where: { id: decision.id }, data: { [field]: at } });
    return res.json({ ok: true, recorded: true, [field]: at });
  } catch (err) {
    logger.error({ err: err.message, entityId, field }, '[lumi/decisions] lifecycle stamp failed');
    return res.status(500).json({ error: 'DecisionUnavailable', message: 'Request failed' });
  }
}

// ------------------------------------------------------------
// The two HUMAN signals: "I acted on this" / "I rejected this".
// ------------------------------------------------------------
// Keyed by DECISION ID, not by entity, unlike the two stamps above. Those record
// engagement with whatever verdict happened to be live at the moment of a click,
// which is the right attribution for a click. This records a claim ABOUT a
// specific call, and it is the row the accuracy surface will later score — so it
// has to name which one, not "whichever was live".
//
// They do NOT move `status`. Four readers gate on status = 'PROPOSED' (the feed,
// the agentic planner, the collaboration queue, and stampOnce right above), so
// flipping it would drop the decision out of three queues and make /explain and
// /intent 404 on it — an operator who executes first and reads the reasoning
// second would lose their explainedAt entirely. Whether status should follow is
// a separate change with a separate blast radius.
//
// Mutually exclusive by construction: executing and dismissing the same call are
// contradictory claims, and letting both land would leave a row that reports
// itself as acted-on AND rejected. Whichever arrived first wins, and the second
// gets a 409 naming it.
//
// B4-A — the execute signal writes `humanExecutedAt`, NOT `platformExecutedAt`.
// This route records a CLAIM: the operator says they went and did it. Lumi did
// not perform it, no platform confirmed it, and nothing here may imply
// otherwise. The only writer of platform provenance is the canonical worker,
// after Meta accepts a real mutation.
const SIGNALS = Object.freeze({
  humanExecutedAt: { opposite: 'dismissedAt',     oppositeError: 'AlreadyDismissed' },
  dismissedAt:     { opposite: 'humanExecutedAt', oppositeError: 'AlreadyExecuted' },
});

/**
 * Apply `field` to an ALREADY-RESOLVED decision, once. Shared by both keyings so
 * idempotency and mutual exclusion cannot drift between them — those two rules
 * decide what the accuracy surface counts, and two copies would eventually
 * disagree about the same click.
 *
 * `guard` runs AFTER both checks and returns a 409 body to refuse with, or null.
 * It exists because only the by-id path needs a status gate: the by-entity
 * lookup encodes `status: 'PROPOSED'` in its WHERE, so a superseded row is never
 * resolved in the first place.
 */
async function stampSignal(res, decision, field, guard = null) {
  const { opposite, oppositeError } = SIGNALS[field];

  // Already stamped — report the ORIGINAL timestamp. Idempotent, and checked
  // BEFORE the guard: a decision executed while live and superseded by the next
  // sweep must still report its own signal rather than 409 on a claim that was
  // already true when it was made.
  if (decision[field]) {
    return res.json({ ok: true, recorded: false, ...signalBody(field, decision[field], decision.platformExecutedAt) });
  }

  if (decision[opposite]) {
    return res.status(409).json({
      error: oppositeError,
      message: `This decision was already recorded as ${opposite === 'humanExecutedAt' ? 'executed' : 'dismissed'}`,
      [opposite]: decision[opposite],
    });
  }

  const refusal = guard?.(decision) ?? null;
  if (refusal) return res.status(409).json(refusal);

  const at = new Date();
  await prisma.decision.update({ where: { id: decision.id }, data: { [field]: at } });
  // `decision.platformExecutedAt` is the row as it was READ, and that is correct:
  // this update writes one human column and cannot have changed Lumi's.
  return res.json({ ok: true, recorded: true, ...signalBody(field, at, decision.platformExecutedAt) });
}

/**
 * B4-A — the response body for one recorded signal.
 *
 * The execute signal answers with BOTH halves of the provenance question, so no
 * client has to infer which kind of execution happened from a bare timestamp:
 *
 *   humanExecution:    { reported: true,  reportedAt }   ← humanExecutedAt only
 *   platformExecution: { executed: true,  executedAt }   ← platformExecutedAt only
 *
 * T12-A — EACH SIDE IS READ FROM ITS OWN COLUMN AND NOTHING ELSE. Neither may be
 * inferred from the other, and neither may be inferred from this request. This
 * route used to state `platformExecution: null` unconditionally, on the reasoning
 * that "this route never creates one" — true, and the wrong question. The field
 * does not report what this REQUEST did; it reports what is true of the DECISION.
 * A decision Lumi had already executed answered the self-report with a flat null,
 * which reads as "we looked, and Lumi has not executed this" about a row whose
 * `platformExecutedAt` was set. That is a fact denied on the wire, not a naming
 * drift, so it is derived here rather than assumed.
 *
 * `null` still means absence, and is stated rather than omitted: omission reads
 * as "not part of this response", null says "we looked and it has not happened".
 * Note the sibling endpoint spells absence differently — GET /lumi/decisions/:id/
 * executions always returns the object and flags it `executed: false`. Both are
 * honest; the presence shape (`{ executed, executedAt }`) is deliberately the
 * same vocabulary, and this route keeps `null` because that is the shape it has
 * always published for absence and changing it would break readers that test the
 * field for truthiness.
 *
 * DEPRECATED COMPATIBILITY FIELD — `executedAt` rides along for clients shipped
 * before the split. Its derivation HERE is "the human timestamp this route just
 * wrote", always, because that is the only kind of execution this route can
 * record. It is emphatically NOT the union: even when `platformExecutedAt` is
 * already set — the state T12-A fixed above — this field stays human. GET
 * /lumi/decisions/:id/executions derives its own `executedAt` differently
 * (platformExecutedAt ?? humanExecutedAt), so the two endpoints can report
 * different instants for one decision. They are not the same canonical fact and
 * must never be treated as one — the structured `humanExecution` /
 * `platformExecution` fields are authoritative.
 *
 * It is not the stored `Decision.executedAt` column either. Nothing reads or
 * writes that column any more; this value is computed for the wire.
 *
 * Exported for the projection contract test: two of the four provenance states
 * are unreachable through this endpoint (it always writes `humanExecutedAt`, so
 * no response it sends can carry a null one), and a contract that only holds for
 * the states HTTP can reach is not the contract.
 */
export function signalBody(field, at, platformExecutedAt = null) {
  if (field !== 'humanExecutedAt') return { [field]: at };
  return {
    humanExecutedAt: at,
    humanExecution:    at                 ? { reported: true, reportedAt: at }             : null,
    platformExecution: platformExecutedAt ? { executed: true, executedAt: platformExecutedAt } : null,
    executedAt: at, // DEPRECATED — human-only, never the union. Remove once no client reads it.
  };
}

/**
 * Record a human signal against ONE decision, once.
 * `field` is a fixed literal from the two call sites below — never user input.
 */
export async function recordSignal(req, res, field) {
  const { id } = req.params;
  if (!req.workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  try {
    // Found by id + workspace, with NO status filter: a decision that has moved
    // on is a 409 that says what it moved to, not a 404 that implies it never
    // existed. The two are different facts and the caller can act on only one.
    // T12-A — `platformExecutedAt` is selected because the response REPORTS it.
    // Without it `decision.platformExecutedAt` is `undefined`, the projection
    // falls to null, and the body denies an execution the row records.
    const decision = await prisma.decision.findFirst({
      where:  { id, workspaceId: req.workspaceId },
      select: { id: true, status: true, humanExecutedAt: true, dismissedAt: true, platformExecutedAt: true },
    });

    if (!decision) return res.status(404).json({ error: 'DecisionNotFound', message: 'No such decision in this workspace' });

    // Only a live call can be acted on. A SUPERSEDED verdict has been replaced;
    // recording an intervention against it would attribute the operator's action
    // to a call the engine no longer stands behind.
    return await stampSignal(res, decision, field, (d) => (d.status === 'PROPOSED' ? null : {
      error:   'DecisionNotActionable',
      message: `Decision is ${d.status}; only a live (PROPOSED) decision can be acted on`,
      status:  d.status,
    }));
  } catch (err) {
    logger.error({ err: err.message, id, field }, '[lumi/decisions] signal failed');
    return res.status(500).json({ error: 'DecisionUnavailable', message: 'Request failed' });
  }
}

// ------------------------------------------------------------
// The same two signals, keyed by ENTITY — the FALLBACK path.
// ------------------------------------------------------------
// NOT temporary any more, and not to be deleted. getConnectorVerdicts now
// projects `decisionId` beside every verdict, so a client that has one sends it
// to the by-id routes above — which name ONE ROW, where this names a query the
// server re-resolves at write time.
//
// This path stays because `decisionId` is legitimately null for any campaign no
// sweep has written a Decision for. That is a normal state, not a missing one:
// the verdict feed recomputes from the entity graph on every read, while the
// persisted rows come only from persistConnectorVerdicts on a sweep. A fresh
// connection has verdicts to act on before it has decisions to act on, and
// deleting this route would make those campaigns' buttons 404.
//
// The two paths answer to the same 409/404 contract, which is what lets one
// client-side error mapper serve both.
//
// WHAT IT COSTS. #326 keyed on decision id so a signal could name WHICH call was
// acted on rather than "whichever was live". Resolving here gives that up in one
// specific case: two verdicts issued for the same entity in quick succession,
// where a slow click lands on the second. In exchange it removes a worse failure
// — a client-held id captured at render and clicked minutes later names a call
// that is no longer live, while resolving at write time always names the one the
// operator was actually looking at. Narrower exposure, and the direction of the
// error is the honest one.
//
// If the signal vocabulary grows past these four, consolidate explain / intent /
// execute / dismiss into a single POST /decision-events rather than a fifth pair.
export async function recordEntitySignal(req, res, field) {
  const { entityId } = req.params;
  // Without this the WHERE below loses its workspace predicate entirely and
  // findFirst matches across accounts — stamping another workspace's decision.
  if (!req.workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  try {
    // The live SIGNAL verdict for this entity, newest first — the same
    // resolution stampOnce uses for explain/intent, so all four signals agree on
    // what "this entity's decision" means.
    //
    // C-01 (follow-up) — the scope was missing here. That sentence above was
    // written when it was true and C-01 falsified it: three sites were made
    // class-aware and this fourth was missed, leaving the four signals
    // disagreeing about the very thing the comment promised they shared.
    //
    // It is the most consequential of the four. The other three write
    // `explainedAt`/`intentAt`, which nothing currently reads; this one writes
    // `humanExecutedAt`/`dismissedAt` — the columns INTERVENED_WHERE gates the
    // learning population and the accuracy surface on. Unscoped, an operator
    // clicking "I executed this" on a Signal could, under a standing breach,
    // stamp a Guardrail episode instead and enrol it in institutional memory.
    const decision = await prisma.decision.findFirst({
      where:   { workspaceId: req.workspaceId, entityId, status: 'PROPOSED', ...scopeFor('decisions/signal-by-entity') },
      orderBy: { createdAt: 'desc' },
      // T12-A — same reason as the by-id path: the response reports this column,
      // so the query has to carry it. The two paths share `signalBody`, and a
      // select that drifted between them would publish two different truths.
      select:  { id: true, humanExecutedAt: true, dismissedAt: true, platformExecutedAt: true },
    });

    // No live verdict. Honest 404 rather than a cheerful ok:true — a signal we
    // could not record must not be indistinguishable from one we did.
    if (!decision) return res.status(404).json({ error: 'NoLiveDecision', message: 'No live decision for this entity' });

    return await stampSignal(res, decision, field);
  } catch (err) {
    logger.error({ err: err.message, entityId, field }, '[lumi/decisions] entity signal failed');
    return res.status(500).json({ error: 'DecisionUnavailable', message: 'Request failed' });
  }
}
