import { canonicalContentHash } from './evidenceReference.js';
// ============================================================
// B5-01F · §11 Test 7 + §12 — stale evidence never reaches the engine, and the
//                             verdict it used to support becomes history
// ============================================================
// Two claims that a final-output assertion cannot make on its own:
//
//   Test 7  — the deterministic verdict engine is never INVOKED for a stale
//             campaign. Asserting only that no verdict came back would also pass
//             if the engine ran and its result were discarded afterwards, which
//             is a different (and much worse) architecture.
//
//   §12     — when evidence ages past the threshold the campaign leaves the
//             eligible set, and the existing supersede machinery closes out its
//             PROPOSED verdict. The decision stays in history with its original
//             provenance: freshness says the evidence can no longer support a
//             NEW verdict, never that the old one was wrong.
//
// The lifecycle half is deliberately tested through persistConnectorVerdicts —
// the real sink — rather than by calling supersedeDroppedConnectorVerdicts,
// which is private and would prove only that a function I did not change works.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    campaign:       { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    decision:       { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('../evidence/index.js', () => ({ selectOperationalSnapshots: vi.fn(async () => []) }));
// The REAL engine, only observed — a replacement could not answer whether it runs.
//
// `rollupVerdicts` is the guard, and deliberately so. An earlier draft spied on
// `evaluateVerdict` too; the control below caught that rollupVerdicts calls it
// through a module-INTERNAL reference, so the export spy never sees it and
// "evaluateVerdict was not called" would have passed for a stale campaign, a
// fresh one, and a scenario where the engine ran twice. rollupVerdicts is the
// entry point the service actually calls, it IS intercepted, and it receives the
// whole tree — so it can answer both "did the engine run" and "over which
// entities", which is the question Test 7 is really asking.
vi.mock('./verdictEngine.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, rollupVerdicts: vi.fn(mod.rollupVerdicts) };
});

import { prisma } from '../../lib/prisma.js';
import { rollupVerdicts } from './verdictEngine.js';

/** Every entity id the engine was actually asked to judge, off the real call. */
const entitiesJudged = () =>
  rollupVerdicts.mock.calls.flatMap(([tree]) => (tree?.children ?? []).map((c) => c.id));
import { evaluateConnectorVerdicts } from './connectorVerdictService.js';
import { persistConnectorVerdicts } from './VerdictService.js';
import { CANONICAL_EVIDENCE_STALE } from './canonicalVerdictEvidence.js';

const WS = 'ws-f2';
const DAY = 86_400_000;
const NOW = new Date('2026-08-26T09:00:00.000Z');

const identity = (id, name = 'Always On') => ({
  id, name, channel: 'META', objective: 'OUTCOME_SALES',
  externalId: `ext-${id}`, platformCreatedTime: new Date('2025-06-01T00:00:00Z'),
  _count: { adSets: 1 },
});

const snap = ({ entityId, ageDays }) => {
  const windowEnd = new Date(new Date(NOW.getTime() - ageDays * DAY).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  return {
    entityId, source: 'META', currency: 'USD', measurementWindow: 'CUMULATIVE_30D',
    windowStart: new Date(windowEnd.getTime() - 29 * DAY), windowEnd, date: windowEnd,
    // Real spend AND real revenue, so nothing else could gate this campaign out:
    // if it does not reach the engine, freshness is the only possible reason.
    spendMinor: 5_000_000, revenueMinor: 1_000_000, impressions: 400_000, clicks: 6_000,
    conversions: 40, roas: 0.2, ctr: 0.015, frequency: 4.4, reach: 90_000,
    actionMetrics: null, dailyBudgetMinor: null,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  prisma.decision.findFirst.mockResolvedValue(null);
  prisma.decision.updateMany.mockResolvedValue({ count: 0 });
  prisma.decision.create.mockResolvedValue({ id: 'd1' });
  prisma.decision.update.mockResolvedValue({});
});

// ── §11 Test 7 — the engine is never invoked for stale evidence ──────────────
describe('B5-01F · §11 Test 7 — stale evidence never reaches the verdict engine', () => {
  it('a fresh campaign DOES reach it (the control — otherwise the guard proves nothing)', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('A')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap({ entityId: 'A', ageDays: 0 })]));

    const ev = await evaluateConnectorVerdicts(WS);

    expect(ev.status).toBe('OK');
    expect(rollupVerdicts).toHaveBeenCalled();
    expect(entitiesJudged()).toContain('A');
  });

  it('a stale campaign is never evaluated — the engine is not called at all', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('B')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap({ entityId: 'B', ageDays: 213 })]));

    const ev = await evaluateConnectorVerdicts(WS);

    expect(rollupVerdicts).not.toHaveBeenCalled();
    expect(entitiesJudged()).toEqual([]);
    expect(ev.annotated).toBeNull();
    expect(ev.tree).toBeNull();
  });

  it('in a MIXED population the engine sees the fresh entity and never the stale one', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('A', 'Fresh'), identity('B', 'Stale')]);
    prisma.$queryRaw.mockResolvedValue(captured([
      snap({ entityId: 'A', ageDays: 1 }),
      snap({ entityId: 'B', ageDays: 213 }),
    ]));

    const ev = await evaluateConnectorVerdicts(WS);

    // Every entity the engine was asked to judge, gathered from the real call.
    expect(entitiesJudged()).toEqual(['A']);
    expect(entitiesJudged()).not.toContain('B');
    expect(ev.annotated.children.map((c) => c.id)).toEqual(['A']);
  });

  it('the stale campaign is reported as gated out, with its own reason', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('B')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap({ entityId: 'B', ageDays: 42 })]));

    const ev = await evaluateConnectorVerdicts(WS);

    expect(ev.status).toBe('NO_ELIGIBLE_CAMPAIGNS');
    expect(ev.gatedOut).toHaveLength(1);
    expect(ev.gatedOut[0]).toMatchObject({ id: 'B', reason: CANONICAL_EVIDENCE_STALE, measurementAgeDays: 42 });
  });

  it('NO_ELIGIBLE_CAMPAIGNS, not NO_CAMPAIGNS — the workspace is not empty', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('B')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap({ entityId: 'B', ageDays: 400 })]));

    const ev = await evaluateConnectorVerdicts(WS);
    expect(ev.status).not.toBe('NO_CAMPAIGNS');
  });
});

// ── §12 — the decision lifecycle ─────────────────────────────────────────────
describe('B5-01F · §12 — an aged-out campaign’s verdict becomes history', () => {
  const staleEvaluation = async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('B')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap({ entityId: 'B', ageDays: 213 })]));
    return evaluateConnectorVerdicts(WS);
  };

  it('Test 11 · the existing PROPOSED verdict is SUPERSEDED', async () => {
    prisma.decision.updateMany.mockResolvedValue({ count: 1 });

    const result = await persistConnectorVerdicts(WS, await staleEvaluation());

    expect(prisma.decision.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUPERSEDED' } }),
    );
    expect(result.superseded).toBe(1);
  });

  it('Test 11b · the supersede targets PROPOSED connector verdicts outside the eligible set', async () => {
    await persistConnectorVerdicts(WS, await staleEvaluation());

    const { where } = prisma.decision.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ workspaceId: WS, status: 'PROPOSED', entityLevel: 'CAMPAIGN' });
    // The eligible set is EMPTY (the only campaign aged out), so no entityId
    // filter is applied and every connector verdict is closed out.
    expect(where.entityId).toBeUndefined();
  });

  it('Test 12 · nothing rewrites the historical decision', async () => {
    await persistConnectorVerdicts(WS, await staleEvaluation());

    // The ONLY write is the status transition. No new verdict, and no touch of
    // verdict / createdAt / evidenceReference / diagnosis on the historical row.
    expect(prisma.decision.create).not.toHaveBeenCalled();
    const { data } = prisma.decision.updateMany.mock.calls[0][0];
    expect(Object.keys(data)).toEqual(['status']);
  });

  it('Test 13 · no outcome is fabricated for the dropout', async () => {
    await persistConnectorVerdicts(WS, await staleEvaluation());

    // resolvePrevious writes resolvedAt/resolution/confidenceDelta and is
    // deliberately NOT called for a dropout: a campaign going quiet is not
    // evidence that the verdict succeeded or failed.
    expect(prisma.decision.update).not.toHaveBeenCalled();
    const { data } = prisma.decision.updateMany.mock.calls[0][0];
    expect(data.resolvedAt).toBeUndefined();
    expect(data.resolution).toBeUndefined();
    expect(data.confidenceDelta).toBeUndefined();
  });

  it('a FRESH campaign is not superseded — the gate is what moved it, not the sweep', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('A')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap({ entityId: 'A', ageDays: 0 })]));

    await persistConnectorVerdicts(WS, await evaluateConnectorVerdicts(WS));

    const { where } = prisma.decision.updateMany.mock.calls[0][0];
    // A non-empty eligible set scopes the supersede AWAY from the live campaign.
    expect(where.entityId).toEqual({ notIn: ['A'] });
  });
});


// Synthetic immutable capture results at the actual observation-query seam.
// These are unit fixtures, not authority for legacy database snapshots.
const captured = (rows, workspaceId = WS) => rows.map((row, index) => {
  const committedProjection = { formatVersion: 1,
    snapshot: JSON.parse(JSON.stringify({ ...row, workspaceId, entityLevel: 'CAMPAIGN' })),
    attributes: { objective: 'OUTCOME_SALES' } };
  const day = (v) => v == null ? null : new Date(v).toISOString().slice(0, 10);
  const sourceFacts = { binding: 'EXACT', providerAccountId: 'act_unit',
    rawDates: { start: { presence: row.windowStart ? 'VALID' : 'MISSING', value: day(row.windowStart) },
      stop: { presence: row.windowEnd ? 'VALID' : 'MISSING', value: day(row.windowEnd) } },
    metricFields: { spend: 'VALID', impressions: 'VALID', clicks: 'VALID', revenue: 'VALID', conversions: 'VALID', frequency: 'VALID' } };
  const id = (n) => '10000000-0000-4000-8000-' + String(index * 4 + n).padStart(12, '0');
  return { workspaceId, entityId: row.entityId, observationId: id(1), refreshId: id(2),
    sourceAttemptId: id(3), writeId: id(4), committedProjection, sourceFacts,
    contentHash: canonicalContentHash({ projection: committedProjection, facts: sourceFacts }).toString('hex'),
    sourceScope: { providerAccountId: 'act_unit' }, sourceReceipt: { outcome: 'EXHAUSTED' } };
});
