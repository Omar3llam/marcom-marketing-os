// ============================================================
// C-12 · T6–T10 — every deeper layer names the claim that brought you there
// ------------------------------------------------------------
// B8-04 (locked):
//
//     A history of judgments about a subject, not a history of its metrics.
//     Entered by the subject, read as calls. EVERY DEEPER LAYER MUST NAME THE
//     CLAIM THAT BROUGHT YOU THERE.
//
// And the boundary is already in the schema, not in design taste: canonical
// verdict evidence is CAMPAIGN-LEVEL ("campaign entity ids");
// `GuardrailRule.scopeLevel` is `@default(ADSET)`; `FatiguePrediction` is keyed
// `entityId:entityLevel`. So a PERFORMANCE VERDICT NEVER NAMES AN AD SET —
// only a breach or a fatigue forecast does.
//
// Measured on 26e9261: 0 of 4 drill-down routes name a claim, neither lens
// component mentions fatigue or guardrail, the client trigger is a plain
// expand toggle, and the lens consults `scopeLevel` nowhere.
//
// WHAT THIS SLICE DOES NOT DO: refuse the descent. Hiding the affordance is
// B7's ruling, and refusing here would change shipped behaviour on a ruling
// nobody has made. The route SERVES and DECLARES.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KNOWLEDGE, DECISION_CLASS } from '@marcom/runtime-contracts';
import { DRILL_BASIS, drillBasisFor } from './drillBasis.js';

const { decisionFindMany, fatigueFindMany } = vi.hoisted(() => ({
  decisionFindMany: vi.fn(), fatigueFindMany: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    decision:          { findMany: (...a) => decisionFindMany(...a) },
    fatiguePrediction: { findMany: (...a) => fatigueFindMany(...a) },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const WS  = 'ws1';
const AS1 = '11111111-1111-1111-1111-111111111111';
const AS2 = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  decisionFindMany.mockResolvedValue([]);
  fatigueFindMany.mockResolvedValue([]);
});

describe('C-12 · T6 — the basis is a published fact, not an inference', () => {
  it('names its two kinds, and nothing else', () => {
    expect(DRILL_BASIS).toEqual({
      GUARDRAIL_EPISODE: 'GUARDRAIL_EPISODE',
      FATIGUE_PREDICTION: 'FATIGUE_PREDICTION',
    });
  });

  it('returns claims beside a knowledge, never a bare array', () => {
    // A bare `[]` cannot say whether we looked. That is the whole C-03 lesson,
    // and this read has exactly the same two silences.
    return drillBasisFor(WS, [AS1]).then((b) => {
      expect(b).toHaveProperty('claims');
      expect(b).toHaveProperty('knowledge');
    });
  });
});

describe('C-12 · T7 — a guardrail episode below the campaign is a claim', () => {
  it('an open episode on an ad set names that ad set', async () => {
    decisionFindMany.mockResolvedValue([
      { id: 'g1', entityId: AS1, entityLevel: 'ADSET', decisionClass: DECISION_CLASS.GUARDRAIL },
    ]);
    const b = await drillBasisFor(WS, [AS1, AS2]);
    expect(b.knowledge).toBe(KNOWLEDGE.KNOWN);
    expect(b.claims).toEqual([
      { kind: DRILL_BASIS.GUARDRAIL_EPISODE, entityId: AS1, entityLevel: 'ADSET' },
    ]);
  });

  it('the episode read is scoped to GUARDRAIL, never to whatever is newest', async () => {
    // C-10's law. A SIGNAL verdict on an ad set would not be a licence to
    // descend — the campaign-level judgement is not about that ad set.
    await drillBasisFor(WS, [AS1]);
    expect(decisionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ decisionClass: { in: [DECISION_CLASS.GUARDRAIL] } }),
      }),
    );
  });
});

describe('C-12 · T8 — an unresolved fatigue prediction is a claim', () => {
  it('a live forecast on an ad set names that ad set', async () => {
    fatigueFindMany.mockResolvedValue([{ id: 'f1', entityId: AS2, entityLevel: 'ADSET' }]);
    const b = await drillBasisFor(WS, [AS1, AS2]);
    expect(b.knowledge).toBe(KNOWLEDGE.KNOWN);
    expect(b.claims).toEqual([
      { kind: DRILL_BASIS.FATIGUE_PREDICTION, entityId: AS2, entityLevel: 'ADSET' },
    ]);
  });

  it('a RESOLVED forecast is not a live claim', async () => {
    // A forecast that already came true or was invalidated is history. It
    // explains a past descent; it does not justify one now.
    await drillBasisFor(WS, [AS1]);
    expect(fatigueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ resolvedAt: null }) }),
    );
  });

  it('both kinds travel together when both exist', async () => {
    decisionFindMany.mockResolvedValue([
      { id: 'g1', entityId: AS1, entityLevel: 'ADSET', decisionClass: DECISION_CLASS.GUARDRAIL },
    ]);
    fatigueFindMany.mockResolvedValue([{ id: 'f1', entityId: AS2, entityLevel: 'ADSET' }]);
    const b = await drillBasisFor(WS, [AS1, AS2]);
    expect(b.claims).toHaveLength(2);
    expect(new Set(b.claims.map((c) => c.kind))).toEqual(
      new Set([DRILL_BASIS.GUARDRAIL_EPISODE, DRILL_BASIS.FATIGUE_PREDICTION]),
    );
  });
});

describe('C-12 · T9 — no claim is a FINDING, and the route still serves', () => {
  it('neither kind ⇒ NOTHING_THERE with an empty claim list', async () => {
    const b = await drillBasisFor(WS, [AS1, AS2]);
    expect(b).toEqual({ claims: [], knowledge: KNOWLEDGE.NOTHING_THERE });
  });

  it('a campaign with no children asks nothing and says so', async () => {
    // No ad sets is not "we could not look". It is the honest bottom of a
    // campaign that has none.
    const b = await drillBasisFor(WS, []);
    expect(b.knowledge).toBe(KNOWLEDGE.NOTHING_THERE);
    expect(decisionFindMany).not.toHaveBeenCalled();
    expect(fatigueFindMany).not.toHaveBeenCalled();
  });
});

describe('C-12 · T10 — a failed claim read never renders as "nothing justifies this"', () => {
  it('a failed episode read is COULD_NOT_LOOK', async () => {
    decisionFindMany.mockRejectedValue(new Error('db down'));
    const b = await drillBasisFor(WS, [AS1]);
    expect(b.knowledge).toBe(KNOWLEDGE.COULD_NOT_LOOK);
  });

  it('a failed fatigue read is COULD_NOT_LOOK too', async () => {
    fatigueFindMany.mockRejectedValue(new Error('db down'));
    const b = await drillBasisFor(WS, [AS1]);
    expect(b.knowledge).toBe(KNOWLEDGE.COULD_NOT_LOOK);
  });

  it('and a partial answer is never published as a whole one', async () => {
    // One read succeeding does not rescue the other: the claims we DID find are
    // not the claims that exist, and publishing them under KNOWN would say we
    // had looked everywhere.
    decisionFindMany.mockResolvedValue([
      { id: 'g1', entityId: AS1, entityLevel: 'ADSET', decisionClass: DECISION_CLASS.GUARDRAIL },
    ]);
    fatigueFindMany.mockRejectedValue(new Error('db down'));
    const b = await drillBasisFor(WS, [AS1]);
    expect(b.knowledge).toBe(KNOWLEDGE.COULD_NOT_LOOK);
  });

  it('it never throws — the descent works, it just cannot justify itself', async () => {
    decisionFindMany.mockRejectedValue(new Error('db down'));
    fatigueFindMany.mockRejectedValue(new Error('db down'));
    await expect(drillBasisFor(WS, [AS1])).resolves.toBeTruthy();
  });

  it('not even when a query cannot be ISSUED at all', async () => {
    // `.catch()` handles a rejection; it does not handle a synchronous throw
    // while the promise is being constructed. That throw escapes Promise.all
    // and 500s the descent — which is what happened the first time this ran
    // against a harness whose prisma mock had no `fatiguePrediction` delegate.
    // The justification for going deeper must never be able to take down the
    // descent it is justifying.
    decisionFindMany.mockImplementation(() => { throw new TypeError('no delegate'); });
    await expect(drillBasisFor(WS, [AS1])).resolves.toEqual({
      claims: [], knowledge: KNOWLEDGE.COULD_NOT_LOOK,
    });
  });
});
