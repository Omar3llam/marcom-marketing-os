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
import { scopeFor } from '../../services/decisions/decisionClassScope.js';
import { getDecisionDetail } from '../../services/decisions/decisionDetail.js';
import { getDecisionHistoryPage, HISTORY_PAGE_SIZE } from '../../services/decision-memory/decisionHistoryList.js';
import { stampOnce, recordSignal, recordEntitySignal } from './decisionSignalStamps.js';

// Re-exported, not re-implemented: signalProjection.contract.test.js imports it
// from this module, and the projection it pins is the same one either way.
export { signalBody } from './decisionSignalStamps.js';

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
    //
    // C-01 (follow-up) — and it must come from the SIGNAL, which is the class
    // this panel is showing. Unscoped, the newest row under a standing breach is
    // a guardrail episode, whose `rootCause` is `guardrail:<name>` and whose
    // `objective` and `channel` are never written — so the track record rendered
    // beside a Signal verdict would have been looked up under another class's
    // key, with two of its five dimensions null.
    const decision = await prisma.decision.findFirst({
      where:   { workspaceId: req.workspaceId, entityId, status: 'PROPOSED', ...scopeFor('decisions/learning-key') },
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
// ─────────────────────────────────────────────────────────────
// GET /decisions — THE THEN DESTINATION'S LIST (B7 R-N2, B8-03)
// ─────────────────────────────────────────────────────────────
// The workspace's decision history: SIGNAL + GUARDRAIL, newest first, paged.
// Its own read, NOT a widened `/decisions/recent` — that one is a capped,
// SIGNAL-only sidebar strip and answers a different question.
//
// NO PLAN GATE, deliberately: B7 Ruling 3 put the Decision destination at FREE,
// and this router carries no `requirePlan`. NO ROLE GATE, for the reason stated
// above `/decisions/recent`: reading what Lumi decided is not an operator
// action.
//
// `total` is COUNTED, never inferred from the page — a capped list is not a
// capped count (B8-01's forbidden inference). `nextCursor` is observed by
// over-fetching one row, so a full last page never publishes a cursor that
// leads nowhere.
decisionsRouter.get('/decisions', async (req, res) => {
  const workspaceId = req.workspaceId;
  // Same reasoning as `/decisions/recent`: authenticated but not yet in a
  // workspace is an EMPTY history, not a failure. A 401 here would surface as a
  // broken destination during onboarding.
  if (!workspaceId) return res.json({ decisions: [], total: 0, nextCursor: null });

  try {
    const page = await getDecisionHistoryPage({
      workspaceId,
      limit:  req.query.limit ? Number(req.query.limit) : HISTORY_PAGE_SIZE,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
    });
    return res.json(page);
  } catch (err) {
    logger.error({ err: err.message, workspaceId }, '[lumi/decisions] history failed');
    // NOT an empty list. C-03's rule: a failed read must never be spelled the
    // same way as a workspace that has decided nothing.
    return res.status(500).json({ error: 'DecisionHistoryUnavailable', message: 'Request failed' });
  }
});

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

// ── GET /api/lumi/decisions/:id (C-11) ──────────────────────────────────────
// The Decision, readable as the object it was. Lumi could execute one by id,
// dismiss it, judge it and record an outcome against it; it could not read one.
//
// REGISTERED LAST, AND THAT IS LOAD-BEARING. This router is flat-mounted at '/'
// and Express matches in registration order, so a `:id` pattern placed above
// `/decisions/recent` captures id="recent" and answers the sidebar 404 — with
// nothing anywhere reporting a fault. Pinned by decisions.detail.test.js.
//
// NO ROLE GATE, for the same reason /decisions/recent has none: reading what
// Lumi decided is not an operator action, and the CLIENT seat that can already
// read the list must not be blocked from opening an item of it. The OPERATORS
// gates above guard WRITES.
//
// The response is a THEN surface (R-1 / R-2 / B7-06) — see decisionDetail.js
// for what that forbids and why memory is deliberately not traversed here.
decisionsRouter.get('/decisions/:id', async (req, res) => {
  const { id } = req.params;
  if (!req.workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  try {
    const { status, payload } = await getDecisionDetail({ id, workspaceId: req.workspaceId });
    return res.status(status).json(payload);
  } catch (err) {
    logger.error({ err: err.message, id }, '[lumi/decisions] detail read failed');
    // 500 rather than a 404: "no such decision" would be a claim about the
    // account made on the strength of our own failure.
    return res.status(500).json({ error: 'DecisionUnavailable', message: 'Request failed' });
  }
});
