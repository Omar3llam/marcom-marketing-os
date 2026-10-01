// ============================================================
// MARCOM / Lumi — Decision Accuracy (Phase X · Proof Engine)
//   GET /api/lumi/accuracy — the calibration report for this workspace
//                            ({ accountLift, calibration, velocity, coverage }).
//
// Read-only. The Proof Engine measures; it never mutates a Decision or Outcome.
// Per-account only — every query is workspace-scoped (no cross-workspace read).
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import {
  getAccuracy, recordOutcome, listPendingOutcomes, validateOutcomeBody, OUTCOME_ERROR,
} from '../../services/decision-accuracy/DecisionAccuracyService.js';
import { accuracySurface, LIFT_KNOWLEDGE } from '../../services/decision-accuracy/accuracyTypes.js';
import { readOutcomeEvidence, EVIDENCE_ERROR, EVIDENCE_KNOWLEDGE } from '../../services/decision-accuracy/outcomeEvidenceComparison.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { projectOutcomeSnapshot } from '../../services/decision-accuracy/outcomeProjection.js';

// C-06 — the surface's `status` is a LIFT_STATUS. Publish what it means as
// knowledge beside it, and nothing at all when the surface carries no status
// (the plan-gated branch), because there is no claim there to classify.
const withLiftKnowledge = (surface) => {
  const knowledge = LIFT_KNOWLEDGE.knowledgeOf(surface?.status);
  return knowledge ? { ...surface, knowledge } : surface;
};


export const accuracyRouter = Router();

// Recording / observing outcomes is the BUYER+STRATEGIST operator tier (mirrors
// lumi/testing.js). A CLIENT reads the narrative; it never asserts what
// actually happened. The READ surface (GET /accuracy) stays open to all roles —
// the gated `surface` already suppresses calibration numbers below RELIABLE.
const requireOperator = requireCollabRole(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST);

// Resolve workspaceId — mirrors lumi/agentic.js. Never fabricate a uuid.
async function resolveWorkspaceId(req) {
  if (req.workspaceId) return req.workspaceId;
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { workspaceId: true } });
    return u?.workspaceId ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi/accuracy] workspaceId fallback failed');
    return null;
  }
}

async function need(req, res) {
  const wsId = await resolveWorkspaceId(req);
  if (!wsId) { res.status(409).json({ error: 'NoWorkspace', message: 'No resolvable workspace.' }); return null; }
  return wsId;
}

// ─────────────────────────────────────────────────────────────
// GET /accuracy — calibration report + the gated one-line surface.
// The surface SUPPRESSES every calibration number unless coverage is RELIABLE.
// ─────────────────────────────────────────────────────────────
accuracyRouter.get('/accuracy', async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const result = await getAccuracy(wsId);
    return res.json({
      workspaceId: wsId,
      generatedAt: new Date().toISOString(),
      surface: withLiftKnowledge(accuracySurface(result)),
      ...result,
    });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/accuracy] failed');
    return res.status(500).json({ error: 'AccuracyUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /decisions/pending-outcomes — EXECUTED decisions still missing an
// outcome. The manual-entry queue: until a causal realized-metrics source is
// wired, the loop is closed by a human recording what actually happened.
// ─────────────────────────────────────────────────────────────
accuracyRouter.get('/decisions/pending-outcomes', requireOperator, async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const out = await listPendingOutcomes(wsId);
    return res.json({ workspaceId: wsId, ...out });
  } catch (err) {
    logger.error({ err: err.message, wsId }, '[lumi/accuracy] pending-outcomes failed');
    return res.status(500).json({ error: 'PendingOutcomesUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /decisions/:id/outcome-evidence — what Lumi OBSERVED around the
// intervention, over the comparison policy's baseline and observation windows.
//
// READ-ONLY, and the boundary it sits on is the point: this endpoint reports
// evidence, never an outcome. It cannot write an OutcomeSnapshot, cannot set
// `sustained`, and cannot change accuracy, pattern support or Decision Memory.
// The operator reads it, brings what Lumi cannot see, and records their own
// judgement through the POST below — which remains the only author of an
// outcome.
//
// Fetched per decision when the operator opens one, rather than attached to
// every row of pending-outcomes: the evidence read is one query per decision,
// and folding it into the list would make the queue an N+1.
//
// 404 unknown id / wrong workspace · 409 never acted on · 200 with an explicit
// evidence state otherwise. An unreadable evidence population is a 200 with
// status UNAVAILABLE, not a 500 — the operator can still record what they saw.
// ─────────────────────────────────────────────────────────────
accuracyRouter.get('/decisions/:id/outcome-evidence', requireOperator, async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  try {
    const evidence = await readOutcomeEvidence(wsId, req.params.id);
    // C-06 — seven statuses, five knowledge tokens. The only vocabulary in the
    // system that uses the whole language, published beside the status it
    // classifies. `knowledgeOf` returns null for anything it does not
    // recognise, and a null is spread away rather than published as a
    // fabricated token.
    const knowledge = EVIDENCE_KNOWLEDGE.knowledgeOf(evidence?.status);
    return res.json({ workspaceId: wsId, ...evidence, ...(knowledge ? { knowledge } : {}) });
  } catch (err) {
    if (err.code === EVIDENCE_ERROR.DECISION_NOT_FOUND) {
      return res.status(404).json({ error: 'DecisionNotFound', message: err.message });
    }
    if (err.code === EVIDENCE_ERROR.NOT_EXECUTED) {
      return res.status(409).json({ error: 'DecisionNotExecuted', message: err.message });
    }
    logger.error({ err: err.message, wsId, decisionId: req.params.id }, '[lumi/accuracy] outcome-evidence failed');
    return res.status(500).json({ error: 'OutcomeEvidenceUnavailable', message: 'Request failed' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /decisions/:id/outcome — record the realized outcome (human-asserted).
// 422 bad body / impossible window · 404 wrong workspace / unknown id ·
// 409 not EXECUTED · 201 ok.
//
// The body carries what the operator MEASURED. It never carries provenance:
// `evidenceReference` is projected server-side from real rows and a client that
// sends one is ignored, because a claim about the database made by something
// that cannot see the database is worse than no claim at all.
//
// R6 also fixes a refusal that never fired. The 409 branch matched
// `/not EXECUTED/i` against a message reading "has not been executed" — the two
// never met, so an unexecuted decision returned 500 where the contract says 409.
// The service now names its refusals with codes; the message regexes are kept
// underneath as a fallback for anything that still throws a bare Error.
// ─────────────────────────────────────────────────────────────
accuracyRouter.post('/decisions/:id/outcome', requireOperator, async (req, res) => {
  const wsId = await need(req, res); if (!wsId) return;
  const verr = validateOutcomeBody(req.body ?? {});
  if (verr) return res.status(422).json({ error: 'BadOutcome', message: verr });
  try {
    const out = await recordOutcome(wsId, req.params.id, req.body);
    logger.info(
      { wsId, decisionId: req.params.id, outcomeId: out.outcome?.id, previousOutcomeId: out.previousOutcomeId },
      '[lumi/accuracy] outcome recorded',
    );
    return res.status(201).json({ ...out, outcome: projectOutcomeSnapshot(out.outcome) });
  } catch (err) {
    if (err.code === OUTCOME_ERROR.DECISION_NOT_FOUND || /not found/i.test(err.message)) {
      return res.status(404).json({ error: 'DecisionNotFound', message: err.message });
    }
    if (err.code === OUTCOME_ERROR.NOT_EXECUTED || /not (been )?executed|was dismissed/i.test(err.message)) {
      return res.status(409).json({ error: 'DecisionNotExecuted', message: err.message });
    }
    if (err.code === OUTCOME_ERROR.INVALID_WINDOW) {
      return res.status(422).json({ error: 'BadOutcomeWindow', message: err.message });
    }
    logger.error({ err: err.message, wsId, decisionId: req.params.id }, '[lumi/accuracy] record outcome failed');
    return res.status(500).json({ error: 'RecordOutcomeFailed', message: 'Request failed' });
  }
});
