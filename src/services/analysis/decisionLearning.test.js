// ============================================================
// getSimilarOutcomes — the track record behind "9 of 12 improved"
// ------------------------------------------------------------
// Three properties carry the weight:
//   • only decisions a human ACTED on are counted (intentAt)
//   • UNKNOWN rows are OUTSIDE the denominator — "9 of 12" must mean twelve
//     decisions that were actually scored
//   • below a defensible sample it returns null, so the UI shows nothing rather
//     than inviting "0 of 2" to be read as evidence
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { findMany: vi.fn() } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { getSimilarOutcomes, MIN_SAMPLE } from './decisionLearning.js';

const WS = 'ws-1';
const rows = (...resolutions) => resolutions.map((resolution) => ({ resolution }));
const ask = (over = {}) => getSimilarOutcomes({ workspaceId: WS, verdict: 'KILL', ...over });
const where = () => prisma.decision.findMany.mock.calls[0][0].where;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findMany.mockResolvedValue([]);
});

describe('the tally', () => {
  it('counts each scored resolution into its own bucket', async () => {
    prisma.decision.findMany.mockResolvedValue(
      rows('IMPROVED', 'IMPROVED', 'IMPROVED', 'WORSENED', 'UNCHANGED'),
    );
    expect(await ask()).toMatchObject({ total: 5, improved: 3, unchanged: 1, worsened: 1, unscored: 0 });
  });

  it('reports confidence as improved over scored outcomes', async () => {
    prisma.decision.findMany.mockResolvedValue(rows('IMPROVED', 'IMPROVED', 'IMPROVED', 'WORSENED'));
    expect((await ask()).confidence).toBeCloseTo(0.75, 5);
  });

  // "9 of 12 improved" claims twelve decisions were measured. An UNKNOWN row was
  // not measured, so including it in the denominator asserts a measurement that
  // was never taken.
  it('keeps UNKNOWN out of the denominator and reports it separately', async () => {
    prisma.decision.findMany.mockResolvedValue(
      rows('IMPROVED', 'IMPROVED', 'UNCHANGED', 'UNKNOWN', 'UNKNOWN'),
    );
    const out = await ask();
    expect(out.total).toBe(3);     // scored only
    expect(out.unscored).toBe(2);
    expect(out.improved + out.unchanged + out.worsened).toBe(out.total);
  });

  it('an unrecognised resolution is treated as unscored, never as a win', async () => {
    prisma.decision.findMany.mockResolvedValue(rows('IMPROVED', 'IMPROVED', 'IMPROVED', 'WEIRD'));
    const out = await ask();
    expect(out.total).toBe(3);
    expect(out.unscored).toBe(1);
  });
});

describe('the sample floor', () => {
  it(`returns null below ${MIN_SAMPLE} scored outcomes`, async () => {
    prisma.decision.findMany.mockResolvedValue(rows('IMPROVED', 'IMPROVED'));
    expect(await ask()).toBeNull();
  });

  it('returns null when nothing improved', async () => {
    prisma.decision.findMany.mockResolvedValue(rows('WORSENED', 'UNCHANGED', 'WORSENED', 'UNCHANGED'));
    expect(await ask()).toBeNull();
  });

  it(`returns a tally at exactly ${MIN_SAMPLE} with one improvement`, async () => {
    prisma.decision.findMany.mockResolvedValue(rows('IMPROVED', 'WORSENED', 'UNCHANGED'));
    expect(await ask()).toMatchObject({ total: 3, improved: 1 });
  });

  // The floor counts SCORED rows: three UNKNOWNs alongside two scored ones is
  // still a sample of two.
  it('UNKNOWN rows do not help clear the floor', async () => {
    prisma.decision.findMany.mockResolvedValue(rows('IMPROVED', 'UNCHANGED', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN'));
    expect(await ask()).toBeNull();
  });
});

describe('the similarity key', () => {
  it('always scopes to the workspace and the verdict', async () => {
    await ask({ verdict: 'SCALE' });
    expect(where()).toMatchObject({ workspaceId: WS, verdict: 'SCALE' });
  });

  it('narrows on every dimension the asking decision carries', async () => {
    await ask({ rootCause: 'LOW_CTR', entityLevel: 'CAMPAIGN', objective: 'OUTCOME_SALES', channel: 'META' });
    expect(where()).toMatchObject({
      rootCause: 'LOW_CTR', entityLevel: 'CAMPAIGN', objective: 'OUTCOME_SALES', channel: 'META',
    });
  });

  // A decision with no channel recorded (every row written before the column
  // existed) must compare against the WIDER set, not against nothing.
  it('omits a dimension the asking decision lacks, rather than matching null', async () => {
    await ask({ rootCause: 'LOW_CTR' });
    expect(where()).not.toHaveProperty('channel');
    expect(where()).not.toHaveProperty('objective');
    expect(where()).not.toHaveProperty('entityLevel');
    expect(where().rootCause).toBe('LOW_CTR');
  });

  it('only reads resolved decisions a human acted on', async () => {
    await ask();
    expect(where()).toMatchObject({ resolution: { not: null }, intentAt: { not: null } });
  });

  it('looks at the most recent decisions, bounded', async () => {
    await ask();
    const call = prisma.decision.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
    expect(call.take).toBe(20);
  });

  it('honours a caller-supplied limit', async () => {
    await ask({ limit: 5 });
    expect(prisma.decision.findMany.mock.calls[0][0].take).toBe(5);
  });
});

describe('no track record', () => {
  it('nothing qualifying is null, not a zero tally', async () => {
    expect(await ask()).toBeNull();
  });

  it.each([
    ['no workspace', { workspaceId: null, verdict: 'KILL' }],
    ['no verdict', { workspaceId: WS, verdict: null }],
    ['neither', {}],
  ])('%s returns null without querying', async (_label, args) => {
    expect(await getSimilarOutcomes(args)).toBeNull();
    expect(prisma.decision.findMany).not.toHaveBeenCalled();
  });

  it('no arguments at all does not throw', async () => {
    expect(await getSimilarOutcomes()).toBeNull();
  });

  it('a failed read degrades to null rather than throwing at the caller', async () => {
    prisma.decision.findMany.mockRejectedValue(new Error('db down'));
    expect(await ask()).toBeNull();
  });
});
