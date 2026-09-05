// ============================================================
// C-16 — the memory a Decision froze does not follow the pattern  (RED)
// ============================================================
// The one assertion the whole ruling rests on cannot be made without a
// database: **mutate the pattern after commitment and show the stored record
// does not move.**
//
// `AccountPattern` is upserted in place (`@@unique([workspaceId, patternKey])`)
// and `dynamicFields` rewrites nine columns every sweep — `statement` among
// them. A mocked suite cannot demonstrate that, because nothing in it re-reads
// a row that something else rewrote. Only real Postgres can hold both versions
// of the pattern and show the Decision still carrying the first.
//
// Everything else here is a WRITE PREDICATE — which memory status lands on the
// row, and whether `confidence` and `baseConfidence` differ — and a Prisma mock
// returns whatever it was told for all of them.
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

const { dbAvailable, dbRequired } = await import('../../tests/dbProbe.js');
const { prisma } = await import('../../lib/prisma.js');
const { persistAnnotatedVerdicts } = await import('./VerdictService.js');
const { getInstitutionalMemory, MEMORY_STATUS } = await import('../pattern-engine/institutionalMemory.js');

const DB_OK = await dbAvailable();

const WS = '00000000-0000-4000-8000-0000000c1600';
const CAMPAIGN = '00000000-0000-4000-8000-0000000c1601';

/** A tree the sink accepts: one CAMPAIGN child under a rootless ACCOUNT. */
const tree = (over = {}) => ({
  level: 'ACCOUNT',
  children: [{
    id: CAMPAIGN, level: 'CAMPAIGN', name: 'C-16 fixture',
    verdict: 'KILL', verdictConfidence: 0.8, rationale: 'fixture',
    signalInput: { ctr: 2.5, roas: 0.4 },
    ...over,
  }],
});

/** A pattern that PASSES isValidatedMemory: ESTABLISHED, accuracy and support above the floors. */
const validatedPattern = (over = {}) => prisma.accountPattern.create({
  data: {
    workspaceId: WS, patternKey: `c16-${randomUUID()}`, kind: 'FATIGUE_CEILING',
    statement: 'KILL calls hold on fatigued creative', status: 'ESTABLISHED',
    accuracy: 0.9, confidence: 0.8, support: 20, effectiveSupport: 20,
    emitVerdict: 'KILL', scopeLevel: null,
    firstObservedAt: new Date('2026-06-01T00:00:00Z'),
    lastObservedAt:  new Date('2026-09-01T00:00:00Z'),
    ...over,
  },
  select: { id: true },
});

const written = () => prisma.decision.findFirst({
  where: { workspaceId: WS, entityId: CAMPAIGN },
  orderBy: { createdAt: 'desc' },
  select: {
    confidence: true, baseConfidence: true, memoryStatus: true, memoryProvenance: true,
  },
});

describe('C-16 — this contract must actually run', () => {
  it('a full-verification run provides a migrated database', () => {
    if (dbRequired()) expect(DB_OK, 'REQUIRE_DB=1 — this suite must run against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('C-16 · the write path records the memory that shaped the call', () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({ where: { id: WS }, update: {}, create: { id: WS, name: 'C16' } });
  });
  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    await prisma.accountPattern.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
  });
  beforeEach(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: WS } });
    await prisma.accountPattern.deleteMany({ where: { workspaceId: WS } });
  });

  it('T19 · THE RULING: mutating the pattern does not move what the Decision froze', async () => {
    // The assertion R-6 exists for. A stored patternId would silently start
    // reporting the new sentence and the new accuracy — an audit trail that
    // looks correct and lies.
    const p = await validatedPattern();
    const memory = await getInstitutionalMemory(WS);
    await persistAnnotatedVerdicts(WS, tree(), { skipRoot: true, memory });

    const before = await written();
    expect(before.memoryProvenance.patterns[0].statement).toBe('KILL calls hold on fatigued creative');
    expect(before.memoryProvenance.patterns[0].accuracy).toBe(0.9);

    // The upsert every extraction performs, in miniature.
    await prisma.accountPattern.update({
      where: { id: p.id },
      data: { statement: 'REWRITTEN BY A LATER SWEEP', accuracy: 0.61 },
    });

    const after = await written();
    expect(after.memoryProvenance.patterns[0].statement).toBe('KILL calls hold on fatigued creative');
    expect(after.memoryProvenance.patterns[0].accuracy).toBe(0.9);
  });

  it('T20 · the published and base confidences are both stored, and differ', async () => {
    await validatedPattern();
    const memory = await getInstitutionalMemory(WS);
    await persistAnnotatedVerdicts(WS, tree(), { skipRoot: true, memory });

    const row = await written();
    expect(row.memoryStatus).toBe(MEMORY_STATUS.OK);
    expect(row.baseConfidence).toBe(0.8);
    expect(row.confidence).not.toBe(row.baseConfidence);
    expect(row.memoryProvenance.applied).toBe(true);
  });

  it('T21 · a writer given no memory records NOT_CONSULTED — the state every old row is in', async () => {
    await persistAnnotatedVerdicts(WS, tree(), { skipRoot: true });
    const row = await written();
    expect(row.memoryStatus).toBe(MEMORY_STATUS.NOT_CONSULTED);
    expect(row.memoryProvenance).toBeNull();
    expect(row.confidence).toBe(row.baseConfidence);
  });

  it('T22 · an account with no validated memory is recorded as such, not as an outage', async () => {
    // No patterns at all — `getInstitutionalMemory` answers NO_VALIDATED_MEMORY,
    // a finding about the ACCOUNT. It must never land as MEMORY_UNAVAILABLE,
    // which is a finding about US.
    const memory = await getInstitutionalMemory(WS);
    expect(memory.status).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);

    await persistAnnotatedVerdicts(WS, tree(), { skipRoot: true, memory });
    const row = await written();
    expect(row.memoryStatus).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
    expect(row.confidence).toBe(row.baseConfidence);
    expect(row.memoryProvenance.patterns).toEqual([]);
  });

  it('T23 · an UNVALIDATED pattern never reaches the record', async () => {
    // Below the accuracy floor: real, stored, and deliberately not memory.
    await validatedPattern({ accuracy: 0.2, statement: 'too weak to count' });
    const memory = await getInstitutionalMemory(WS);
    await persistAnnotatedVerdicts(WS, tree(), { skipRoot: true, memory });

    const row = await written();
    expect(row.memoryStatus).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
    expect(row.memoryProvenance.patterns).toEqual([]);
  });

  it('T24 · a pattern about a DIFFERENT verdict is not frozen onto this call', async () => {
    await validatedPattern({ emitVerdict: 'SCALE', statement: 'about scaling, not killing' });
    const memory = await getInstitutionalMemory(WS);
    await persistAnnotatedVerdicts(WS, tree(), { skipRoot: true, memory });

    const row = await written();
    expect(row.memoryProvenance.patterns).toEqual([]);
    expect(row.confidence).toBe(row.baseConfidence);
  });

  it('T25 · no row carries a fabricated 0.5', async () => {
    // The `?? 0.5` this slice removed. A node with no confidence at all writes
    // null — "we did not measure this" — rather than an invented coin flip.
    await persistAnnotatedVerdicts(WS, tree({ verdictConfidence: null }), { skipRoot: true });
    const row = await written();
    expect(row.confidence).toBeNull();
    expect(row.baseConfidence).toBeNull();
  });
});
