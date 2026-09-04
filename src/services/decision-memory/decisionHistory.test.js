// ============================================================
// decisionHistory — "have we seen this before?"
// ------------------------------------------------------------
// Two failures this pins, both of which produce a confidently wrong screen:
//   1. reusing getLatestDecisions' `status: 'PROPOSED'` filter, which empties
//      the timeline on every sweep — the rows it would hide are exactly the
//      history it exists to show
//   2. reusing entityLevel alone for scope, which lets a guardrail hit or an
//      allocation move appear as "we said KILL before"
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { groupBy, findMany } = vi.hoisted(() => ({ groupBy: vi.fn(), findMany: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { groupBy, findMany } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getDecisionHistory, HISTORY_LIMIT, HISTORY_STATUS,
  getRecentDecisions, RECENT_DECISIONS_LIMIT, RECENT_DECISION_SELECT,
} from './decisionHistory.js';
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { scopeFor } from '../decisions/decisionClassScope.js';

const dec = (over = {}) => ({
  id: 'd1', entityId: 'c1', verdict: 'KILL', status: 'SUPERSEDED',
  createdAt: new Date('2026-08-01'), dismissedAt: null,
  // The two provenance columns `stated()` actually reads. This fixture carried
  // `executedAt` until T11 — a key nothing has read since the B4-A split, which
  // made the alias look covered while every assertion over it was really
  // reading the fallback.
  humanExecutedAt: null, platformExecutedAt: null,
  resolution: null, confidenceDelta: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 1 } }]);
  findMany.mockResolvedValue([dec()]);
});

const where = () => findMany.mock.calls[0][0].where;

/**
 * C-03 — the map half, for the tests that are about WHAT came back.
 *
 * getDecisionHistory answers with two things now: the history, and whether the
 * read happened at all. Everything below this line was written about the first
 * and stays about it; the tests that are about the second call the function
 * directly, so that the distinction is never asserted by accident.
 */
const history = async (...args) => (await getDecisionHistory(...args)).byEntityId;

describe('scope', () => {
  it('is workspace scoped, and only for the entities asked about', async () => {
    await history('ws-1', ['c1', 'c2']);
    expect(where().workspaceId).toBe('ws-1');
    expect(where().entityId).toEqual({ in: ['c1', 'c2'] });
  });

  it('is campaign level only', async () => {
    await history('ws-1', ['c1']);
    expect(where().entityLevel).toBe('CAMPAIGN');
  });

  // NAMED: memory excludes non-connector campaign decisions.
  // Guardrail, allocation, incrementality and test all write CAMPAIGN-level
  // rows. They are proposals about the campaign, not verdicts Lumi reached
  // about it, and listing them as "we said KILL before" invents a history.
  it('memory excludes non-connector campaign decisions', async () => {
    await history('ws-1', ['c1']);
    // The SAME canonical definition, not a second allowlist.
    // C-10 — the timeline scopes on the CLASS. Same boundary, no longer
    // dependent on a union of three enum families reproduced in a where clause.
    expect(where().decisionClass).toEqual(scopeFor('memory/decision-history').decisionClass);
    const named = where().decisionClass.in;
    for (const foreign of [DECISION_CLASS.GUARDRAIL, DECISION_CLASS.ALLOCATION, DECISION_CLASS.EXPERIMENT]) {
      expect(named).not.toContain(foreign);
    }
  });

  // NAMED: memory timeline does not reuse latest-PROPOSED identity query.
  // getLatestDecisions filters `status: 'PROPOSED'` because it answers "which
  // row do I act on now". Reusing it here would hide every decision the moment
  // a later sweep superseded it — a timeline that empties itself.
  it('memory timeline does not reuse latest PROPOSED identity query', async () => {
    await history('ws-1', ['c1']);
    expect(where()).not.toHaveProperty('status');
  });

  it('keeps decisions that have been superseded, executed or dismissed', async () => {
    findMany.mockResolvedValue([
      dec({ id: 'a', status: 'SUPERSEDED' }),
      dec({ id: 'b', status: 'PROPOSED', humanExecutedAt: new Date('2026-08-02') }),

      dec({ id: 'c', status: 'PROPOSED', dismissedAt: new Date('2026-08-03') }),
    ]);
    groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 3 } }]);
    const map = await history('ws-1', ['c1']);
    expect(map.get('c1').items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

// ============================================================
// T11 — the compatibility alias on the memory timeline
// ============================================================
// `stated().executedAt` is a DEPRECATED alias for clients shipped before B4-A
// split the column in two. It reaches the wire through getDecisionHistory →
// memoryByEntityId → GET /api/lumi/entities/verdicts.
//
// Behaviour is unchanged by T11; these tests exist because it was UNPROVEN.
// The fixture that looked like it covered this set a plain `executedAt` key
// that nothing has read since the split, so every assertion over the alias was
// really reading the null fallback.
describe('T11 · legacy executedAt alias — platformExecutedAt ?? humanExecutedAt', () => {
  const alias = async (over) => {
    findMany.mockResolvedValue([dec(over)]);
    const map = await history('ws-1', ['c1']);
    return map.get('c1').items[0];
  };

  const H = new Date('2026-08-02T09:00:00.000Z');
  const P = new Date('2026-08-03T17:30:00.000Z');

  it('T1 · human-only → the human instant', async () => {
    const row = await alias({ humanExecutedAt: H, platformExecutedAt: null });
    expect(row.executedAt).toEqual(H);
    // …and the two facts stay separately stated beside it, which is what a
    // post-split reader should use instead.
    expect(row.humanExecutedAt).toEqual(H);
    expect(row.platformExecutedAt).toBeNull();
  });

  it('T2 · both present → PLATFORM wins', async () => {
    // The discriminating case. `H` is deliberately EARLIER, so a derivation
    // that took the first non-null in the other order, or the earliest of the
    // two, would return H and pass every other test in this file.
    const row = await alias({ humanExecutedAt: H, platformExecutedAt: P });
    expect(row.executedAt).toEqual(P);
    expect(row.executedAt).not.toEqual(H);
  });

  it('T2b · platform-only → the platform instant', async () => {
    const row = await alias({ humanExecutedAt: null, platformExecutedAt: P });
    expect(row.executedAt).toEqual(P);
  });

  it('T3 · neither → null, and never a substituted timestamp', async () => {
    const row = await alias({ humanExecutedAt: null, platformExecutedAt: null });
    expect(row.executedAt).toBeNull();
    // Not createdAt, which is present on the row and is the fallback a helpful
    // implementation would reach for. "Nobody executed this" is the answer.
    expect(row.executedAt).not.toEqual(row.createdAt);
  });
});

describe('what it returns', () => {

  it('groups by entity, newest first, in the order the database gave', async () => {
    findMany.mockResolvedValue([
      dec({ id: 'new', createdAt: new Date('2026-08-05') }),
      dec({ id: 'old', createdAt: new Date('2026-07-01') }),
      dec({ id: 'other', entityId: 'c2' }),
    ]);
    groupBy.mockResolvedValue([
      { entityId: 'c1', _count: { _all: 2 } }, { entityId: 'c2', _count: { _all: 1 } },
    ]);
    const map = await history('ws-1', ['c1', 'c2']);
    expect(map.get('c1').items.map((i) => i.id)).toEqual(['new', 'old']);
    expect(map.get('c2').items).toHaveLength(1);
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  // The count is a REAL total from a groupBy, and can exceed the listed rows.
  // Deriving it from the truncated list would under-report exactly the
  // campaigns with the longest history.
  it('counts every decision, even the ones it does not list', async () => {
    groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 9 } }]);
    findMany.mockResolvedValue([dec({ id: 'a' }), dec({ id: 'b' })]);
    const map = await history('ws-1', ['c1']);
    expect(map.get('c1').count).toBe(9);
    expect(map.get('c1').items).toHaveLength(2);
  });

  it(`lists at most ${HISTORY_LIMIT} per campaign, sliced in the service`, async () => {
    findMany.mockResolvedValue(Array.from({ length: 12 }, (_, i) => dec({ id: `d${i}` })));
    groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 12 } }]);
    const map = await history('ws-1', ['c1']);
    expect(map.get('c1').items).toHaveLength(HISTORY_LIMIT);
    expect(map.get('c1').count).toBe(12);
  });

  it('carries the outcome the engine recorded, and null when it recorded none', async () => {
    findMany.mockResolvedValue([
      dec({ id: 'a', resolution: 'IMPROVED', confidenceDelta: 0.4 }),
      dec({ id: 'b', resolution: null }),
    ]);
    const [a, b] = (await history('ws-1', ['c1'])).get('c1').items;
    expect(a.resolution).toBe('IMPROVED');
    expect(b.resolution).toBeNull();
  });

  // Absent, not zero: a campaign we have never judged has no history, and a
  // `{count: 0}` entry is indistinguishable from one we looked up and found empty.
  it('omits entities with no history rather than giving them a zero', async () => {
    groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 1 } }]);
    findMany.mockResolvedValue([dec({ entityId: 'c1' })]);
    const map = await history('ws-1', ['c1', 'c2']);
    expect(map.has('c2')).toBe(false);
  });
});

// ============================================================
// C-03 — a failed read is not an empty history
// ============================================================
// The defect: `catch → new Map()` delivered "we could not look" and "we looked
// and this campaign has never been judged" as the same value. Both render as
// silence, and silence about a campaign is a claim about the campaign.
//
// The vocabulary is not invented here. MEMORY_STATUS in
// pattern-engine/institutionalMemory.js already draws this exact line for the
// OTHER memory in the SAME payload, and its header says why: `[]` is a
// statement about the account, made when the truth is a statement about us.
// This is that rule reaching the sibling that missed it.
//
// Two values, not three. MEMORY_STATUS needs NO_VALIDATED_MEMORY because its
// "none" is a workspace-level answer; here "none" is per entity and is already
// said by a key's ABSENCE from the map — a fact this module documents and the
// tests above pin. A third status would be a claim nothing can make correctly.
describe('C-03 · it never takes the feed down, and never lies about why', () => {
  it.each([[null], [''], [undefined]])('asks nothing for workspace %s', async (ws) => {
    const out = await getDecisionHistory(ws, ['c1']);
    expect(out.byEntityId.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    // OK, not HISTORY_UNAVAILABLE. Nothing failed — nothing was asked. A guard
    // that reported unavailability would put an outage badge on every screen
    // that legitimately has no entities to ask about.
    expect(out.status).toBe(HISTORY_STATUS.OK);
  });

  it.each([[[]], [null], ['nope']])('asks nothing for entityIds %s', async (ids) => {
    const out = await getDecisionHistory('ws-1', ids);
    expect(out.byEntityId.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(out.status).toBe(HISTORY_STATUS.OK);
  });

  it('a successful read with no rows is OK — we looked, there is nothing', async () => {
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([]);
    const out = await getDecisionHistory('ws-1', ['c1']);
    expect(out.status).toBe(HISTORY_STATUS.OK);
    expect(out.byEntityId.size).toBe(0);
  });

  // History is context, not the call. A failed read costs the Memory section;
  // throwing would cost the whole verdict screen. It must still say it failed.
  it('a failed ROW read is HISTORY_UNAVAILABLE, and does not throw', async () => {
    findMany.mockRejectedValue(new Error('column does not exist'));
    const out = await getDecisionHistory('ws-1', ['c1']);
    expect(out.status).toBe(HISTORY_STATUS.HISTORY_UNAVAILABLE);
    expect(out.byEntityId.size).toBe(0);
  });

  // Both halves of the Promise.all, because either can fail on its own. A catch
  // placed around one of them would report the other's failure as a clean read.
  it('a failed COUNT read is HISTORY_UNAVAILABLE too', async () => {
    groupBy.mockRejectedValue(new Error('deadlock detected'));
    const out = await getDecisionHistory('ws-1', ['c1']);
    expect(out.status).toBe(HISTORY_STATUS.HISTORY_UNAVAILABLE);
  });

  // THE ASSERTION THE SLICE EXISTS FOR. Both cases produce an empty map, so the
  // map is not the answer — a consumer reading only the map is reading a coin
  // flip and rendering the result as a fact about the campaign.
  it('the two empty maps are told apart by status alone', async () => {
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([]);
    const looked = await getDecisionHistory('ws-1', ['c1']);

    findMany.mockRejectedValue(new Error('read failed'));
    const failed = await getDecisionHistory('ws-1', ['c1']);

    expect(looked.byEntityId.size).toBe(failed.byEntityId.size); // identical evidence
    expect(looked.status).not.toBe(failed.status);               // different truth
  });

  it('asks the database twice for the whole feed, not twice per campaign', async () => {
    await history('ws-1', ['c1', 'c2', 'c3']);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// R7 — getRecentDecisions: the workspace-scoped canonical read
// ------------------------------------------------------------
// One read, two consumers (the sidebar and the orchestrator's prompt), replacing
// the retired DecisionMemory table for both. What must hold:
//   • workspace scope, and NOTHING else the caller can widen
//   • connector scope, so a guardrail proposal is not shown as a verdict
//   • deterministic order, or the sidebar reshuffles between polls
//   • no memory-table dependency
// ============================================================
describe('R7 · getRecentDecisions', () => {
  const recent = () => findMany.mock.calls[0][0];

  beforeEach(() => {
    findMany.mockResolvedValue([dec()]);
  });

  it('is workspace-scoped', async () => {
    await getRecentDecisions('ws-1');
    expect(recent().where.workspaceId).toBe('ws-1');
  });

  it('carries NO entity predicate — the identity trap', async () => {
    // The orchestrator keys on CampaignState.campaignId, a plain legacy String,
    // while Decision.entityId is a @db.Uuid. An entity predicate here would
    // return nothing, quietly, and the prompt would lose its history without a
    // single error anywhere.
    await getRecentDecisions('ws-1');
    expect(recent().where).not.toHaveProperty('entityId');
    expect(recent().where).not.toHaveProperty('entityLevel');
  });

  it('scopes to connector-authored decisions, like the timeline beside it', async () => {
    // Without this a guardrail hit or an allocation move appears in "Recent"
    // as something Lumi decided about the campaign.
    await getRecentDecisions('ws-1');
    expect(recent().where.decisionClass).toEqual(scopeFor('memory/recent-decisions').decisionClass);
  });

  it('orders deterministically — newest first, with a stable tiebreak', async () => {
    // createdAt ties when one sweep writes several rows in a transaction. An
    // unstable tiebreak makes the same request return a different three rows to
    // the sidebar on each poll.
    await getRecentDecisions('ws-1');
    expect(recent().orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('bounds the read explicitly, and honours a caller\'s smaller limit', async () => {
    await getRecentDecisions('ws-1');
    expect(recent().take).toBe(RECENT_DECISIONS_LIMIT);

    findMany.mockClear();
    await getRecentDecisions('ws-1', 3);
    expect(findMany.mock.calls[0][0].take).toBe(3);
  });

  it('selects only the fields its two consumers need', async () => {
    await getRecentDecisions('ws-1');
    expect(recent().select).toEqual(RECENT_DECISION_SELECT);
    // The sidebar renders identity + verdict + when; the prompt needs the
    // reasoning. Nothing else is selected, and no memory column appears.
    expect(Object.keys(RECENT_DECISION_SELECT).sort()).toEqual([
      'confidence', 'createdAt', 'diagnosis', 'entityId', 'entityLevel',
      'id', 'resolution', 'rootCause', 'status', 'verdict',
    ]);
    for (const dead of ['actionType', 'decisionRationale', 'deltaRoas', 'isSustainable', 'signalType', 'outcome']) {
      expect(RECENT_DECISION_SELECT).not.toHaveProperty(dead);
    }
  });

  it('no workspace → [] without touching the database', async () => {
    expect(await getRecentDecisions(null)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('T11 · publishes no executedAt alias at all — its select carries no provenance', () => {
    // The one surface people expect to carry the alias and which does not.
    // /decisions/recent renders identity + verdict + when; it never asked for
    // either execution column, so there is nothing to derive an alias from and
    // inventing one would put a timestamp on the sidebar that no query read.
    expect(RECENT_DECISION_SELECT).not.toHaveProperty('humanExecutedAt');
    expect(RECENT_DECISION_SELECT).not.toHaveProperty('platformExecutedAt');
    expect(RECENT_DECISION_SELECT).not.toHaveProperty('executedAt');
  });

  it('THROWS rather than swallowing — the two callers need different failures', async () => {
    // The prompt distinguishes "no decisions" from "could not read"; a service
    // that caught this for them would collapse the two and put an empty list
    // under a heading the model reasons from.
    findMany.mockRejectedValue(new Error('db down'));
    await expect(getRecentDecisions('ws-1')).rejects.toThrow('db down');
  });
});
