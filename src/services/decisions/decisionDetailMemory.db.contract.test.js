// ============================================================
// B8-01 — the memory fields survive a REAL row, read as columns
// ------------------------------------------------------------
// WHY THIS EXISTS BESIDE THE PURE TEST
//
// `decisionDetailMemory.contract.test.js` proves `detailBody()` copies the
// three fields. It CANNOT prove `DETAIL_SELECT` names real columns: a
// misspelled select key is a Prisma error only against a live schema, and a
// pure test stays green while `/decisions/:id` 500s in production. C-04 is the
// standing precedent — a field can exist on the wire and still not reach a
// client; here a field can exist in a projection and not exist in the database.
//
// It also settles one thing only Postgres can: a SQL NULL provenance and a JSON
// `null` provenance are spelled the same way by Prisma, and only one of them
// means "memory was never consulted".
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

const { dbAvailable, dbRequired } = await import('../../tests/dbProbe.js');
const { prisma } = await import('../../lib/prisma.js');
const { getDecisionDetail } = await import('./decisionDetail.js');

const DB_OK = await dbAvailable();

const WS = randomUUID();
const ENTITY = randomUUID();

const PROV = Object.freeze({
  factor: 0.89,
  applied: true,
  patterns: [{ patternId: 'pat_1', statement: 'KILL calls hold on this account', accuracy: 0.8, effectiveSupport: 12 }],
});

const mkDecision = (over = {}) => prisma.decision.create({
  data: {
    workspaceId: WS, entityId: ENTITY, entityLevel: 'CAMPAIGN',
    decisionClass: 'SIGNAL', verdict: 'KILL', diagnosis: 'B8-01 real-row fixture',
    confidence: 0.71, baseConfidence: 0.8, memoryStatus: 'OK', memoryProvenance: PROV,
    ...over,
  },
  select: { id: true },
});

describe('B8-01 — this contract must actually run', () => {
  it('a full-verification run provides a migrated database', () => {
    if (dbRequired()) expect(DB_OK, 'REQUIRE_DB=1 — this suite must run against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('B8-01 · /decisions/:id publishes the stored memory columns', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: 'B8-01' } });
  });
  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });

  it('DETAIL_SELECT names real columns — the read returns 200, not P2022', async () => {
    const { id } = await mkDecision();
    const res = await getDecisionDetail({ id, workspaceId: WS });
    expect(res.status).toBe(200);
  });

  it('publishes exactly what the columns hold, read back with SQL', async () => {
    const { id } = await mkDecision();
    const res = await getDecisionDetail({ id, workspaceId: WS });
    const d = res.payload.decision;

    // Read the STORED columns, not Prisma's mapping of the same call.
    const [row] = await prisma.$queryRaw`
      SELECT "memoryProvenance"::text AS prov,
             "baseConfidence"          AS base,
             "memoryStatus"::text      AS status
      FROM "decisions" WHERE id = ${id}::uuid`;

    expect(JSON.parse(row.prov)).toEqual(d.memoryProvenance);
    expect(Number(row.base)).toBe(d.baseConfidence);
    expect(row.status).toBe(d.memoryStatus);
    // And the value is the one that was committed, patterns intact.
    expect(d.memoryProvenance).toEqual(PROV);
  });

  it('a never-consulted read publishes SQL NULL as null, and says why', async () => {
    const { id } = await mkDecision({
      memoryProvenance: undefined, baseConfidence: null,
      memoryStatus: 'NOT_CONSULTED', confidence: null,
    });

    const [row] = await prisma.$queryRaw`
      SELECT ("memoryProvenance" IS NULL) AS is_sql_null
      FROM "decisions" WHERE id = ${id}::uuid`;
    expect(row.is_sql_null).toBe(true);

    const d = (await getDecisionDetail({ id, workspaceId: WS })).payload.decision;
    // STATED, not omitted — the file's rule for every closure axis.
    expect('memoryProvenance' in d).toBe(true);
    expect(d.memoryProvenance).toBeNull();
    expect(d.memoryStatus).toBe('NOT_CONSULTED');
    // C-16's invariant, restated at the boundary: null is not zero.
    expect(d.baseConfidence).toBeNull();
    expect(d.confidence).toBeNull();
  });

  it('does not hand the provenance to another workspace', async () => {
    // Non-vacuity: the assertions above would also pass on a read that ignored
    // its tenant predicate.
    const { id } = await mkDecision();
    const res = await getDecisionDetail({ id, workspaceId: randomUUID() });
    expect(res.status).not.toBe(200);
  });
});
