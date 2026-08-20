// ============================================================
// MARCOM / Lumi — Decision lifecycle signals
//   PATCH /api/lumi/decisions/by-entity/:entityId/explain
//   PATCH /api/lumi/decisions/by-entity/:entityId/intent
//   PATCH /api/lumi/decisions/:id/execute
//   PATCH /api/lumi/decisions/:id/dismiss
//   PATCH /api/lumi/decisions/by-entity/:entityId/execute   (fallback)
//   PATCH /api/lumi/decisions/by-entity/:entityId/dismiss   (fallback)
//   GET   /api/lumi/decisions/recent                        (R7 — sidebar)
// ------------------------------------------------------------
// Two moments the product could not previously observe: a human OPENED the
// reasoning behind a verdict, and a human went and ACTED on it (copied the
// recommendation, or opened the ad platform). Neither executes anything.
//
// ── Why both a by-id and a by-entity path ────────────────────────────────────
// getConnectorVerdicts now projects `decisionId`, so the surfaces prefer the
// by-id routes: an id names ONE ROW, where by-entity names a query ("newest
// PROPOSED for this entity") that the server re-resolves at write time — so a
// sweep landing between render and click moves the target.
//
// by-entity remains the correct route when there is no id to send. The verdict
// feed recomputes from the entity graph on every read and persists nothing; the
// Decision rows come only from a sweep. A campaign can therefore have a live
// verdict and no stored decision, and for it entityId is the only key there is.
//
// ── Written ONCE ─────────────────────────────────────────────────────────────
// A second click is not a second engagement. Re-stamping would silently change
// "when did someone first look at this" into "when did someone last click",
// which answers a different question than the column name promises.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { getSimilarOutcomes } from '../../services/analysis/decisionLearning.js';
import { getRecentDecisions, RECENT_DECISIONS_LIMIT } from '../../services/decision-memory/decisionHistory.js';
import { validateJudgment, recordJudgment } from '../../services/decision-memory/humanJudgment.js';

export const decisionsRouter = Router();

// NOTE: this router is FLAT-MOUNTED at '/' alongside its siblings, so every
// path here carries its own '/decisions' prefix and the role gate is attached
// PER ROUTE. A path-less `router.use(gate)` would leak onto every sibling
// mounted after it — the bug that 403'd half the app in PR #226.
const BASE = '/decisions/by-entity/:entityId';

// Recording that a human engaged with a decision is a BUYER/STRATEGIST signal.
// A CLIENT seat is read-only by construction and must not seed the learning
// loop: their view is not an operator's intent.
const OPERATORS = [WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST];

/**
 * Stamp a lifecycle timestamp on the live verdict for an entity, once.
 * `field` is a fixed literal from the two call sites below — never user input.
 */
async function stampOnce(req, res, field) {
  const { entityId } = req.params;
  if (!req.workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  try {
    const decision = await prisma.decision.findFirst({
      where:   { workspaceId: req.workspaceId, entityId, status: 'PROPOSED' },
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

// A human opened the reasoning. Not intent — reading is not acting.
decisionsRouter.patch(`${BASE}/explain`, requireCollabRole(...OPERATORS), (req, res) =>
  stampOnce(req, res, 'explainedAt'));

// A human took the decision somewhere they could act on it (copied it, or opened
// the ad platform). ENGAGEMENT / ADOPTION, and nothing beyond it: carrying a
// recommendation toward a place where action is possible is not action, and the
// gap between the two is however long the operator took to not act.
//
// C1 removed the last reader that treated it otherwise. getSimilarOutcomes used
// to gate the learning population on this column and render "improved after
// action" over it; it now gates on the intervention union
// (humanExecutedAt OR platformExecutedAt) and nothing in the backend reads
// intentAt at all. It is kept because it is the only adoption signal the system
// has — which is a real question, just not this one.
decisionsRouter.patch(`${BASE}/intent`, requireCollabRole(...OPERATORS), (req, res) =>
  stampOnce(req, res, 'intentAt'));

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
async function recordSignal(req, res, field) {
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
async function recordEntitySignal(req, res, field) {
  const { entityId } = req.params;
  // Without this the WHERE below loses its workspace predicate entirely and
  // findFirst matches across accounts — stamping another workspace's decision.
  if (!req.workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  try {
    // The live verdict for this entity, newest first — the same resolution
    // stampOnce uses for explain/intent, so all four signals agree on what
    // "this entity's decision" means.
    const decision = await prisma.decision.findFirst({
      where:   { workspaceId: req.workspaceId, entityId, status: 'PROPOSED' },
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

// A human says they acted on this call. The strongest signal the product has,
// and the one the accuracy surface will score against.
decisionsRouter.patch('/decisions/:id/execute', requireCollabRole(...OPERATORS), (req, res) =>
  recordSignal(req, res, 'humanExecutedAt'));

// A human says they looked at this call and chose not to act. NOT the absence of
// a signal: an explicit rejection is survivorship data the accuracy surface
// counts in coverage, and it is the only way a wrong call can be recorded as
// wrong by the person who saw it.
decisionsRouter.patch('/decisions/:id/dismiss', requireCollabRole(...OPERATORS), (req, res) =>
  recordSignal(req, res, 'dismissedAt'));

// The entity-keyed pair the UI actually calls. Paths carry their own '/decisions'
// prefix for the same reason every route in this file does — see the flat-mount
// note at the top.
decisionsRouter.patch(`${BASE}/execute`, requireCollabRole(...OPERATORS), (req, res) =>
  recordEntitySignal(req, res, 'humanExecutedAt'));

decisionsRouter.patch(`${BASE}/dismiss`, requireCollabRole(...OPERATORS), (req, res) =>
  recordEntitySignal(req, res, 'dismissedAt'));

// ------------------------------------------------------------
// R13 — WHAT THE HUMAN DECIDED
//   PATCH /api/lumi/decisions/:id/judgment
// ------------------------------------------------------------
// A third axis, independent of execute/dismiss. Those record what happened on
// the ad platform; the verdict records what Lumi believed; this records the
// operator's judgement OF that belief. The verdict is never rewritten — see
// services/decision-memory/humanJudgment.js for why that matters.
decisionsRouter.patch('/decisions/:id/judgment', requireCollabRole(...OPERATORS), async (req, res) => {
  const { id } = req.params;
  if (!req.workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  const parsed = validateJudgment(req.body);
  if (parsed.error) return res.status(400).json(parsed);

  try {
    const { status, payload } = await recordJudgment({ id, workspaceId: req.workspaceId, ...parsed });
    return res.status(status).json(payload);
  } catch (err) {
    logger.error({ err: err.message, id }, '[lumi/decisions] judgment failed');
    return res.status(500).json({ error: 'DecisionUnavailable', message: 'Request failed' });
  }
});

// The track record behind this entity's live verdict: how comparable decisions
// turned out after someone acted on them.
//
// `learning: null` is the NORMAL response and never an error — no live verdict,
// too small a sample, or nothing that improved all return it, and the UI renders
// nothing. A 404 here would make "we have no track record yet" look like a
// failure, and a young workspace has no track record for almost everything.
decisionsRouter.get(`${BASE}/learning`, requireCollabRole(...OPERATORS), async (req, res) => {
  const { entityId } = req.params;
  if (!req.workspaceId) return res.json({ learning: null });

  try {
    // The similarity key comes from the decision being ASKED about, not from
    // the caller — a client that could name its own key could ask for the
    // flattering comparison rather than the true one.
    const decision = await prisma.decision.findFirst({
      where:   { workspaceId: req.workspaceId, entityId, status: 'PROPOSED' },
      orderBy: { createdAt: 'desc' },
      select:  { verdict: true, rootCause: true, entityLevel: true, objective: true, channel: true },
    });
    if (!decision) return res.json({ learning: null });

    const learning = await getSimilarOutcomes({ workspaceId: req.workspaceId, ...decision });
    return res.json({ learning });
  } catch (err) {
    logger.error({ err: err.message, entityId }, '[lumi/decisions] learning read failed');
    // Still `learning: null`, still 200: this is decoration on a decision the
    // user is already looking at. Failing the panel over a missing track record
    // would cost more than the line is worth.
    return res.json({ learning: null });
  }
});

// ── GET /api/lumi/decisions/recent (R7) ─────────────────────────────────────
// The sidebar's "Recent" list. It used to read /api/memory/patterns, which
// rendered legacy DecisionMemory rows into a display STRING and then parsed a
// verdict back out of that string with `line.includes('KILL')`, defaulting to
// TEST when no keyword matched. Every verdict it showed was reconstructed, and
// the fallback invented one outright.
//
// NO ROLE GATE, deliberately. The surface it replaces sat behind requireAuth
// alone, and the sidebar renders for every seat — gating it here would blank
// the panel for CLIENT and call it a migration. Reading what Lumi decided is
// not an operator action; the OPERATORS gate above guards WRITES.
//
// Workspace scope comes from the auth middleware and never from the caller.
decisionsRouter.get('/decisions/recent', async (req, res) => {
  const workspaceId = req.workspaceId;
  // Authenticated but no workspace yet: an empty list is the true answer, and
  // a 401/403 here would surface as a broken sidebar during onboarding.
  if (!workspaceId) return res.json({ decisions: [] });

  try {
    const rows = await getRecentDecisions(workspaceId, RECENT_DECISIONS_LIMIT);

    // Resolve display names for the campaign-level rows. Decision.entityId is a
    // @db.Uuid from the entity graph and Campaign.id is the same uuid, so this
    // is a real join rather than a guess — but it is scoped to the workspace as
    // well as the id, because an id alone is a caller-independent key and this
    // list is not the place to discover that.
    const campaignIds = [...new Set(
      rows.filter((d) => d.entityLevel === 'CAMPAIGN' && d.entityId).map((d) => d.entityId),
    )];
    const names = campaignIds.length
      ? new Map((await prisma.campaign.findMany({
        where:  { workspaceId, id: { in: campaignIds } },
        select: { id: true, name: true },
      })).map((c) => [c.id, c.name]))
      : new Map();

    return res.json({
      decisions: rows.map((d) => ({
        id:          d.id,
        entityId:    d.entityId,
        entityLevel: d.entityLevel,
        // The engine's own verdict, off the row. Never derived from text.
        verdict:     d.verdict,
        status:      d.status,
        // null, not 'Unknown': a decision about an entity we cannot name is not
        // a decision about a campaign called Unknown. The renderer decides how
        // to show an unnamed row; it must not be handed a fabricated one.
        campaign:    names.get(d.entityId) ?? null,
        decidedAt:   d.createdAt,
      })),
    });
  } catch (err) {
    logger.error({ err: err.message, workspaceId }, '[lumi/decisions] recent read failed');
    // 500 rather than an empty 200: the sidebar must not render "No decisions
    // yet" — a statement about the account — on the strength of our own failure.
    return res.status(500).json({ error: 'DecisionsUnavailable', message: 'Request failed' });
  }
});
