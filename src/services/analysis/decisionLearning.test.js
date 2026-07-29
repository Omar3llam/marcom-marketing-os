// ============================================================
// getSimilarOutcomes — the track record behind "9 of 12 improved"
// ------------------------------------------------------------
// The counts must be defensible before anything renders them. Two properties
// carry the weight: only decisions a human ACTED on are counted (intentAt), and
// UNKNOWN is carried rather than folded away — hiding the unscoreable ones would
// inflate every success rate the product ever shows.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { findMany: vi.fn() } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { getSimilarOutcomes } from './decisionLearning.js';

const WS = 'ws-1';
const rows = (...resolutions) => resolutions.map((resolution) => ({ resolution }));

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findMany.mockResolvedValue([]);
});

describe('the tally', () => {
  it('counts each resolution into its own bucket', async () => {
    prisma.decision.findMany.mockResolvedValue(
      rows('IMPROVED', 'IMPROVED', 'WORSENED', 'UNCHANGED', 'UNKNOWN'),
    );
    expect(await getSimilarOutcomes(WS, 'KILL')).toEqual({
      total: 5, improved: 2, unchanged: 1, worsened: 1, unknown: 1,
    });
  });

  // Folding UNKNOWN into the others would let "2 of 5 improved" quietly become
  // "2 of 4" — a better-looking number the data does not support.
  it('carries UNKNOWN instead of hiding it', async () => {
    prisma.decision.findMany.mockResolvedValue(rows('IMPROVED', 'UNKNOWN', 'UNKNOWN'));
    const out = await getSimilarOutcomes(WS, 'KILL');
    expect(out.unknown).toBe(2);
    expect(out.total).toBe(3); // the denominator stays honest
  });

  it('an unrecognised resolution falls to unknown, never silently dropped', async () => {
    prisma.decision.findMany.mockResolvedValue(rows('IMPROVED', 'WEIRD', null));
    const out = await getSimilarOutcomes(WS, 'KILL');
    expect(out.total).toBe(3);
    expect(out.improved + out.unchanged + out.worsened + out.unknown).toBe(out.total);
  });
});

describe('what it refuses to count', () => {
  it('reads only resolved decisions a human acted on', async () => {
    await getSimilarOutcomes(WS, 'KILL');
    expect(prisma.decision.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        workspaceId: WS, verdict: 'KILL',
        resolution: { not: null },
        intentAt: { not: null },
      },
    }));
  });

  it('scopes to the workspace and the verdict asked about', async () => {
    await getSimilarOutcomes(WS, 'SCALE');
    expect(prisma.decision.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: WS, verdict: 'SCALE' });
  });

  it('looks at the most recent decisions, bounded', async () => {
    await getSimilarOutcomes(WS, 'KILL');
    const call = prisma.decision.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
    expect(call.take).toBe(20);
  });

  it('honours a caller-supplied limit', async () => {
    await getSimilarOutcomes(WS, 'KILL', { limit: 5 });
    expect(prisma.decision.findMany.mock.calls[0][0].take).toBe(5);
  });
});

describe('no track record', () => {
  // All zeros must read as "we have never done this", not "this never works".
  it('nothing qualifying is all zeros, not a throw', async () => {
    expect(await getSimilarOutcomes(WS, 'KILL')).toEqual({
      total: 0, improved: 0, unchanged: 0, worsened: 0, unknown: 0,
    });
  });

  it.each([[null, 'KILL'], [WS, null], [null, null]])(
    'missing arguments (%s, %s) return the empty tally without querying', async (ws, verdict) => {
      expect(await getSimilarOutcomes(ws, verdict)).toEqual({
        total: 0, improved: 0, unchanged: 0, worsened: 0, unknown: 0,
      });
      expect(prisma.decision.findMany).not.toHaveBeenCalled();
    });

  it('a failed read degrades to zeros rather than throwing at the caller', async () => {
    prisma.decision.findMany.mockRejectedValue(new Error('db down'));
    expect(await getSimilarOutcomes(WS, 'KILL')).toMatchObject({ total: 0 });
  });

  it('returns a fresh object each call (no shared mutable EMPTY)', async () => {
    const a = await getSimilarOutcomes(WS, 'KILL');
    a.improved = 99;
    expect((await getSimilarOutcomes(WS, 'KILL')).improved).toBe(0);
  });
});
