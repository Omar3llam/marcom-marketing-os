// ============================================================
// C-14 — a belief's own history: what it was checked against  (RED)
// ------------------------------------------------------------
// B8-05 asks for four temporal facts per belief. Two already cross the wire
// (`firstObservedAt`/`lastObservedAt`, and `support` beside `effectiveSupport`)
// and are merely unrendered. Two cannot cross at all, and this module is those:
//
//   how often tested / how often right   — computed by score(), then DISCARDED
//   what it replaced                     — a real pointer, never selected
//
// ── THE DEFECT THIS EXISTS TO END ───────────────────────────────────────────
//
// `score()` (patternEngine.js:123) builds `known` — the observations carrying a
// measured outcome — divides the weighted correct-sum by it, returns the
// quotient, and keeps neither count. `AccountPattern` has no column for either.
// So a belief reaches a person as a bare percentage:
//
//       2 of 3    →  67%
//     200 of 300  →  67%
//
// The same number, carrying utterly different weight. C-09's shape one object
// over — computed every run, stored nowhere — and I54's argument one step on:
// I54 stopped a FABRICATED prior rendering as a percentage; a REAL ratio with
// no denominator is still a figure the reader cannot weigh.
//
// ── WHY THE COUNTS ARE NOT `accuracy`'S DENOMINATOR ─────────────────────────
//
// `accuracy` is recency-WEIGHTED; these counts are RAW. A belief right recently
// and wrong long ago legitimately reads 0.85 beside 3 of 5, and that is not a
// contradiction — it is two facts about one belief, at two altitudes. They are
// published side by side and never reconciled (R-5's rule, one object down),
// which is also why this field is not named after accuracy.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KNOWLEDGE } from '@marcom/runtime-contracts';

const { groupBy, findMany } = vi.hoisted(() => ({ groupBy: vi.fn(), findMany: vi.fn() }));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    patternObservation: { groupBy: (...a) => groupBy(...a) },
    accountPattern:     { findMany: (...a) => findMany(...a) },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { checksByPattern, replacementOf } = await import('./patternHistory.js');

const WS = '00000000-0000-4000-8000-0000000c1400';
const P1 = '00000000-0000-4000-8000-0000000c1401';
const P2 = '00000000-0000-4000-8000-0000000c1402';
const OLD = '00000000-0000-4000-8000-0000000c1403';

// groupBy is called twice — `made` (correct is not null) then `held`
// (correct is true). Ordering matters, so the double is explicit about which.
const counts = ({ made = [], held = [] }) => {
  groupBy.mockResolvedValueOnce(made.map(([patternId, n]) => ({ patternId, _count: { _all: n } })));
  groupBy.mockResolvedValueOnce(held.map(([patternId, n]) => ({ patternId, _count: { _all: n } })));
};

beforeEach(() => { groupBy.mockReset(); findMany.mockReset(); });

describe('C-14 · A — how often tested, how often right', () => {
  it('T1 · publishes both raw counts for a belief that has been checked', async () => {
    counts({ made: [[P1, 5]], held: [[P1, 3]] });
    const map = await checksByPattern(WS, [P1]);
    expect(map.get(P1)).toEqual({ made: 5, held: 3, knowledge: KNOWLEDGE.KNOWN });
  });

  it('T2 · every requested id gets an entry — the caller never supplies a default', async () => {
    // A default at the call site is where a default becomes a lie: `?? 0` would
    // silently turn "we could not look" into "never checked".
    counts({ made: [[P1, 2]], held: [[P1, 2]] });
    const map = await checksByPattern(WS, [P1, P2]);
    expect(map.has(P1)).toBe(true);
    expect(map.has(P2)).toBe(true);
  });

  it('T3 · a belief with no scored observation is NOTHING_THERE, and counts zero', async () => {
    // We looked, and there is nothing. A finding, not a failure — so the zero is
    // a true measurement and travels as one.
    counts({ made: [], held: [] });
    const map = await checksByPattern(WS, [P2]);
    expect(map.get(P2)).toEqual({ made: 0, held: 0, knowledge: KNOWLEDGE.NOTHING_THERE });
  });

  it('T4 · a FAILED read is COULD_NOT_LOOK with NULL counts, never zero', async () => {
    // C-03's ruling. A zero is a claim — "this belief has never been checked" —
    // and publishing our own outage as that claim is the whole defect.
    groupBy.mockRejectedValueOnce(new Error('observation read exploded'));
    groupBy.mockResolvedValueOnce([]);
    const map = await checksByPattern(WS, [P1]);
    expect(map.get(P1)).toEqual({ made: null, held: null, knowledge: KNOWLEDGE.COULD_NOT_LOOK });
  });

  it('T5 · a failure in EITHER read fails the pair — no half answer', async () => {
    counts({ made: [[P1, 5]] });
    groupBy.mockReset();
    groupBy.mockResolvedValueOnce([{ patternId: P1, _count: { _all: 5 } }]);
    groupBy.mockRejectedValueOnce(new Error('held read exploded'));
    const map = await checksByPattern(WS, [P1]);
    expect(map.get(P1).knowledge).toBe(KNOWLEDGE.COULD_NOT_LOOK);
    expect(map.get(P1).made).toBeNull();
  });

  it('T6 · held never exceeds made — a belief cannot hold more often than it was checked', async () => {
    counts({ made: [[P1, 3]], held: [[P1, 3]] });
    const map = await checksByPattern(WS, [P1]);
    expect(map.get(P1).held).toBeLessThanOrEqual(map.get(P1).made);
  });

  it('T7 · no ids means no reads issued at all', async () => {
    const map = await checksByPattern(WS, []);
    expect(map.size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('T8 · a missing workspace does not fall back to a cross-workspace read', async () => {
    const map = await checksByPattern(null, [P1]);
    expect(map.get(P1).knowledge).toBe(KNOWLEDGE.COULD_NOT_LOOK);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('T9 · both reads are workspace-scoped and id-scoped', async () => {
    counts({ made: [[P1, 1]], held: [[P1, 1]] });
    await checksByPattern(WS, [P1]);
    for (const call of groupBy.mock.calls) {
      expect(call[0].where.workspaceId).toBe(WS);
      expect(call[0].where.patternId).toEqual({ in: [P1] });
    }
  });

  it('T10 · the two reads differ ONLY in what makes an observation count', async () => {
    // The whole claim is the predicate: `made` is every observation carrying a
    // measured outcome, `held` is the subset that was right. A mock answers
    // both identically, which is why the real-row contract test exists too.
    counts({ made: [[P1, 1]], held: [[P1, 1]] });
    await checksByPattern(WS, [P1]);
    expect(groupBy.mock.calls[0][0].where.correct).toEqual({ not: null });
    expect(groupBy.mock.calls[1][0].where.correct).toBe(true);
  });
});

// ── C-14 · B ────────────────────────────────────────────────────────────────
// THE DIRECTION, measured before it was implemented. patternEngine.js:392:
//
//     other.status = PATTERN_STATUS.SUPERSEDED;
//     other.supersededByKey = canonical.key;
//
// The LOSER is marked SUPERSEDED and its pointer aims at the WINNER. So
// `X.supersededById = Y` reads "Y replaced X" — the edge runs FORWARD, from the
// belief that was replaced to the belief that replaced it.
//
// Resolving that column therefore answers "what replaced this", not "what this
// replaced". The two are opposite claims about Lumi's own learning, and
// publishing one under the other's name would be a falsehood no gate could
// catch — the payload would be perfectly well-formed and exactly backwards.
//
// Ruled FORWARD: R-5 called this case available precisely because it is a
// column read, and the belief that lost is the one with something to explain.
// The reverse (`supersedes[]`) is a scan, one winner can hold many losers, and
// it has no ruling behind it. Not published.
describe('C-14 · B — what replaced this belief', () => {
  const row = (over = {}) => ({ id: P1, supersededById: OLD, ...over });

  it('T11 · resolves the pointer to the REPLACEMENT’s statement', async () => {
    // A bare id is unreadable: "replaced by 7f3a-…" tells a person nothing. The
    // pointer is real and already written; C-14 completes the chain rather than
    // copying a statement or inventing a second history.
    findMany.mockResolvedValue([{ id: OLD, statement: 'CTR decays after day 9' }]);
    const map = await replacementOf(WS, [row()]);
    expect(map.get(P1)).toEqual({
      value: { id: OLD, statement: 'CTR decays after day 9' },
      knowledge: KNOWLEDGE.KNOWN,
    });
  });

  it('T12 · a belief nothing has replaced is NOTHING_THERE, not an error', async () => {
    // The commonest case by far: a live belief that has never lost to another.
    // "We looked, and there is nothing" — a finding about the belief, and it
    // must not read as a failed lookup.
    const map = await replacementOf(WS, [row({ supersededById: null })]);
    expect(map.get(P1)).toEqual({ value: null, knowledge: KNOWLEDGE.NOTHING_THERE });
  });

  it('T13 · no pointers means no read is issued', async () => {
    await replacementOf(WS, [row({ supersededById: null })]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('T14 · a failed resolution is COULD_NOT_LOOK', async () => {
    findMany.mockRejectedValue(new Error('resolve exploded'));
    const map = await replacementOf(WS, [row()]);
    expect(map.get(P1)).toEqual({ value: null, knowledge: KNOWLEDGE.COULD_NOT_LOOK });
  });

  it('T15 · a pointer we cannot resolve is COULD_NOT_LOOK, never "nothing replaced it"', async () => {
    // The column says a row exists (onDelete: SetNull guarantees the pointer is
    // cleared rather than dangling). If we still cannot produce it, our read did
    // not reach it — and publishing NOTHING_THERE would contradict the belief's
    // own record to a person's face.
    findMany.mockResolvedValue([]);
    const map = await replacementOf(WS, [row()]);
    expect(map.get(P1).knowledge).toBe(KNOWLEDGE.COULD_NOT_LOOK);
    expect(map.get(P1).value).toBeNull();
  });

  it('T16 · the resolution read is workspace-scoped', async () => {
    findMany.mockResolvedValue([{ id: OLD, statement: 's' }]);
    await replacementOf(WS, [row()]);
    expect(findMany.mock.calls[0][0].where.workspaceId).toBe(WS);
  });

  it('T17 · many beliefs replaced by ONE winner cost one read, not N', async () => {
    findMany.mockResolvedValue([{ id: OLD, statement: 's' }]);
    await replacementOf(WS, [row(), row({ id: P2 })]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('T18 · only ONE direction is published — the reverse has no ruling', async () => {
    findMany.mockResolvedValue([{ id: OLD, statement: 's' }]);
    const map = await replacementOf(WS, [row()]);
    expect(map.get(P1)).not.toHaveProperty('supersedes');
    expect(map.get(P1)).not.toHaveProperty('replaced');
  });
});
