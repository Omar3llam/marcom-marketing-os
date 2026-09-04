// ============================================================
// getAccuracy's projection — humanExecutedAt has to survive the select
// ============================================================
// The engine opens its outcome window at `humanExecutedAt` and falls back to
// `createdAt`. That fallback is silent by design (legacy rows have no
// humanExecutedAt), which makes the Prisma `select` load-bearing in a way nothing
// else here is: omit the field and every row arrives undefined, the fallback
// fires for all of them, and the window quietly reverts to issuance with no
// error, no log line, and a plausible-looking number on the surface.
//
// This is the same class as the default-projection widening that 500'd getHome
// in PR #209 — a read whose correctness lives entirely in its field list.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { decision: { findMany: vi.fn() }, workspace: { findUnique: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import { getAccuracy, buildAccuracyInputs } from './DecisionAccuracyService.js';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findMany.mockResolvedValue([]);
});

describe('the select', () => {
  it('asks for BOTH provenance columns — without them the window silently reverts to issuance', async () => {
    // B4-A — the window opens at the earliest of the two. Selecting only one
    // would leave the other undefined, which interventionAt() reads as "never",
    // so a Lumi-executed decision would quietly measure from issuance.
    await getAccuracy('ws-1');
    expect(prisma.decision.findMany.mock.calls[0][0].select)
      .toMatchObject({ humanExecutedAt: true, platformExecutedAt: true });
  });

  it('still asks for createdAt — it is the legacy fallback AND the velocity axis', async () => {
    await getAccuracy('ws-1');
    expect(prisma.decision.findMany.mock.calls[0][0].select).toMatchObject({ createdAt: true });
  });

  // deriveAccuracyStatus reads BOTH timestamps. Omitting dismissedAt would make
  // every dismissal report its raw status (PROPOSED), fall through the engine's
  // "not a realized prediction" branch, and vanish from the survivorship count
  // it exists to feed — a coverage note that silently under-reports.
  it('asks for dismissedAt — the derivation needs it to see a dismissal at all', async () => {
    await getAccuracy('ws-1');
    expect(prisma.decision.findMany.mock.calls[0][0].select).toMatchObject({ dismissedAt: true });
  });
});

// The population. This is the fix that makes the surface non-empty.
describe('the where clause', () => {
  it('selects on the human SIGNALS, not on DecisionStatus', async () => {
    await getAccuracy('ws-1');
    const { where } = prisma.decision.findMany.mock.calls[0][0];
    // B4-A — three arms. EITHER execution provenance counts as "acted on",
    // because the Proof Engine asks whether the RECOMMENDATION was right, not
    // who carried it out. Dropping the platform arm would exclude every
    // decision Lumi executed itself; dropping the human arm would empty the
    // population outright, since production holds zero execution requests.
    expect(where).toEqual({
      workspaceId: 'ws-1',
      // C-10 — "was Lumi's call right" is a question about the connector
      // engine's own judgement. A guardrail episode states what a RULE says,
      // and scoring one would calibrate the engine on somebody else's policy.
      decisionClass: { in: ['SIGNAL'] },
      OR: [
        { humanExecutedAt: { not: null } },
        { platformExecutedAt: { not: null } },
        { dismissedAt: { not: null } },
      ],
    });
    // The old gate. Nothing ever wrote either status, so this matched an empty
    // set and the whole surface reported on zero rows without erroring.
    expect(where.status).toBeUndefined();
  });

  it('stays workspace-scoped — this surface is per-account by construction', async () => {
    await getAccuracy('ws-9');
    expect(prisma.decision.findMany.mock.calls[0][0].where.workspaceId).toBe('ws-9');
  });
});

// The whole chain, unmocked past prisma: a real row with a real timestamp has to
// come out the other end as a counted decision. Every piece above can be right
// while the surface still reports on nothing, which is exactly the state this PR
// found it in.
describe('end to end — the surface finally sees a row', () => {
  const NOW = new Date('2026-08-06T00:00:00.000Z');
  const days = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

  it('counts a decision executed while live and superseded afterwards', async () => {
    prisma.decision.findMany.mockResolvedValue([{
      id: 'd1', verdict: 'KILL', confidence: 0.8,
      // Superseded by the next sweep — the common case, and the one a
      // status-scoped query would have thrown away.
      status: 'SUPERSEDED',
      createdAt: days(30), humanExecutedAt: days(20), dismissedAt: null,
      outcomes: [{
        spendDeltaMinor: -5000, revenueDeltaMinor: -2000, roasDelta: -0.1,
        windowEnd: days(1), sustained: true,
      }],
    }]);

    const r = await getAccuracy('ws-1', { now: NOW });
    expect(r.coverage.totalDecisions).toBe(1);
    expect(r.coverage.scored).toBe(1);
  });

  it('counts a dismissal in coverage without scoring it', async () => {
    prisma.decision.findMany.mockResolvedValue([{
      id: 'd2', verdict: 'KILL', confidence: 0.8, status: 'PROPOSED',
      createdAt: days(30), humanExecutedAt: null, dismissedAt: days(20), outcomes: [],
    }]);

    const r = await getAccuracy('ws-1', { now: NOW });
    expect(r.coverage.dismissed).toBe(1);
    expect(r.coverage.scored).toBe(0);
    // The survivorship note only appears when a dismissal was actually seen —
    // which it never could be before, because nothing wrote DISMISSED.
    expect(r.coverage.note).toMatch(/1 dismissed calls are not represented/);
  });
});

describe('buildAccuracyInputs', () => {
  const row = (over = {}) => ({
    id: 'd1', verdict: 'KILL', confidence: 0.8, status: 'PROPOSED',
    createdAt: '2026-07-01T00:00:00.000Z', outcomes: [], ...over,
  });

  // The seam. The pure engine still reads d.status, so the timestamps are
  // translated here rather than rewriting the layer with the densest tests.
  it('derives EXECUTED from humanExecutedAt, whatever the row status says', () => {
    expect(buildAccuracyInputs([row({ humanExecutedAt: '2026-07-20T00:00:00.000Z' })])[0].accuracyStatus).toBe('EXECUTED');
    expect(buildAccuracyInputs([row({ status: 'SUPERSEDED', humanExecutedAt: '2026-07-20T00:00:00.000Z' })])[0].accuracyStatus).toBe('EXECUTED');
  });

  it('derives DISMISSED from dismissedAt', () => {
    expect(buildAccuracyInputs([row({ dismissedAt: '2026-07-20T00:00:00.000Z' })])[0].accuracyStatus).toBe('DISMISSED');
  });

  it('passes the raw status through when neither signal landed', () => {
    expect(buildAccuracyInputs([row()])[0].accuracyStatus).toBe('PROPOSED');
  });

  // The engine input is a CONTRACT, not "whatever the row had". A spread would
  // leak the raw outcomes array and both timestamps into it.
  it('emits the engine input shape and nothing else', () => {
    const out = buildAccuracyInputs([row({ humanExecutedAt: '2026-07-20T00:00:00.000Z', dismissedAt: null })])[0];
    expect(Object.keys(out).sort()).toEqual(
      ['accuracyStatus', 'confidence', 'createdAt', 'humanExecutedAt', 'id', 'outcome', 'platformExecutedAt', 'verdict'],
    );
    expect(out.outcomes).toBeUndefined();
    expect(out.dismissedAt).toBeUndefined();
  });

  it('carries humanExecutedAt through to the engine', () => {
    const at = '2026-07-20T00:00:00.000Z';
    expect(buildAccuracyInputs([row({ humanExecutedAt: at })])[0].humanExecutedAt).toBe(at);
  });

  it('emits null (not undefined) when a row has no humanExecutedAt', () => {
    // Both fall back the same way in the engine, but null says "asked and there
    // was none" while undefined cannot be told apart from "never selected".
    expect(buildAccuracyInputs([row()])[0].humanExecutedAt).toBeNull();
  });

  it('leaves createdAt untouched — the velocity curve still bins by issuance', () => {
    const out = buildAccuracyInputs([row({ humanExecutedAt: '2026-07-20T00:00:00.000Z' })])[0];
    expect(out.createdAt).toBe('2026-07-01T00:00:00.000Z');
  });
});
