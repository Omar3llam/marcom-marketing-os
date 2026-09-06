// ============================================================
// B8-03 — the THEN list, proven on real rows
// ------------------------------------------------------------
// WHY THIS NEEDS POSTGRES
//
//   · A cursor is only correct if the ordering is TOTAL. `createdAt` ties when a
//     sweep writes several rows in one transaction — which is the normal case,
//     not an edge one — and a tie without a tiebreak makes a cursor skip or
//     repeat rows. A mock cannot produce that tie.
//   · `total` must come from a COUNT over the same predicate, not from the
//     page. B8-01's forbidden inference is exactly this: a capped list is not a
//     capped count. Only a real table can have more rows than a page.
//   · Class exclusion has to be proven against rows that EXIST. Asserting that
//     ALLOCATION is absent from a fixture that never contained one is vacuous.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

const { dbAvailable, dbRequired } = await import('../../tests/dbProbe.js');
const { prisma } = await import('../../lib/prisma.js');
const { getDecisionHistoryPage } = await import('./decisionHistoryList.js');

const DB_OK = await dbAvailable();

const WS = randomUUID();
const ENTITY = randomUUID();
const T0 = new Date('2026-09-01T00:00:00.000Z');

/** All five rows share ONE createdAt, so the tiebreak is under test. */
const SAME_INSTANT = new Date('2026-08-01T00:00:00.000Z');

const row = (over = {}) => ({
  workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN',
  decisionClass: 'SIGNAL', verdict: 'KILL', diagnosis: 'B8-03 fixture',
  confidence: 0.7, status: 'PROPOSED', createdAt: T0, ...over,
});

describe('B8-03 — this contract must actually run', () => {
  it('a full-verification run provides a migrated database', () => {
    if (dbRequired()) expect(DB_OK, 'REQUIRE_DB=1 — this suite must run against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('B8-03 · the THEN list over real rows', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: 'B8-03' } });
    await prisma.decision.createMany({
      data: [
        // Three SIGNAL rows at distinct instants, newest last.
        row({ createdAt: new Date('2026-09-03T00:00:00.000Z'), diagnosis: 'newest' }),
        row({ createdAt: new Date('2026-09-02T00:00:00.000Z'), diagnosis: 'middle' }),
        row({ createdAt: new Date('2026-09-01T00:00:00.000Z'), diagnosis: 'oldest' }),
        // A CLOSED pair — the population THEN exists to show.
        row({ status: 'SUPERSEDED', createdAt: new Date('2026-08-20T00:00:00.000Z'), diagnosis: 'superseded' }),
        row({ status: 'RESOLVED',   createdAt: new Date('2026-08-19T00:00:00.000Z'), diagnosis: 'resolved' }),
        // A guardrail episode — must appear; the sidebar read cannot see it.
        row({ decisionClass: 'GUARDRAIL', confidence: 0.9, createdAt: new Date('2026-08-18T00:00:00.000Z'), diagnosis: 'guardrail' }),
        // An allocation row — R-3: exists in the table, never in this list.
        row({ decisionClass: 'ALLOCATION', createdAt: new Date('2026-08-17T00:00:00.000Z'), diagnosis: 'allocation' }),
        // Five rows sharing ONE instant, to force the id tiebreak.
        ...Array.from({ length: 5 }, (_, i) => row({ createdAt: SAME_INSTANT, diagnosis: `tie-${i}` })),
      ],
    });
  });
  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });

  it('returns SIGNAL and GUARDRAIL, and never ALLOCATION', async () => {
    const page = await getDecisionHistoryPage({ workspaceId: WS, limit: 100 });
    const classes = new Set(page.decisions.map((d) => d.decisionClass));
    expect(classes.has('SIGNAL')).toBe(true);
    expect(classes.has('GUARDRAIL')).toBe(true);
    // Non-vacuous: the allocation row is really there.
    const stored = await prisma.decision.count({ where: { workspaceId: WS, decisionClass: 'ALLOCATION' } });
    expect(stored).toBe(1);
    expect(classes.has('ALLOCATION')).toBe(false);
  });

  it('includes CLOSED decisions — THEN is historical commitment', async () => {
    const page = await getDecisionHistoryPage({ workspaceId: WS, limit: 100 });
    const statuses = new Set(page.decisions.map((d) => d.status));
    expect(statuses.has('SUPERSEDED')).toBe(true);
    expect(statuses.has('RESOLVED')).toBe(true);
  });

  it('orders by the clock, newest first', async () => {
    const page = await getDecisionHistoryPage({ workspaceId: WS, limit: 3 });
    expect(page.decisions.map((d) => d.diagnosis)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('TOTAL is the whole population, not the page size', async () => {
    const page = await getDecisionHistoryPage({ workspaceId: WS, limit: 3 });
    expect(page.decisions).toHaveLength(3);
    // 12 rows written, 1 of them ALLOCATION → 11 in this jurisdiction.
    expect(page.total).toBe(11);
    expect(page.total).not.toBe(page.decisions.length);
  });

  it('pages with a cursor and never repeats or skips a tied row', async () => {
    // THE RULING: five rows share one createdAt. Without the id tiebreak a
    // cursor walks them non-deterministically and the operator sees a row
    // twice, or never.
    const seen = [];
    let cursor = null;
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const page = await getDecisionHistoryPage({ workspaceId: WS, limit: 2, cursor });
      seen.push(...page.decisions.map((d) => d.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(11);              // every row, once
    expect(new Set(seen).size).toBe(11);        // and no duplicates
  });

  it('reports no cursor on the last page', async () => {
    const page = await getDecisionHistoryPage({ workspaceId: WS, limit: 100 });
    expect(page.nextCursor).toBeNull();
  });

  it('does not hand one workspace another\'s history', async () => {
    const page = await getDecisionHistoryPage({ workspaceId: randomUUID(), limit: 100 });
    expect(page.decisions).toEqual([]);
    expect(page.total).toBe(0);
  });
});
