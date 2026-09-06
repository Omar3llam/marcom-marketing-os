// ============================================================
// B8-01 — the Decision status vocabulary the client is allowed to admit
// ------------------------------------------------------------
// WHAT THIS PROTECTS
//
//   A Decision that CLOSED must survive the client boundary.
//
// WHY IT NEEDS PROTECTING
//
// `prisma/schema.prisma` declares five DecisionStatus values; this schema
// declared three. The two it omitted — SUPERSEDED and RESOLVED — are the two a
// HISTORICAL decision ends up in:
//
//   SUPERSEDED  a newer verdict replaced this one   (VerdictService)
//   RESOLVED    the condition ended with no human act (C-02, guardrail sweep)
//
// PROPOSED / EXECUTED / DISMISSED are the three a decision is in while it is
// still someone's problem. So the omitted pair is not an edge case — it is the
// steady state of every decision that is no longer live, which is precisely the
// population the THEN destination (B7 R-N2, `/app/decisions`) exists to show.
//
// A strict zod enum does not blank the field. It fails the whole parse and
// takes the surface with it — the rule this very file already states four lines
// above `confidence`. So the failure mode is not "status renders blank", it is
// "the decision history is empty", which is [[failure ≠ empty]] on the one
// surface built to explain what Lumi decided.
//
// LATENT, NOT LIVE — and that is why it is closed now. `DecisionSchema` has
// ZERO importers on trunk today, so nothing is currently broken by the gap and
// no test could have caught it from behaviour. B8 slice 3 gives it its first
// consumer. The C-16 rule applies in reverse: a slice that is about to ARM a
// guard owns proving the guard admits the truth first.
// ============================================================
import { describe, it, expect } from 'vitest';
import { DecisionSchema, DecisionStatusSchema } from './decision.schema';

/** A Decision the backend can genuinely produce, minus the status under test. */
const base = {
  id: 'dec_1',
  workspaceId: 'ws_1',
  entityId: 'camp_1',
  entityLevel: 'CAMPAIGN' as const,
  verdict: 'KILL' as const,
  confidence: 0.82,
  diagnosis: 'ROAS below floor for 14 days',
  rootCause: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('B8-01 · DecisionStatusSchema admits every status the backend writes', () => {
  // The five values in prisma/schema.prisma `enum DecisionStatus`.
  const BACKEND_STATUSES = ['PROPOSED', 'EXECUTED', 'DISMISSED', 'SUPERSEDED', 'RESOLVED'];

  it.each(BACKEND_STATUSES)('accepts status %s', (status) => {
    expect(DecisionStatusSchema.safeParse(status).success).toBe(true);
  });

  it('parses a SUPERSEDED decision as a whole object, not just the field', () => {
    const result = DecisionSchema.safeParse({ ...base, status: 'SUPERSEDED' });
    expect(result.success).toBe(true);
  });

  it('parses a RESOLVED decision — a close with no human act', () => {
    const result = DecisionSchema.safeParse({ ...base, status: 'RESOLVED' });
    expect(result.success).toBe(true);
  });

  it('still refuses a status the backend cannot write', () => {
    // Widening is not opening. An unknown status is still a contract violation,
    // and must keep failing so contractDrift can report it.
    expect(DecisionStatusSchema.safeParse('ARCHIVED').success).toBe(false);
  });

  it('keeps PROPOSED as the default when status is absent', () => {
    const result = DecisionSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('PROPOSED');
  });
});
