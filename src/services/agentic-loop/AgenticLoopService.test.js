// ============================================================
// AgenticLoopService.buildLoopInputs — the connector-verdict wiring
// ------------------------------------------------------------
// The Phase-9 fix: the buyer band's verdict query must load BOTH guardrail
// hits AND connector verdicts (revenue + awareness), de-duped to the latest
// per entity, and stay workspace-scoped. Only the DB + the pacing/blended/
// test/plan read-services are mocked; the query shape is asserted directly.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    decision:            { findMany: vi.fn() },
    fatiguePrediction:   { findMany: vi.fn() },
    testExperiment:      { findMany: vi.fn() },
    plan:                { findMany: vi.fn() },
    allocationPlan:      { findMany: vi.fn() },
    action:              { findMany: vi.fn() },
    outcomeSnapshot:     { findMany: vi.fn() },
    decisionMemoryEntry: { findMany: vi.fn() },
    account:             { findMany: vi.fn() },
    campaign:            { findMany: vi.fn() },
    adSet:               { findMany: vi.fn() },
    workspace:           { findUnique: vi.fn() },
  },
}));
vi.mock('../portfolio/PortfolioService.js',       () => ({ getPortfolio: vi.fn() }));
vi.mock('../test-generator/TestGeneratorService.js', () => ({ getWeeklyAgenda: vi.fn() }));
vi.mock('../planning/PlanService.js',             () => ({ trackPlan: vi.fn() }));
vi.mock('../blended-truth/BlendedTruthService.js', () => ({ getBlendedTruth: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { getPortfolio } from '../portfolio/PortfolioService.js';
import { getWeeklyAgenda } from '../test-generator/TestGeneratorService.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { SIGNAL_TYPE } from '../diagnosis-engine/index.js';
import { ROOT_CAUSE } from '../verdict-engine/verdictTypes.js';
import { FUNNEL_SIGNAL } from '../verdict-engine/funnelDiagnosis.js';
import { BUYER_ACTIONABLE_ROOT_CAUSES, CONNECTOR_ROOT_CAUSES } from '../verdict-engine/decisionIdentity.js';
import { buildLoopInputs } from './AgenticLoopService.js';
import { planAgenda } from './agenticPlanner.js';

const WS  = '7517d1b9-b967-44f3-a77f-60f5c577f867';
const now = new Date('2026-07-02T00:00:00.000Z');

// A connector verdict as VerdictService persists it: rootCause = the diagnosis
// signalType (NOT a `guardrail:` prefix), status PROPOSED.
const connectorVerdict = {
  id: 'cv1', entityId: 'c1d2e3f4-0000-0000-0000-000000000010', entityLevel: 'CAMPAIGN',
  verdict: 'REFRESH', rationale: 'Creative fatigue detected', rootCause: SIGNAL_TYPE.CREATIVE_FATIGUE, status: 'PROPOSED',
};

/**
 * Would a Decision carrying this rootCause be SELECTED by the query the service
 * actually issued?
 *
 * Evaluating the `where` clause is the only way to test the boundary here:
 * prisma is mocked, so `findMany.mockResolvedValue([row])` hands the row back
 * whatever the filter says. A test that seeds an INSUFFICIENT_DATA row and
 * watches it appear in the agenda would pass identically against a query with
 * NO scope at all — it would prove the planner's behaviour and nothing about
 * the exclusion. So: read the clauses the service passed, and interpret them.
 */
function scopeAdmits(orClauses, rootCause) {
  return orClauses.some((clause) => {
    const rc = clause.rootCause;
    if (rc === null) return rootCause === null;
    if (Array.isArray(rc?.in)) return rc.in.includes(rootCause);
    if (typeof rc?.startsWith === 'string') return typeof rootCause === 'string' && rootCause.startsWith(rc.startsWith);
    return false;
  });
}

/** The OR clauses buildLoopInputs passed to the Decision query. */
async function verdictScope() {
  await buildLoopInputs(WS, { now });
  return prisma.decision.findMany.mock.calls[0][0].where.OR;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Every organ cold by default; the verdict query is overridden per-test.
  for (const model of ['fatiguePrediction', 'testExperiment', 'plan', 'allocationPlan',
    'action', 'outcomeSnapshot', 'decisionMemoryEntry', 'account', 'campaign', 'adSet']) {
    prisma[model].findMany.mockResolvedValue([]);
  }
  prisma.decision.findMany.mockResolvedValue([]);
  prisma.workspace.findUnique.mockResolvedValue({ objective: null }); // no onboarding objective by default
  getPortfolio.mockResolvedValue(null);
  getBlendedTruth.mockResolvedValue(null);
  getWeeklyAgenda.mockResolvedValue([]);
});

describe('buildLoopInputs — verdict query wiring', () => {
  it('loads connector verdicts (signalType rootCause), not only guardrail hits', async () => {
    prisma.decision.findMany.mockResolvedValue([connectorVerdict]);
    const inputs = await buildLoopInputs(WS, { now });
    expect(inputs.verdicts).toEqual([connectorVerdict]);
  });

  it('widens the query to guardrail + connector verdicts, workspace-scoped, latest-per-entity', async () => {
    await buildLoopInputs(WS, { now });
    const args = prisma.decision.findMany.mock.calls[0][0];
    expect(args.where.workspaceId).toBe(WS);
    expect(args.where.status).toBe('PROPOSED');
    expect(args.distinct).toEqual(['entityId', 'entityLevel']);

    // The OR must cover BOTH families — guardrail prefix AND the connector scope.
    // Checked against the EXPORTED scope, not a restated `Object.values(SIGNAL_TYPE)`:
    // that was a third copy of the taxonomy, and it asserted only "at least the
    // old values are present" — which is why it never noticed FUNNEL_SIGNAL going
    // missing, and why it broke the moment a SIGNAL_TYPE was deliberately excluded.
    const hasGuardrail = args.where.OR.some((c) => c.rootCause?.startsWith === 'guardrail:');
    const hasConnector = args.where.OR.some((c) => Array.isArray(c.rootCause?.in)
      && BUYER_ACTIONABLE_ROOT_CAUSES.every((t) => c.rootCause.in.includes(t)));
    expect(hasGuardrail).toBe(true);
    expect(hasConnector).toBe(true);
  });

  it('a connector verdict flows through the planner into a buyer CONFIRM item', async () => {
    prisma.decision.findMany.mockResolvedValue([connectorVerdict]);
    const inputs = await buildLoopInputs(WS, { now });
    const agenda = planAgenda(inputs);
    const item = agenda.buyerBand.find((i) => i.evidenceRef === 'cv1');
    expect(item).toBeTruthy();
    expect(item.type).toBe('VERDICT');
    expect(item.entityId).toBe(connectorVerdict.entityId);
  });

  it('empty connector data → empty verdicts → the planner reports a quiet loop', async () => {
    const inputs = await buildLoopInputs(WS, { now });
    expect(inputs.verdicts).toEqual([]);
    expect(planAgenda(inputs).buyerBand).toEqual([]);
    expect(planAgenda(inputs).summary).toMatch(/quiet/i);
  });

  it('returns an impactById map in the inputs (empty when no connector data)', async () => {
    const inputs = await buildLoopInputs(WS, { now });
    expect(inputs.impactById).toBeInstanceOf(Map);
    expect(inputs.impactById.size).toBe(0); // no connector campaigns mocked → no scores
  });
});

// ── The buyer-band boundary ─────────────────────────────────────────────────
// The regression these pin: the loop's scope was a SECOND copy of the connector
// taxonomy (`Object.values(SIGNAL_TYPE)`), so when funnel diagnosis shipped its
// FUNNEL_DROP_* causes, those verdicts were persisted and then silently dropped
// on the way to the agenda. The old assertion — every SIGNAL_TYPE is present —
// could not catch that: it proved "at least the old values", never "this is the
// intended boundary".
describe('buildLoopInputs — buyer-actionable scope', () => {
  it('admits funnel verdicts — the family the old SIGNAL_TYPE-only scope dropped', async () => {
    const or = await verdictScope();
    for (const signal of Object.values(FUNNEL_SIGNAL)) {
      expect(scopeAdmits(or, signal), `${signal} must reach the buyer band`).toBe(true);
    }
  });

  it('a persisted funnel verdict flows through the planner into a buyer CONFIRM item', async () => {
    // The query half is asserted above; this is the downstream half — nothing
    // between the row and the agenda rejects a funnel rootCause either.
    const funnelVerdict = {
      ...connectorVerdict, id: 'fv1', verdict: 'REALLOCATE',
      rootCause: FUNNEL_SIGNAL.POST_CLICK,
      diagnosis: 'Clicks arrive, conversions do not — the drop is after the click',
    };
    prisma.decision.findMany.mockResolvedValue([funnelVerdict]);
    const inputs = await buildLoopInputs(WS, { now });

    const item = planAgenda(inputs).buyerBand.find((i) => i.evidenceRef === 'fv1');
    expect(item).toBeTruthy();
    expect(item.type).toBe('VERDICT');
    expect(item.entityId).toBe(funnelVerdict.entityId);
  });

  it('excludes data-quality states — "not judged yet" is not a decision to confirm', async () => {
    const or = await verdictScope();
    // Both are emitted as WATCH, which agenticPlanner ranks HIGH. Admitting them
    // would sort the engine's own blind spots to the top of the buyer's agenda.
    expect(scopeAdmits(or, ROOT_CAUSE.INSUFFICIENT_DATA)).toBe(false);
    expect(scopeAdmits(or, ROOT_CAUSE.TOO_EARLY)).toBe(false);
  });

  // Asserted on the QUERY, not on a seeded row: the prisma mock returns whatever
  // it is given regardless of the filter, so `mockResolvedValue([undiagnosable])`
  // would prove nothing about the database boundary.
  it('excludes UNDIAGNOSABLE while still admitting HEALTHY', async () => {
    const or = await verdictScope();
    expect(scopeAdmits(or, SIGNAL_TYPE.UNDIAGNOSABLE)).toBe(false);
    // The pair matters: both are terminal diagnosis states, and only one of them
    // can never be a decision. HEALTHY rides on cohort-ranked KILLs and SCALEs.
    expect(scopeAdmits(or, SIGNAL_TYPE.HEALTHY)).toBe(true);
  });

  it('keeps the clauses that were already correct: guardrail hits and a null cause', async () => {
    const or = await verdictScope();
    expect(scopeAdmits(or, 'guardrail:spend_spike')).toBe(true);
    expect(scopeAdmits(or, null)).toBe(true);
    // The other PROPOSED writers have their own surfaces and stay out.
    expect(scopeAdmits(or, 'allocation:plan-1')).toBe(false);
    expect(scopeAdmits(or, 'incrementality:test-1')).toBe(false);
    expect(scopeAdmits(or, 'test:variant-a')).toBe(false);
  });

  it('issues exactly the exported scope — no local copy of the taxonomy', async () => {
    const or = await verdictScope();
    const listed = or.find((c) => Array.isArray(c.rootCause?.in));
    expect(listed.rootCause.in).toEqual(BUYER_ACTIONABLE_ROOT_CAUSES);
  });
});

describe('BUYER_ACTIONABLE_ROOT_CAUSES — the exact contract', () => {
  // Exact membership, derived from the canonical sources rather than retyped. A
  // fifth cause added to CONNECTOR_ROOT_CAUSES breaks THIS test, forcing a
  // deliberate answer to "is this a decision, or a state the engine reached
  // without judging?" — the question that went unasked when FUNNEL_SIGNAL landed.
  it('is exactly connector identity minus the states that are not judgements', () => {
    const expected = CONNECTOR_ROOT_CAUSES
      .filter((c) => !Object.values(ROOT_CAUSE).includes(c))
      .filter((c) => c !== SIGNAL_TYPE.UNDIAGNOSABLE);
    expect(new Set(BUYER_ACTIONABLE_ROOT_CAUSES)).toEqual(new Set(expected));
    // Set equality would forgive a duplicate; the query's `in` should not carry one.
    expect(BUYER_ACTIONABLE_ROOT_CAUSES.length).toBe(new Set(BUYER_ACTIONABLE_ROOT_CAUSES).size);
  });

  // Named members, so the set cannot be quietly emptied and still satisfy the
  // derivation above (which would pass against any two identical expressions).
  it('admits every diagnosable mechanism and every funnel stage', () => {
    for (const cause of [
      SIGNAL_TYPE.LOW_CTR, SIGNAL_TYPE.CREATIVE_FATIGUE,
      SIGNAL_TYPE.AUDIENCE_MISMATCH, SIGNAL_TYPE.INEFFICIENT_SCALING,
      SIGNAL_TYPE.HEALTHY,
      ...Object.values(FUNNEL_SIGNAL),
    ]) {
      expect(BUYER_ACTIONABLE_ROOT_CAUSES, `${cause} must stay admitted`).toContain(cause);
    }
  });

  it('excludes every data-quality cause', () => {
    for (const cause of Object.values(ROOT_CAUSE)) {
      expect(BUYER_ACTIONABLE_ROOT_CAUSES, `${cause} is not a decision`).not.toContain(cause);
    }
    expect(BUYER_ACTIONABLE_ROOT_CAUSES).not.toContain(ROOT_CAUSE.INSUFFICIENT_DATA);
    expect(BUYER_ACTIONABLE_ROOT_CAUSES).not.toContain(ROOT_CAUSE.TOO_EARLY);
  });

  // "No rule could be EVALUATED" — not a thin sample, but absent fields. It
  // carries confidence 0 and no observations, and enters as WATCH, which the
  // planner ranks HIGH. Unreachable from the production path today (toSignalInput
  // zero-fills ctr/frequency, so some rule always runs); excluded so it cannot
  // arrive at the top of the agenda unannounced if that ever changes.
  it('excludes UNDIAGNOSABLE — the engine could not look, which is not a finding', () => {
    expect(BUYER_ACTIONABLE_ROOT_CAUSES).not.toContain(SIGNAL_TYPE.UNDIAGNOSABLE);
  });

  // The counterpart, and the more consequential half: rootCause and verdict are
  // decoupled. applyRelativeRanking rewrites the verdict but leaves the absolute
  // pass's rootCause, so a cohort-ranked KILL persists with rootCause HEALTHY.
  // Dropping HEALTHY would take real KILL and SCALE decisions with it.
  it('still admits HEALTHY — a cohort-ranked KILL persists with rootCause HEALTHY', () => {
    expect(BUYER_ACTIONABLE_ROOT_CAUSES).toContain(SIGNAL_TYPE.HEALTHY);
  });

  it('leaves connector identity untouched — UNDIAGNOSABLE is still connector-authored', () => {
    expect(CONNECTOR_ROOT_CAUSES).toContain(SIGNAL_TYPE.UNDIAGNOSABLE);
    expect(CONNECTOR_ROOT_CAUSES).toContain(ROOT_CAUSE.INSUFFICIENT_DATA);
    expect(CONNECTOR_ROOT_CAUSES).toContain(ROOT_CAUSE.TOO_EARLY);
  });

  it('is a strict subset of connector identity — actionability narrows authorship, never widens it', () => {
    for (const cause of BUYER_ACTIONABLE_ROOT_CAUSES) {
      expect(CONNECTOR_ROOT_CAUSES).toContain(cause);
    }
    expect(BUYER_ACTIONABLE_ROOT_CAUSES.length).toBeLessThan(CONNECTOR_ROOT_CAUSES.length);
  });
});

describe('buildLoopInputs — onboarding objective wiring', () => {
  it('loads the workspace objective (workspace-scoped) and threads it into the agenda', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ objective: 'roas' });
    const inputs = await buildLoopInputs(WS, { now });

    // workspace-scoped fetch
    expect(prisma.workspace.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: WS }, select: { objective: true } }),
    );
    expect(inputs.objective).toBe('roas');
    expect(planAgenda(inputs).summary).toMatch(/return on ad spend/i);
  });

  it('falls back gracefully when the objective is null (no crash, unframed summary)', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ objective: null });
    const inputs = await buildLoopInputs(WS, { now });
    expect(inputs.objective).toBeNull();
    expect(planAgenda(inputs).summary).not.toMatch(/optimizing for/i);
  });

  it('never crashes when the workspace row is missing entirely', async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    const inputs = await buildLoopInputs(WS, { now });
    expect(inputs.objective).toBeNull();
  });
});
