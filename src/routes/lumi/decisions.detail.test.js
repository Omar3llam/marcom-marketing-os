// ============================================================
// C-11 — GET /api/lumi/decisions/:id  (RED)
// ------------------------------------------------------------
// Lumi can execute a decision by id, dismiss it, judge it, stamp it, and record
// an outcome against it. On `767ab02` it cannot READ one. Eight by-id reads
// exist and every one of them resolves the row to authorise or decorate an
// ACTION; none publishes the decision, and twelve of its thirty-five columns —
// including the whole committed-reasoning block — reach no client at all.
//
// ── THE LAW THIS FILE ENFORCES (R-1 / R-2 / B7-06) ──────────────────────────
//
//     The detail read publishes what Lumi COMMITTED TO. It never recomputes,
//     never reads live evidence, and never places a current assessment beside
//     a stored one.
//
// So a large share of these assertions are about what the response must NOT
// contain. That is deliberate: "then" is not a section of the payload, it is a
// property of the whole payload, and the only way to pin a property is to
// refuse everything that would break it.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DECISION_CLASS, KNOWLEDGE } from '@marcom/runtime-contracts';

const { decisionFindFirst } = vi.hoisted(() => ({ decisionFindFirst: vi.fn() }));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    decision: { findFirst: (...a) => decisionFindFirst(...a), update: vi.fn() },
    campaign: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock('../../services/decision-memory/decisionHistory.js', () => ({
  getRecentDecisions: vi.fn().mockResolvedValue([]),
  RECENT_DECISIONS_LIMIT: 20,
}));
vi.mock('../../services/analysis/decisionLearning.js', () => ({ getSimilarOutcomes: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { decisionsRouter } from './decisions.js';

const ID     = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ENTITY = '11111111-1111-1111-1111-111111111111';
// A real uuid: guardrailRuleId is @db.Uuid, so a fixture like 'rule-1' names a
// row PostgreSQL would refuse — found by the real-row harness, which is the
// only instrument that can see it.
const RULE   = '22222222-2222-2222-2222-222222222222';

function makeApp({ workspaceId = 'ws1', collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = workspaceId;
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', decisionsRouter);
  return app;
}

/** A SIGNAL row with every column its writer actually sets. */
const signalRow = (over = {}) => ({
  id: ID, workspaceId: 'ws1', entityId: ENTITY, entityLevel: 'CAMPAIGN',
  decisionClass: DECISION_CLASS.SIGNAL,
  verdict: 'KILL', confidence: 0.82,
  diagnosis: 'Spend without return.', rootCause: 'CRITICAL_PERFORMANCE_DECLINE',
  status: 'PROPOSED',
  explainedAt: new Date('2026-08-14T11:00:00.000Z'),
  intentAt: new Date('2026-08-14T11:05:00.000Z'),
  humanExecutedAt: null, platformExecutedAt: null, dismissedAt: null,
  resolvedAt: null, resolution: null, confidenceDelta: null, closureReason: null,
  humanResponse: null, humanReasonCode: null, humanReasonNote: null, humanRespondedAt: null,
  ctrAtDecision: 1.64, roasAtDecision: 0.41, objective: 'CONVERSIONS', channel: 'META',
  hypotheses: [{ id: 'h1', labelKey: 'creative_fatigue', confidence: 0.7 }],
  counterfactuals: [{ mechanism: 'audience_saturation', labelKey: 'aud_sat', confidence: 0.3 }],
  evidenceReference: { population: 'CANONICAL', rowCount: 30, entityIds: [ENTITY] },
  guardrailRuleId: null, openHitKey: null,
  createdAt: new Date('2026-08-14T10:00:00.000Z'),
  ...over,
});

/** A GUARDRAIL row: the census says its writer sets EIGHT of those columns. */
const guardrailRow = (over = {}) => signalRow({
  decisionClass: DECISION_CLASS.GUARDRAIL,
  rootCause: 'guardrail:CPA ceiling',
  ctrAtDecision: null, roasAtDecision: null, objective: null, channel: null,
  hypotheses: null, counterfactuals: null,
  guardrailRuleId: RULE, openHitKey: ENTITY + ':' + RULE,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  decisionFindFirst.mockResolvedValue(signalRow());
});

// ── T1 ──────────────────────────────────────────────────────────────────────
describe('C-11 · T1 — the Decision is readable from its own id', () => {
  it('answers 200 with the row it was asked for', async () => {
    const res = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(res.body.decision.id).toBe(ID);
  });

  it('resolves on TWO predicates — the id alone is a caller-independent key', async () => {
    await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(decisionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: ID, workspaceId: 'ws1' }) }),
    );
  });
});

// ── T2 ──────────────────────────────────────────────────────────────────────
describe('C-11 · T2 — it publishes the row as the object it was', () => {
  it('states identity, belief, lifecycle and judgement', async () => {
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    const d = body.decision;

    // identity — C-10's class is part of it, never inferred from rootCause
    expect(d).toMatchObject({
      id: ID, decisionClass: DECISION_CLASS.SIGNAL,
      entityId: ENTITY, entityLevel: 'CAMPAIGN',
      verdict: 'KILL', confidence: 0.82,
      diagnosis: 'Spend without return.', rootCause: 'CRITICAL_PERFORMANCE_DECLINE',
      status: 'PROPOSED',
    });

    // Ruling C — the two engagement stamps. Written today, read by nothing.
    expect(d.explainedAt).toBe('2026-08-14T11:00:00.000Z');
    expect(d.intentAt).toBe('2026-08-14T11:05:00.000Z');

    // the closure axis, stated rather than omitted: null says "we looked".
    for (const k of ['humanExecutedAt', 'platformExecutedAt', 'dismissedAt',
      'resolvedAt', 'resolution', 'confidenceDelta', 'closureReason',
      'humanResponse', 'humanReasonCode', 'humanReasonNote', 'humanRespondedAt']) {
      expect(d).toHaveProperty(k);
    }
  });

  it('publishes the committed reasoning — the first read in the product to do so', async () => {
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.committed.hypotheses.value).toHaveLength(1);
    expect(body.decision.committed.counterfactuals.value).toHaveLength(1);
    expect(body.decision.committed.evidenceReference.value).toMatchObject({ population: 'CANONICAL' });
  });

  it('publishes the frozen metrics, which are the only "before" that exists', async () => {
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.committed.ctrAtDecision.value).toBe(1.64);
    expect(body.decision.committed.roasAtDecision.value).toBe(0.41);
    expect(body.decision.committed.objective.value).toBe('CONVERSIONS');
    expect(body.decision.committed.channel.value).toBe('META');
  });
});

// ── T3 / T4 / T5 — Ruling B ─────────────────────────────────────────────────
describe('C-11 · T3 — ALLOCATION is a plan artifact, not a destination (R-3)', () => {
  it('refuses with 409 and NAMES the class', async () => {
    decisionFindFirst.mockResolvedValue(signalRow({
      decisionClass: DECISION_CLASS.ALLOCATION, rootCause: 'allocation:plan-1',
    }));
    const res = await request(makeApp()).get('/decisions/' + ID).expect(409);
    expect(res.body.error).toBe('NotADecisionDestination');
    expect(res.body.decisionClass).toBe(DECISION_CLASS.ALLOCATION);
  });

  it('never answers 404 — the row EXISTS, and saying otherwise is a false claim', async () => {
    decisionFindFirst.mockResolvedValue(signalRow({ decisionClass: DECISION_CLASS.ALLOCATION }));
    const res = await request(makeApp()).get('/decisions/' + ID);
    expect(res.status).not.toBe(404);
  });

  it('and publishes no field of the row it refused', async () => {
    decisionFindFirst.mockResolvedValue(signalRow({ decisionClass: DECISION_CLASS.ALLOCATION }));
    const res = await request(makeApp()).get('/decisions/' + ID).expect(409);
    expect(JSON.stringify(res.body)).not.toContain('Spend without return');
    expect(res.body.decision).toBeUndefined();
  });
});

describe('C-11 · T4 — an UNCLASSIFIED row cannot be interpreted', () => {
  it('refuses, with a reason distinct from the ALLOCATION one', async () => {
    decisionFindFirst.mockResolvedValue(signalRow({ decisionClass: null }));
    const res = await request(makeApp()).get('/decisions/' + ID).expect(409);
    // NULL is not a fifth class and not a synonym for ALLOCATION. Collapsing
    // the two refusals would tell an operator their row is a budget plan.
    expect(res.body.error).toBe('DecisionUnclassified');
  });
});

describe('C-11 · T5 — the other two destinations are served', () => {
  it('serves GUARDRAIL, with the identity columns only its writer sets', async () => {
    decisionFindFirst.mockResolvedValue(guardrailRow());
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.decisionClass).toBe(DECISION_CLASS.GUARDRAIL);
    expect(body.decision.guardrailRuleId).toBe(RULE);
    expect(body.decision.openHitKey).toBe(ENTITY + ':' + RULE);
  });

  it('serves EXPERIMENT', async () => {
    decisionFindFirst.mockResolvedValue(guardrailRow({
      decisionClass: DECISION_CLASS.EXPERIMENT, rootCause: 'test:exp-1',
      guardrailRuleId: null, openHitKey: null,
    }));
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.decisionClass).toBe(DECISION_CLASS.EXPERIMENT);
  });

  it('does not publish guardrail identity on a class that has none', async () => {
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.guardrailRuleId).toBeNull();
  });
});

// ── T6 / T7 — the two absences that share one spelling ──────────────────────
describe('C-11 · T6 — a null names WHY it is null, in C-06 own tokens', () => {
  it('present reasoning is KNOWN', async () => {
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.committed.hypotheses.knowledge).toBe(KNOWLEDGE.KNOWN);
  });

  it('[] is NOTHING_THERE — the engine ran and produced none', async () => {
    // The schema draws this line itself: "null is never captured; [] is the
    // engine ran and produced none", which an early-gate decision under 1 000
    // impressions genuinely does. A read that collapses them erases a finding.
    decisionFindFirst.mockResolvedValue(signalRow({ hypotheses: [], counterfactuals: [] }));
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.committed.hypotheses.knowledge).toBe(KNOWLEDGE.NOTHING_THERE);
  });

  it('null on a class that DOES capture reasoning is COULD_NOT_LOOK', async () => {
    decisionFindFirst.mockResolvedValue(signalRow({ hypotheses: null }));
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.committed.hypotheses.knowledge).toBe(KNOWLEDGE.COULD_NOT_LOOK);
  });

  it('the two fields are statused INDEPENDENTLY — they can disagree', async () => {
    // Hypotheses found and no counterfactual rejected is a real engine result.
    decisionFindFirst.mockResolvedValue(signalRow({ counterfactuals: [] }));
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.committed.hypotheses.knowledge).toBe(KNOWLEDGE.KNOWN);
    expect(body.decision.committed.counterfactuals.knowledge).toBe(KNOWLEDGE.NOTHING_THERE);
  });
});

describe('C-11 · T7 — a class that never captures a field says CANNOT_ASK', () => {
  it('GUARDRAIL reasoning is CANNOT_ASK, never COULD_NOT_LOOK', async () => {
    // A guardrail sweep does not produce hypotheses and never will. Rendering
    // "no reasoning recorded" makes a claim about THIS DECISION when the truth
    // is about its CLASS — and the prerequisite that would end that absence
    // never arrives, which is precisely what C-07 forbids an absence from hiding.
    decisionFindFirst.mockResolvedValue(guardrailRow());
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    const c = body.decision.committed;
    expect(c.hypotheses.knowledge).toBe(KNOWLEDGE.CANNOT_ASK);
    expect(c.counterfactuals.knowledge).toBe(KNOWLEDGE.CANNOT_ASK);
    expect(c.ctrAtDecision.knowledge).toBe(KNOWLEDGE.CANNOT_ASK);
    expect(c.objective.knowledge).toBe(KNOWLEDGE.CANNOT_ASK);
  });

  it('but GUARDRAIL evidenceReference IS captured, so it is not excused', async () => {
    // The census measures this: the guardrail writer sets evidenceReference and
    // does not set the other five. A blanket "GUARDRAIL has no committed block"
    // would be a guess where a per-field fact exists.
    decisionFindFirst.mockResolvedValue(guardrailRow());
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.committed.evidenceReference.knowledge).toBe(KNOWLEDGE.KNOWN);
  });
});

// ── T8 / T9 / T10 / T11 ─────────────────────────────────────────────────────
describe('C-11 · T8 — workspace scope', () => {
  it('404s an id that resolves in no workspace of the callers', async () => {
    decisionFindFirst.mockResolvedValue(null);
    const res = await request(makeApp()).get('/decisions/' + ID).expect(404);
    expect(res.body.error).toBe('DecisionNotFound');
  });

  it('400s when no workspace resolved — never an empty decision', async () => {
    const res = await request(makeApp({ workspaceId: null })).get('/decisions/' + ID).expect(400);
    expect(res.body.decision).toBeUndefined();
  });
});

describe('C-11 · T9 — Ruling D: reading what Lumi decided is not an operator action', () => {
  it('serves a CLIENT seat, which can already read /decisions/recent', async () => {
    // Gating the item while the list is open would blank the detail for the one
    // seat whose entire product is reading what Lumi concluded.
    const res = await request(makeApp({ collabRole: 'CLIENT' })).get('/decisions/' + ID);
    expect(res.status).toBe(200);
  });
});

describe('C-11 · T10 — the registration-order trap', () => {
  it('/decisions/recent still resolves with a :id pattern registered', async () => {
    // This router is flat-mounted at '/' and Express matches in registration
    // order. A `/decisions/:id` placed before `/decisions/recent` captures
    // id="recent" and 404s the sidebar, with nothing anywhere reporting it.
    const res = await request(makeApp()).get('/decisions/recent').expect(200);
    expect(res.body.decisions).toEqual([]);
    expect(decisionFindFirst).not.toHaveBeenCalled();
  });
});

describe('C-11 · T11 — Ruling A and E, as absences', () => {
  it('publishes NO field named for the present', async () => {
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    const keys = JSON.stringify(body);
    for (const now of ['currentVerdict', 'liveVerdict', 'currentCtr', 'nowCtr', 'divergence']) {
      expect(keys).not.toContain(now);
    }
  });

  it('publishes no memory, and no learning — that waits for R-6 / C-16', async () => {
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.memory).toBeUndefined();
    expect(body.decision.patterns).toBeUndefined();
    expect(body.decision.learning).toBeUndefined();
  });

  it('does not publish the deprecated `executedAt` alias', async () => {
    // The two provenance facts are published separately. legacyExecutedAt
    // exists so a FROZEN client keeps working; a read born today has no frozen
    // client, and starting one with a derived alias re-creates the collapse
    // B4-A spent a slice undoing.
    const { body } = await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(body.decision.executedAt).toBeUndefined();
  });

  it('reads the decisions table ONCE — a detail read is not a join surface', async () => {
    await request(makeApp()).get('/decisions/' + ID).expect(200);
    expect(decisionFindFirst).toHaveBeenCalledTimes(1);
  });
});
