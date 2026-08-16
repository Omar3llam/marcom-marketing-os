// ============================================================
// R9 — the reader, driven end to end with only the DB client mocked
// ============================================================
// Every test below calls the real `readDailyObservations`, so the query it
// issues, the reduction it performs and the contract it applies are all under
// test together. What it protects:
//
//   • the population is NAMED in the query and re-checked on the way out
//   • the scope is four required facts and cannot be widened
//   • a row is placed in time by its DECLARED PERIOD, never by when it was synced
//   • a day the platform did not report stays NOT_OBSERVED — never a zero
//   • duplicate rows for one day reduce deterministically, and the one case that
//     cannot be decided says so instead of picking
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { metricSnapshot: { findMany: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import {
  readDailyObservations, classifyAndReduce, logicalDay,
  OBSERVATION_STATUS, ROW_REJECTION, DAILY_OBSERVATION_SELECT,
} from './dailyObservationReader.js';
import { COMPARABILITY } from './observationComparability.js';

const WS = 'ws-1';
const ENTITY = 'e1';
const DAY = (d) => new Date(`2026-08-${d}T00:00:00.000Z`);
// The operator acted mid-morning on the 10th — deliberately NOT midnight, so the
// day containing the boundary is a real case rather than an edge one.
const EXECUTED_AT = new Date('2026-08-10T09:30:00.000Z');

/** A raw DAILY row, as Phase E writes it. */
const row = (d, over = {}) => ({
  id: `row-${d}`,
  workspaceId: WS,
  entityId: ENTITY,
  entityLevel: 'CAMPAIGN',
  source: 'META',
  measurementWindow: 'DAILY',
  date: new Date('2026-08-17T09:00:00.000Z'), // the sync that read it
  windowStart: DAY(d),
  windowEnd: DAY(d),
  spendMinor: 42000,
  revenueMinor: 210000,
  impressions: 15000,
  clicks: 300,
  conversions: 12,
  ctr: 0.02,
  roas: 5,
  reach: null,
  frequency: null,
  currency: 'EGP',
  ...over,
});

const read = (over = {}) => readDailyObservations(WS, {
  entityId: ENTITY, entityLevel: 'CAMPAIGN', source: 'META', executedAt: EXECUTED_AT, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
});

describe('R9 — the query', () => {
  it('names the DAILY population and never infers it from granularity', async () => {
    await read();
    const args = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(args.where.measurementWindow).toBe('DAILY');
    // `granularity` is hardcoded DAILY by every writer, on 90-day and lifetime
    // rows. Reading it as proof of a daily measurement is the exact mistake
    // `measurementWindow` exists to make impossible.
    expect(args.where).not.toHaveProperty('granularity');
  });

  it('scopes to one workspace, one entity, one level and one source', async () => {
    await read();
    const { where } = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(where.workspaceId).toBe(WS);
    expect(where.entityId).toBe(ENTITY);
    expect(where.entityLevel).toBe('CAMPAIGN');
    expect(where.source).toBe('META');
  });

  it('cannot be widened to a list of entities', async () => {
    // Structural, not a rule to remember: `entityId` is a scalar predicate, so
    // there is no shape a caller could pass that would match a second entity.
    await read({ entityId: ['e1', 'e2'] });
    const { where } = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(where.entityId).not.toHaveProperty('in');
    expect(Array.isArray(where.entityId)).toBe(true); // passed through as-is…
    // …and Prisma would reject it. What must never happen is a silent OR across
    // entities, which is what `{ in: [...] }` would have produced.
  });

  it('bounds the range on the MEASURED day, not on the sync timestamp', async () => {
    // A row synced today about a day three weeks ago belongs to that day. A range
    // over `date` would miss it, and would admit rows about days outside the span.
    await read({ beforeDays: 2, afterDays: 3 });
    const { where } = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(where.windowStart).toEqual({
      gte: new Date('2026-08-08T00:00:00.000Z'),
      lte: new Date('2026-08-13T00:00:00.000Z'),
    });
    expect(where).not.toHaveProperty('date');
  });

  it('names its projection, including the row id its own contract requires', async () => {
    await read();
    const args = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(args.select).toEqual(DAILY_OBSERVATION_SELECT);
    expect(args.select.id).toBe(true);
    expect(args.select.windowStart).toBe(true);
    expect(args.select.date).toBe(true);
  });

  it('orders by measured day, then by observation instant', async () => {
    await read();
    expect(prisma.metricSnapshot.findMany.mock.calls[0][0].orderBy)
      .toEqual([{ windowStart: 'asc' }, { date: 'asc' }]);
  });

  it('refuses to run without any part of its scope', async () => {
    await expect(readDailyObservations('', { entityId: ENTITY, entityLevel: 'CAMPAIGN', source: 'META', executedAt: EXECUTED_AT })).rejects.toThrow(/workspaceId/);
    await expect(read({ entityId: null })).rejects.toThrow(/entityId/);
    await expect(read({ entityLevel: null })).rejects.toThrow(/entityLevel/);
    await expect(read({ source: null })).rejects.toThrow(/source/);
    await expect(read({ executedAt: 'never' })).rejects.toThrow(/executedAt/);
    await expect(read({ beforeDays: 0 })).rejects.toThrow(/beforeDays/);
    await expect(read({ afterDays: 1.5 })).rejects.toThrow(/afterDays/);
  });
});

describe('R9 — classification is by declared period, never by sync order', () => {
  it('places whole days on the side of the boundary they fall on', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([row('08'), row('09'), row('11'), row('12')]);
    const res = await read();
    expect(res.before.map((o) => o.day)).toEqual(['2026-08-08', '2026-08-09']);
    expect(res.after.map((o) => o.day)).toEqual(['2026-08-11', '2026-08-12']);
  });

  it('refuses the day the boundary falls inside — it is neither before nor after', async () => {
    // The intervention happened partway through the 10th, so that day is evidence
    // for a period that is half pre- and half post-execution. There is no
    // tolerance and no rounding to midnight.
    prisma.metricSnapshot.findMany.mockResolvedValue([row('09'), row('10'), row('11')]);
    const res = await read();
    expect(res.before.map((o) => o.day)).toEqual(['2026-08-09']);
    expect(res.after.map((o) => o.day)).toEqual(['2026-08-11']);
    expect(res.excluded).toEqual([{ id: 'row-10', reason: ROW_REJECTION.CROSSES_BOUNDARY }]);
  });

  it('puts a day starting exactly at the boundary on the after side', async () => {
    // Midnight execution: the day that begins at that instant is cleanly after,
    // and the one that ended at it is cleanly before. No gap, no overlap.
    prisma.metricSnapshot.findMany.mockResolvedValue([row('09'), row('10')]);
    const res = await read({ executedAt: DAY('10') });
    expect(res.before.map((o) => o.day)).toEqual(['2026-08-09']);
    expect(res.after.map((o) => o.day)).toEqual(['2026-08-10']);
    expect(res.excluded).toEqual([]);
  });

  it('ignores the observation timestamp when deciding the side', async () => {
    // THE CONTROL. The pre-execution day was synced LAST (a late backfill) and the
    // post-execution day FIRST. Classifying by `date` would swap them; classifying
    // by the declared period cannot.
    prisma.metricSnapshot.findMany.mockResolvedValue([
      row('09', { date: new Date('2026-09-30T00:00:00Z') }),
      row('11', { date: new Date('2026-08-11T09:00:00Z') }),
    ]);
    const res = await read();
    expect(res.before.map((o) => o.day)).toEqual(['2026-08-09']);
    expect(res.after.map((o) => o.day)).toEqual(['2026-08-11']);
    expect(res.status).toBe(OBSERVATION_STATUS.MEASURABLE);
  });

  it('is not decided by the order rows arrive in', async () => {
    const forward = classifyAndReduce([row('09'), row('11')], EXECUTED_AT);
    const reverse = classifyAndReduce([row('11'), row('09')], EXECUTED_AT);
    expect(forward).toEqual(reverse);
  });
});

describe('R9 — rows this reader will not treat as daily observations', () => {
  it('excludes a row from another population even if one reaches it', async () => {
    // The query filters, so this is the second lock. A rolling aggregate must not
    // be EXPOSED as a day — refusing it later at the pair level would be too late,
    // because by then it has already been read as one.
    prisma.metricSnapshot.findMany.mockResolvedValue([
      row('09'), row('11', { measurementWindow: 'ROLLING_WINDOW' }),
    ]);
    const res = await read();
    expect(res.after).toEqual([]);
    expect(res.excluded).toEqual([{ id: 'row-11', reason: ROW_REJECTION.WRONG_POPULATION }]);
  });

  it('excludes a LEGACY_UNKNOWN row the same way', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([row('11', { measurementWindow: 'LEGACY_UNKNOWN' })]);
    const res = await read();
    expect(res.after).toEqual([]);
    expect(res.excluded[0].reason).toBe(ROW_REJECTION.WRONG_POPULATION);
  });

  it('excludes a row with no declared period', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([row('11', { windowStart: null, windowEnd: null })]);
    const res = await read();
    expect(res.after).toEqual([]);
    expect(res.excluded[0].reason).toBe(ROW_REJECTION.MISSING_PERIOD);
  });

  it('excludes a period that is not exactly one day', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([row('11', { windowEnd: DAY('13') })]);
    const res = await read();
    expect(res.after).toEqual([]);
    expect(res.excluded[0].reason).toBe(ROW_REJECTION.MALFORMED_PERIOD);
  });

  it('excludes a row with no observation instant — nothing could rank it', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([row('11', { date: null })]);
    const res = await read();
    expect(res.excluded[0].reason).toBe(ROW_REJECTION.MISSING_OBSERVED);
  });
});

describe('R9 — a day nobody observed stays unobserved', () => {
  it('names the missing days instead of filling them with zero', async () => {
    // 8th observed, 9th missing, boundary, 11th observed, 12th missing.
    prisma.metricSnapshot.findMany.mockResolvedValue([row('08'), row('11')]);
    const res = await read({ beforeDays: 2, afterDays: 2 });

    expect(res.before.map((o) => o.day)).toEqual(['2026-08-08']);
    expect(res.notObserved.before).toEqual(['2026-08-09']);
    expect(res.notObserved.after).toEqual(['2026-08-12']);
    // Nothing anywhere in the result claims a zero-spend day.
    expect(res.before.every((o) => o.spendMinor === 42000)).toBe(true);
  });

  it('reports NOT_OBSERVED — not NOT_MEASURABLE — when a side is simply empty', async () => {
    // "We have no reading for that side" and "we refuse to compare these" are
    // different facts with different fixes, and a caller must be able to tell them
    // apart to say anything true to a human.
    prisma.metricSnapshot.findMany.mockResolvedValue([row('11')]);
    const res = await read();
    expect(res.status).toBe(OBSERVATION_STATUS.NOT_OBSERVED);
    expect(res.pair.before).toBeNull();
    expect(res.pair.reason).toBe(COMPARABILITY.MISSING_OBSERVATION);
  });

  it('never interpolates, forward-fills or back-fills a gap', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([row('08', { spendMinor: 10000 }), row('12', { spendMinor: 30000 })]);
    const res = await read({ beforeDays: 3, afterDays: 3 });
    const days = [...res.before, ...res.after].map((o) => o.day);
    expect(days).toEqual(['2026-08-08', '2026-08-12']);
    expect(res.notObserved.before).toEqual(['2026-08-07', '2026-08-09']);
    expect(res.notObserved.after).toEqual(['2026-08-11', '2026-08-13']);
  });
});

describe('R9 — duplicate rows for one day', () => {
  const early = row('11', { id: 'r-early', date: new Date('2026-08-12T09:00:00Z'), spendMinor: 10000 });
  const late = row('11', { id: 'r-late', date: new Date('2026-08-15T09:00:00Z'), spendMinor: 12500 });

  it('reduces to the LATEST observation of that day', async () => {
    // Phase E documented that the database cannot enforce one row per entity-day,
    // so two concurrent syncs can each land one. A restatement is later than what
    // it restates, so the newest reading is the current belief.
    prisma.metricSnapshot.findMany.mockResolvedValue([early, late]);
    const res = await read();
    expect(res.after).toHaveLength(1);
    expect(res.after[0].id).toBe('r-late');
    expect(res.after[0].spendMinor).toBe(12500);
  });

  it('reduces the same way whichever order the rows arrive in', async () => {
    const forward = classifyAndReduce([early, late], EXECUTED_AT);
    const reverse = classifyAndReduce([late, early], EXECUTED_AT);
    expect(forward.after[0].id).toBe('r-late');
    expect(reverse.after[0].id).toBe('r-late');
  });

  it('refuses a day whose newest rows disagree at the same instant', async () => {
    // Nothing in the data ranks them. Picking one would make the answer depend on
    // which row the database happened to return first.
    const twin = row('11', { id: 'r-twin', date: late.date, spendMinor: 99999 });
    prisma.metricSnapshot.findMany.mockResolvedValue([row('09'), late, twin]);
    const res = await read();

    expect(res.after[0].ambiguous).toBe(true);
    expect(res.after[0].tiedIds).toEqual(['r-late', 'r-twin']);
    expect(res.status).toBe(OBSERVATION_STATUS.AMBIGUOUS);
    expect(res.pair.comparable).toBe(false);
    expect(res.pair.reason).toBe(COMPARABILITY.AMBIGUOUS_OBSERVATION);
  });

  it('does not call two identical readings ambiguous — but names both rows', async () => {
    // Same instant, same numbers: one measurement written twice. Deterministic by
    // lowest id so a re-run reproduces the same provenance, and both ids are
    // reported so the duplication is visible rather than hidden.
    const copy = { ...late, id: 'r-copy' };
    prisma.metricSnapshot.findMany.mockResolvedValue([row('09'), late, copy]);
    const res = await read();
    expect(res.after[0].ambiguous).toBeUndefined();
    expect(res.after[0].id).toBe('r-copy'); // lowest id, deterministically
    expect(res.after[0].tiedIds).toEqual(['r-copy', 'r-late']);
    expect(res.status).toBe(OBSERVATION_STATUS.MEASURABLE);
  });
});

describe('R9 — what the result says', () => {
  it('answers MEASURABLE with the adjacent pair and the rows it consumed', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([row('08'), row('09'), row('11'), row('12')]);
    const res = await read();

    expect(res.status).toBe(OBSERVATION_STATUS.MEASURABLE);
    expect(res.reason).toBeNull();
    expect(res.pair.before.day).toBe('2026-08-09'); // the LAST day before
    expect(res.pair.after.day).toBe('2026-08-11');  // the FIRST day after
    expect(res.pair.comparable).toBe(true);
    expect(res.boundary).toBe(EXECUTED_AT.toISOString());
  });

  it('carries the two counts R5 keeps apart', async () => {
    // rowCount is what the read CONSUMED; refs are what survived reduction and
    // contributed. Collapsing them would either hide the reduction or overstate
    // the evidence.
    prisma.metricSnapshot.findMany.mockResolvedValue([
      row('11', { id: 'a', date: new Date('2026-08-12T09:00:00Z') }),
      row('11', { id: 'b', date: new Date('2026-08-15T09:00:00Z') }),
      row('09'),
    ]);
    const res = await read();
    expect(res.rowCount).toBe(3);
    expect(res.refs).toHaveLength(2);
    expect(res.refs.map((r) => r.id).sort()).toEqual(['b', 'row-09']);
  });

  it('names every row it used, in the shape R5 left empty for a Tier 2 consumer', async () => {
    // R6's evidenceReference carries `refs: []` because no reader projected row
    // identity. These are exactly the row-level references it was waiting for —
    // and R9 persists nothing, so it hands them back rather than storing them.
    prisma.metricSnapshot.findMany.mockResolvedValue([row('09')]);
    const [ref] = (await read()).refs;
    expect(ref).toEqual({
      id: 'row-09',
      entityId: ENTITY,
      source: 'META',
      observedAt: new Date('2026-08-17T09:00:00.000Z'),
      windowStart: DAY('09'),
      windowEnd: DAY('09'),
    });
  });

  it('passes metric values through untouched, nulls included', async () => {
    // A null ratio is "this row measured no ratio". Coercing it to 0 would
    // manufacture a measurement the platform never made — and 0.00× ROAS reads as
    // catastrophic performance rather than as absent data.
    prisma.metricSnapshot.findMany.mockResolvedValue([row('09', { roas: null, ctr: null, revenueMinor: 0 })]);
    const [o] = (await read()).before;
    expect(o.roas).toBeNull();
    expect(o.ctr).toBeNull();
    expect(o.revenueMinor).toBe(0); // a real measured zero survives as a zero
    expect(o.reach).toBeNull();
    expect(o.frequency).toBeNull();
  });

  it('renames `date` to observedAt on the way out, and only there', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([row('09')]);
    const [o] = (await read()).before;
    expect(o.observedAt).toEqual(new Date('2026-08-17T09:00:00.000Z'));
    expect(o).not.toHaveProperty('date');
    expect(o.day).toBe('2026-08-09');
    expect(logicalDay(o)).toBe('2026-08-09');
  });

  it('never uses the word outcome', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([row('09'), row('11')]);
    const res = await read();
    const json = JSON.stringify(res);
    for (const forbidden of ['outcome', 'success', 'failure', 'predictionCorrect', 'accuracy', 'sustained']) {
      expect(json).not.toContain(forbidden);
    }
  });
});
