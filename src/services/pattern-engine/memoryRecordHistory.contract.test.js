// ============================================================
// C-14 — the belief's history, on real rows  (RED)
// ------------------------------------------------------------
// What is under test IS the predicate: which observations count as "checked",
// and which of those count as "held". A Prisma mock answers `correct: { not:
// null }` and `correct: true` identically — with whatever it was handed — so a
// mocked suite would pass with both predicates wired to the same thing, or to
// nothing. The distinction only exists once PostgreSQL is the one applying it,
// and a three-valued Boolean column (true / false / NULL) is exactly where a
// mock's agreement is least trustworthy.
//
// The supersession half is here for a second reason: `onDelete: SetNull` is a
// database guarantee, and T15's whole argument — that an unresolvable pointer
// is COULD_NOT_LOOK rather than "replaced nothing" — rests on the pointer never
// dangling. That is demonstrated on PostgreSQL, not asserted in a comment.
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { KNOWLEDGE } from '@marcom/runtime-contracts';

const { dbAvailable, dbRequired } = await import('../../tests/dbProbe.js');
const { prisma } = await import('../../lib/prisma.js');
const { checksByPattern, replacementOf } = await import('./patternHistory.js');
const { readBriefing } = await import('./PatternService.js');

const DB_OK = await dbAvailable();

const WS    = '00000000-0000-4000-8000-0000000c14a0';
const OTHER = '00000000-0000-4000-8000-0000000c14a1';

const pattern = (workspaceId, over = {}) => prisma.accountPattern.create({
  data: {
    workspaceId, patternKey: `c14-${randomUUID()}`, kind: 'FATIGUE_CEILING',
    statement: 'CTR decays after day 9', status: 'ESTABLISHED',
    firstObservedAt: new Date('2026-06-01T00:00:00Z'),
    lastObservedAt:  new Date('2026-09-01T00:00:00Z'),
    ...over,
  },
  select: { id: true },
});

// `correct` is a THREE-valued column: true, false, and NULL for an occurrence
// whose outcome was never measured. All three are constructed here because the
// difference between them is the entire claim.
const observation = (workspaceId, patternId, correct) => prisma.patternObservation.create({
  data: {
    workspaceId, patternId, occurrenceKey: randomUUID(),
    predicted: 'CTR falls', actual: correct == null ? null : 'measured',
    correct, observedAt: new Date('2026-08-01T00:00:00Z'),
  },
});

describe('C-14 — this contract must actually run', () => {
  it('a full-verification run provides a migrated database', () => {
    if (dbRequired()) expect(DB_OK, 'REQUIRE_DB=1 — this suite must run against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('C-14 · the belief’s history on real rows', () => {
  beforeAll(async () => {
    for (const id of [WS, OTHER]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name: `C14-${id.slice(-1)}` } });
    }
  });
  afterAll(async () => {
    await prisma.patternObservation.deleteMany({ where: { workspaceId: { in: [WS, OTHER] } } });
    await prisma.accountPattern.deleteMany({ where: { workspaceId: { in: [WS, OTHER] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS, OTHER] } } });
  });
  beforeEach(async () => {
    await prisma.patternObservation.deleteMany({ where: { workspaceId: { in: [WS, OTHER] } } });
    await prisma.accountPattern.deleteMany({ where: { workspaceId: { in: [WS, OTHER] } } });
  });

  it('T23 · NULL correct is not a check — the three-valued column decides it', async () => {
    const { id } = await pattern(WS);
    await observation(WS, id, true);
    await observation(WS, id, true);
    await observation(WS, id, false);
    await observation(WS, id, null);   // seen, never scored
    await observation(WS, id, null);

    const map = await checksByPattern(WS, [id]);
    expect(map.get(id)).toEqual({ made: 3, held: 2, knowledge: KNOWLEDGE.KNOWN });
  });

  it('T24 · a belief seen but never scored reads NOTHING_THERE, not 0%', async () => {
    const { id } = await pattern(WS);
    await observation(WS, id, null);
    const map = await checksByPattern(WS, [id]);
    expect(map.get(id)).toEqual({ made: 0, held: 0, knowledge: KNOWLEDGE.NOTHING_THERE });
  });

  it('T25 · a belief checked and always wrong is 0 held — a measurement, not an absence', async () => {
    // The distinction I54 drew for `accuracy`, one layer down: 0 of 4 is a
    // finding about the belief; "never checked" is a finding about us.
    const { id } = await pattern(WS);
    for (let i = 0; i < 4; i += 1) await observation(WS, id, false);
    const map = await checksByPattern(WS, [id]);
    expect(map.get(id)).toEqual({ made: 4, held: 0, knowledge: KNOWLEDGE.KNOWN });
  });

  it('T26 · another workspace’s observations never count toward this belief', async () => {
    const { id } = await pattern(WS);
    await observation(WS, id, true);
    const foreign = await pattern(OTHER);
    await observation(OTHER, foreign.id, true);
    await observation(OTHER, foreign.id, true);

    const map = await checksByPattern(WS, [id]);
    expect(map.get(id).made).toBe(1);
  });

  it('T27 · the pointer resolves FORWARD — the loser names what replaced it', async () => {
    // Direction proven on real rows, not inferred: the row carrying
    // `supersededById` is the SUPERSEDED one, and it points at the winner.
    const older = await pattern(WS, { statement: 'CTR decays after day 6', status: 'SUPERSEDED' });
    const newer = await pattern(WS, { statement: 'CTR decays after day 9' });
    await prisma.accountPattern.update({ where: { id: older.id }, data: { supersededById: newer.id } });

    const rows = await prisma.accountPattern.findMany({
      where: { workspaceId: WS }, select: { id: true, supersededById: true },
    });
    const map = await replacementOf(WS, rows);
    expect(map.get(older.id)).toEqual({
      value: { id: newer.id, statement: 'CTR decays after day 9' },
      knowledge: KNOWLEDGE.KNOWN,
    });
    // The winner is not told what it beat. That is the reverse edge, and it has
    // no ruling behind it.
    expect(map.get(newer.id).knowledge).toBe(KNOWLEDGE.NOTHING_THERE);
  });

  it('T28 · onDelete SetNull means a pointer never dangles', async () => {
    // T15 refuses to publish "replaced nothing" for an unresolvable pointer.
    // That refusal is only coherent because the database clears the pointer
    // rather than leaving it aimed at a deleted row — demonstrated, not assumed.
    const older = await pattern(WS, { statement: 'older' });
    const newer = await pattern(WS, { statement: 'newer' });
    await prisma.accountPattern.update({ where: { id: older.id }, data: { supersededById: newer.id } });
    await prisma.accountPattern.delete({ where: { id: newer.id } });

    const row = await prisma.accountPattern.findUnique({
      where: { id: older.id }, select: { supersededById: true },
    });
    expect(row.supersededById).toBeNull();
  });

  it('T29 · readBriefing publishes both facts on every pattern it returns', async () => {
    const older = await pattern(WS, { statement: 'CTR decays after day 6', status: 'SUPERSEDED' });
    const newer = await pattern(WS, { statement: 'CTR decays after day 9' });
    await prisma.accountPattern.update({ where: { id: older.id }, data: { supersededById: newer.id } });
    await observation(WS, older.id, true);
    await observation(WS, older.id, false);

    const { patterns } = await readBriefing(WS);
    const got = patterns.find((p) => p.id === older.id);
    expect(got.checks).toEqual({ made: 2, held: 1, knowledge: KNOWLEDGE.KNOWN });
    expect(got.replacedBy.value.statement).toBe('CTR decays after day 9');
  });

  it('T30 · the counts are RAW and accuracy stays WEIGHTED — never reconciled', async () => {
    // The two must be publishable side by side without one implying the other.
    // `accuracy` is written by the extraction pass; C-14 does not touch it, and
    // a briefing read must not recompute or overwrite it from these counts.
    const { id } = await pattern(WS, { accuracy: 0.85, confidence: 0.7 });
    await observation(WS, id, true);
    await observation(WS, id, true);
    await observation(WS, id, true);
    await observation(WS, id, false);
    await observation(WS, id, false);

    const { patterns } = await readBriefing(WS);
    const got = patterns.find((p) => p.id === id);
    expect(got.checks).toEqual({ made: 5, held: 3, knowledge: KNOWLEDGE.KNOWN });
    expect(got.accuracy).toBe(0.85);      // 3/5 = 0.60 — and it is NOT overwritten
  });

  it('T31 · the two facts that already crossed still cross', async () => {
    const { id } = await pattern(WS);
    const { patterns } = await readBriefing(WS);
    const got = patterns.find((p) => p.id === id);
    expect(got.firstObservedAt).toBeInstanceOf(Date);
    expect(got.lastObservedAt).toBeInstanceOf(Date);
    expect(typeof got.effectiveSupport).toBe('number');
    expect(typeof got.support).toBe('number');
  });
});
