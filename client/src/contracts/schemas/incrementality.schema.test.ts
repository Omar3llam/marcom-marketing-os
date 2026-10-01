// ============================================================
// B8-05 — the holdout parse layer, measured against what the route sends
// ------------------------------------------------------------
// `GET /api/lumi/incrementality/:id` returns a Prisma row with no `select`, so
// the wire carries every column of `IncrementalityTest`. Two of them do not
// survive this schema, and each failure has a different consequence.
//
// 1 · `decisionId` is STRIPPED (C-13 F-6 — published, then eaten by the client
//     schema). A `z.object` drops unknown keys, so the field the holdout half
//     needs in order to point at the Decision it produced never reaches the
//     component. The A/B half declares it and keeps it. That is C-13's exact
//     shape once more: the two halves of one class, each missing what the other
//     has. B8-05's forward edge cannot exist on this half until it parses.
//
// 2 · The four observed counters are typed `.nullish()` under a comment saying
//     they are "empty until results are recorded". They are
//     `Int @default(0)` and NOT NULL. **That null can never arrive.** The wire
//     always says 0, and the backend itself already reads 0 as "not recorded" —
//     `concludeIncrementality` refuses on `!(test.exposedUsers > 0)`.
//
//     The schema is not narrowed here. Admitting more than arrives is the safe
//     direction (B8-01: a strict enum takes the whole surface with it), and a
//     null would still parse. What changes is that no reader may treat the
//     VALUE as the answer — R-E3 puts that question on `status`, and
//     `HoldoutDetailView` is where it is enforced.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  IncrementalityTestSchema,
  IncrementalityListResponseSchema,
  IncrementalityMonetarySchema,
} from './incrementality.schema';

// Shaped as the route actually sends it: a full row, counters present as 0.
const wireRow = (over: Record<string, unknown> = {}) => ({
  id: 'h1',
  workspaceId: 'w1',
  name: 'Meta holdout',
  channel: 'META',
  entityId: null,
  holdoutPct: 0.1,
  mde: 0.1,
  sampleSizePerArm: 1000,
  durationDays: 14,
  status: 'DESIGNED',
  exposedUsers: 0,
  exposedConversions: 0,
  holdoutUsers: 0,
  holdoutConversions: 0,
  liftPct: null,
  ciLow: null,
  ciHigh: null,
  confidenceLabel: null,
  incrementalRevenueMinor: null,
  decisionId: null,
  startedAt: null,
  concludedAt: null,
  ...over,
});

describe('SC-10 — explicit monetary absence survives the parse', () => {
  const monetary = { status: 'INSUFFICIENT_EVIDENCE', reason: 'INCREMENTALITY_MONETARY_BASIS_UNPROVEN',
    knowledge: 'NOT_ENOUGH', incrementalRevenueMinor: null, currency: null };
  it('retains monetary absence alongside causal and decision evidence', () => {
    const parsed = IncrementalityTestSchema.parse(wireRow({
      status: 'CONCLUDED', liftPct: 20, decisionId: 'd1', monetary,
    }));
    expect(parsed.monetary).toEqual(monetary);
    expect(parsed.liftPct).toBe(20);
    expect(parsed.decisionId).toBe('d1');
  });
  it('cannot validate an amount or currency under insufficient evidence', () => {
    expect(IncrementalityMonetarySchema.safeParse({ ...monetary, incrementalRevenueMinor: 50000 }).success).toBe(false);
    expect(IncrementalityMonetarySchema.safeParse({ ...monetary, currency: 'USD' }).success).toBe(false);
    expect(IncrementalityMonetarySchema.safeParse({ ...monetary, status: 'AVAILABLE' }).success).toBe(false);
  });
});

describe('B8-05 — decisionId survives the parse (C-13 F-6)', () => {
  it('a concluded holdout keeps the id of the Decision it produced', () => {
    const parsed = IncrementalityTestSchema.parse(
      wireRow({ status: 'CONCLUDED', decisionId: 'd-99', confidenceLabel: 'HIGH' }),
    );
    expect(parsed.decisionId).toBe('d-99');
  });

  it('a holdout that produced no Decision keeps the null, not an omission', () => {
    // Null is the answer "we looked, and no decision came of it". Dropping the
    // key would make that indistinguishable from "we never asked".
    const parsed = IncrementalityTestSchema.parse(wireRow({ status: 'CONCLUDED' }));
    expect(parsed).toHaveProperty('decisionId');
    expect(parsed.decisionId).toBeNull();
  });

  it('it survives the LIST envelope too — the same rows feed both surfaces', () => {
    const parsed = IncrementalityListResponseSchema.parse({
      workspaceId: 'w1',
      tests: [wireRow({ status: 'CONCLUDED', decisionId: 'd-99' })],
    });
    expect(parsed.tests[0].decisionId).toBe('d-99');
  });
});

describe('B8-05 — provenance survives the parse', () => {
  it('a promoted holdout keeps its sourceTest', () => {
    const parsed = IncrementalityTestSchema.parse(
      wireRow({ sourceTest: { id: 't1', dimension: 'HOOK', hypothesis: 'Static beats video' } }),
    );
    expect(parsed.sourceTest?.id).toBe('t1');
  });
});

describe('B8-05 — the counters parse as they actually arrive', () => {
  it('zeroes parse (this is what the wire sends for an unrun holdout)', () => {
    const parsed = IncrementalityTestSchema.parse(wireRow());
    expect(parsed.exposedUsers).toBe(0);
  });

  it('real counts parse', () => {
    const parsed = IncrementalityTestSchema.parse(
      wireRow({ status: 'RUNNING', exposedUsers: 5000, exposedConversions: 250 }),
    );
    expect(parsed.exposedUsers).toBe(5000);
  });
});
