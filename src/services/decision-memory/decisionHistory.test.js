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
  getDecisionHistory, HISTORY_LIMIT,
  getRecentDecisions, RECENT_DECISIONS_LIMIT, RECENT_DECISION_SELECT,
} from './decisionHistory.js';
import { connectorDecisionScope } from '../verdict-engine/decisionIdentity.js';

const dec = (over = {}) => ({
  id: 'd1', entityId: 'c1', verdict: 'KILL', status: 'SUPERSEDED',
  createdAt: new Date('2026-08-01'), executedAt: null, dismissedAt: null,
  resolution: null, confidenceDelta: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 1 } }]);
  findMany.mockResolvedValue([dec()]);
});

const where = () => findMany.mock.calls[0][0].where;

describe('scope', () => {
  it('is workspace scoped, and only for the entities asked about', async () => {
    await getDecisionHistory('ws-1', ['c1', 'c2']);
    expect(where().workspaceId).toBe('ws-1');
    expect(where().entityId).toEqual({ in: ['c1', 'c2'] });
  });

  it('is campaign level only', async () => {
    await getDecisionHistory('ws-1', ['c1']);
    expect(where().entityLevel).toBe('CAMPAIGN');
  });

  // NAMED: memory excludes non-connector campaign decisions.
  // Guardrail, allocation, incrementality and test all write CAMPAIGN-level
  // rows. They are proposals about the campaign, not verdicts Lumi reached
  // about it, and listing them as "we said KILL before" invents a history.
  it('memory excludes non-connector campaign decisions', async () => {
    await getDecisionHistory('ws-1', ['c1']);
    // The SAME canonical definition, not a second allowlist.
    expect(where().OR).toEqual(connectorDecisionScope().OR);
    const named = where().OR.find((c) => c.rootCause?.in)?.rootCause.in ?? [];
    for (const foreign of ['guardrail:', 'allocation:', 'incrementality:', 'test:']) {
      expect(named.some((c) => String(c).startsWith(foreign))).toBe(false);
    }
  });

  // NAMED: memory timeline does not reuse latest-PROPOSED identity query.
  // getLatestDecisions filters `status: 'PROPOSED'` because it answers "which
  // row do I act on now". Reusing it here would hide every decision the moment
  // a later sweep superseded it — a timeline that empties itself.
  it('memory timeline does not reuse latest PROPOSED identity query', async () => {
    await getDecisionHistory('ws-1', ['c1']);
    expect(where()).not.toHaveProperty('status');
  });

  it('keeps decisions that have been superseded, executed or dismissed', async () => {
    findMany.mockResolvedValue([
      dec({ id: 'a', status: 'SUPERSEDED' }),
      dec({ id: 'b', status: 'PROPOSED', executedAt: new Date('2026-08-02') }),
      dec({ id: 'c', status: 'PROPOSED', dismissedAt: new Date('2026-08-03') }),
    ]);
    groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 3 } }]);
    const map = await getDecisionHistory('ws-1', ['c1']);
    expect(map.get('c1').items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
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
    const map = await getDecisionHistory('ws-1', ['c1', 'c2']);
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
    const map = await getDecisionHistory('ws-1', ['c1']);
    expect(map.get('c1').count).toBe(9);
    expect(map.get('c1').items).toHaveLength(2);
  });

  it(`lists at most ${HISTORY_LIMIT} per campaign, sliced in the service`, async () => {
    findMany.mockResolvedValue(Array.from({ length: 12 }, (_, i) => dec({ id: `d${i}` })));
    groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 12 } }]);
    const map = await getDecisionHistory('ws-1', ['c1']);
    expect(map.get('c1').items).toHaveLength(HISTORY_LIMIT);
    expect(map.get('c1').count).toBe(12);
  });

  it('carries the outcome the engine recorded, and null when it recorded none', async () => {
    findMany.mockResolvedValue([
      dec({ id: 'a', resolution: 'IMPROVED', confidenceDelta: 0.4 }),
      dec({ id: 'b', resolution: null }),
    ]);
    const [a, b] = (await getDecisionHistory('ws-1', ['c1'])).get('c1').items;
    expect(a.resolution).toBe('IMPROVED');
    expect(b.resolution).toBeNull();
  });

  // Absent, not zero: a campaign we have never judged has no history, and a
  // `{count: 0}` entry is indistinguishable from one we looked up and found empty.
  it('omits entities with no history rather than giving them a zero', async () => {
    groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 1 } }]);
    findMany.mockResolvedValue([dec({ entityId: 'c1' })]);
    const map = await getDecisionHistory('ws-1', ['c1', 'c2']);
    expect(map.has('c2')).toBe(false);
  });
});

describe('it never takes the feed down with it', () => {
  it.each([[null], [''], [undefined]])('asks nothing for workspace %s', async (ws) => {
    expect((await getDecisionHistory(ws, ['c1'])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([[[]], [null], ['nope']])('asks nothing for entityIds %s', async (ids) => {
    expect((await getDecisionHistory('ws-1', ids)).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  // History is context, not the call. A failed read costs the Memory section;
  // throwing would cost the whole verdict screen.
  it('returns an empty map when the read fails', async () => {
    findMany.mockRejectedValue(new Error('column does not exist'));
    expect((await getDecisionHistory('ws-1', ['c1'])).size).toBe(0);
  });

  it('asks the database twice for the whole feed, not twice per campaign', async () => {
    await getDecisionHistory('ws-1', ['c1', 'c2', 'c3']);
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
    expect(recent().where.OR).toEqual(connectorDecisionScope().OR);
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

  it('THROWS rather than swallowing — the two callers need different failures', async () => {
    // The prompt distinguishes "no decisions" from "could not read"; a service
    // that caught this for them would collapse the two and put an empty list
    // under a heading the model reasons from.
    findMany.mockRejectedValue(new Error('db down'));
    await expect(getRecentDecisions('ws-1')).rejects.toThrow('db down');
  });
});
