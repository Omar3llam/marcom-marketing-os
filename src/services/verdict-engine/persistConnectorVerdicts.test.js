// ============================================================
// persistConnectorVerdicts — the PERSISTENCE SINK for an evaluated verdict set
// ------------------------------------------------------------
// Proves the wiring actually PERSISTS rows: the REAL verdict engine +
// buildConnectorVerdictTree run; only the connector read (getCanonicalVerdictCampaigns)
// and the DB are mocked. Asserts the row that lands, the revenue gate, the
// synthetic-root skip, PROPOSED status, and idempotency.
//
// R8: every case now goes through the real seam — evaluateConnectorVerdicts once,
// then persist THAT result. The tests read the same way they did (`persist()`
// after mocking campaigns) but the path underneath is the production one, so a
// regression that made persistence recompute would show up here as a second
// getCanonicalVerdictCampaigns call, not as a passing test.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../entity-graph/index.js', () => ({ getCanonicalVerdictCampaigns: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { decision: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import { getCanonicalVerdictCampaigns } from '../entity-graph/index.js';
// Phase D.4: the verdict path reads CANONICAL evidence and is handed an
// envelope — the campaigns that have a canonical row, plus the identities that
// have none. These tests are about the campaigns, so noCanonicalWindow is empty;
// the absence path has its own tests in canonicalVerdictEvidence.test.js.
const mockCampaigns = (rows) => getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: rows, noCanonicalWindow: [] });
import { DECISION_CLASS } from '@marcom/runtime-contracts';
import { persistConnectorVerdicts } from './VerdictService.js';
import { evaluateConnectorVerdicts, failedEvaluation } from './connectorVerdictService.js';
import { canonicalContentHash } from './evidenceReference.js';
import { CANONICAL_VERDICT_EVIDENCE_BASIS } from './canonicalVerdictEvidence.js';

const WS       = '7517d1b9-b967-44f3-a77f-60f5c577f867';
const CAMPAIGN = 'c1d2e3f4-0000-0000-0000-000000000010';

/** The production call shape: ONE evaluation, then persist exactly that (R8/I26). */
const persist = async (ws = WS) => persistConnectorVerdicts(ws, await evaluateConnectorVerdicts(ws));

// A connector row as EntityGraphService projects it. roas 4, ctr 5%, freq 1.5 → SCALE.
const camp = (over = {}) => {
  const row = {
  entityId: CAMPAIGN, name: 'Eid Sale', channel: 'META',
  spendMinor: 10000, revenueMinor: 40000, impressions: 1000, clicks: 50,
  conversions: 8, frequency: 1.5, currency: 'USD', ...over,
  };
  const projection = { formatVersion: 1, snapshot: { ...row, workspaceId: WS, source: 'META', measurementWindow: 'CUMULATIVE_30D', date: '2026-10-25T07:00:00.000Z' }, attributes: { objective: row.objective ?? null, optimizationGoal: null } };
  const facts = { binding: 'EXACT', providerAccountId: 'act_fixture', metricFields: { spend: 'VALID', impressions: 'VALID', clicks: 'VALID' },
    rawDates: { start: { presence: 'VALID', value: '2026-09-26' }, stop: { presence: 'VALID', value: '2026-10-25' } } };
  row.evidenceBasis = { ...CANONICAL_VERDICT_EVIDENCE_BASIS, rowCount: 1 };
  row.evidenceRows = [{ workspaceId: WS, entityId: row.entityId, source: 'META', measurementWindow: 'CUMULATIVE_30D',
    observationId: '00000000-0000-0000-0000-000000000001', refreshId: '00000000-0000-0000-0000-000000000002',
    sourceAttemptId: '00000000-0000-0000-0000-000000000003', writeId: '00000000-0000-0000-0000-000000000004',
    observedAt: '2026-10-25T07:00:00.000Z', committedProjection: projection, sourceFacts: facts, sourceScope: { providerAccountId: 'act_fixture' },
    contentHash: canonicalContentHash({ projection, facts }).toString('hex') }];
  return row;
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findFirst.mockResolvedValue(null); // no prior verdict on file
  prisma.decision.create.mockResolvedValue({});
  prisma.decision.updateMany.mockResolvedValue({ count: 0 }); // nothing stale by default
});

describe('persistConnectorVerdicts', () => {
  it('T3 refuses evidence-dependent persistence when the input has no qualified lineage', async () => {
    const row = camp(); row.evidenceBasis = null; row.evidenceRows = [];
    mockCampaigns([row]);
    await persist();
    expect(prisma.decision.create).not.toHaveBeenCalled();
  });
  it('persists a PROPOSED campaign Decision for a revenue-eligible campaign', async () => {
    mockCampaigns([camp()]);

    const res = await persist();

    expect(res.status).toBe('OK');
    expect(res.created).toHaveLength(1);
    expect(prisma.decision.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.decision.create.mock.calls[0][0];
    expect(data).toMatchObject({
      workspaceId: WS,
      entityId:    CAMPAIGN,   // the REAL entity-graph UUID
      entityLevel: 'CAMPAIGN',
      verdict:     'SCALE',    // roas 4 + ctr 5% → SCALE (real engine)
      status:      'PROPOSED', // never auto-executed
    });
  });

  it('never writes the synthetic ACCOUNT root (keyed by workspaceId)', async () => {
    mockCampaigns([camp()]);
    await persist();
    for (const call of prisma.decision.create.mock.calls) {
      expect(call[0].data.entityId).not.toBe(WS);
      expect(call[0].data.entityLevel).not.toBe('ACCOUNT');
    }
  });

  it('persists an AWARENESS verdict for an engaged zero-revenue campaign — never a fabricated KILL', async () => {
    const AWARE = 'e2e2e2e2-0000-0000-0000-000000000011';
    // spend + impressions but no revenue → awareness track (HOLD for healthy engagement).
    mockCampaigns([camp({ entityId: AWARE, name: 'Awareness', revenueMinor: 0 })]);
    const res = await persist();
    expect(res.gatedOut).toHaveLength(0);
    expect(prisma.decision.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.decision.create.mock.calls[0][0];
    expect(data.entityId).toBe(AWARE);
    expect(['HOLD', 'WATCH', 'REFRESH']).toContain(data.verdict); // an awareness verdict
    expect(data.verdict).not.toBe('KILL');
    expect(data.verdict).not.toBe('SCALE');
  });

  it('gates out a DATALESS campaign (zero spend + zero impressions)', async () => {
    const NODATA = 'e3e3e3e3-0000-0000-0000-000000000012';
    mockCampaigns([camp(), camp({ entityId: NODATA, name: 'No data', revenueMinor: 0, spendMinor: 0, impressions: 0 })]);
    const res = await persist();
    expect(res.gatedOut.map((g) => g.id)).toContain(NODATA);
    expect(prisma.decision.create).toHaveBeenCalledTimes(1); // only the revenue-eligible one
  });

  it('no-ops honestly when no campaign has revenue OR engagement', async () => {
    mockCampaigns([camp({ revenueMinor: 0, spendMinor: 0, impressions: 0 })]);
    const res = await persist();
    expect(res.status).toBe('NO_ELIGIBLE_CAMPAIGNS');
    expect(prisma.decision.create).not.toHaveBeenCalled();
  });

  it('is idempotent: writes no new row when the latest verdict is unchanged', async () => {
    mockCampaigns([camp()]);
    prisma.decision.findFirst.mockResolvedValue({ verdict: 'SCALE' });
    const res = await persist();
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(res.created).toHaveLength(0);
  });

  it('requires a workspaceId', async () => {
    await expect(persistConnectorVerdicts()).rejects.toThrow('workspaceId required');
  });
});

// ============================================================
// R8 — persistence is a SINK (I26)
// ------------------------------------------------------------
// It stores the verdict it was handed. It does not read evidence, it does not
// run the engine, and it cannot be called without a result to store.
// ============================================================
describe('R8 · persistConnectorVerdicts stores the verdict it was given', () => {
  // CONTROL 3 (persistence result differs from the computed verdict).
  it('THE CONTRACT: the stored verdict is the evaluated one, not a re-derivation', async () => {
    mockCampaigns([camp()]);
    const evaluation = await evaluateConnectorVerdicts(WS);
    const evaluated = evaluation.annotated.children[0];

    await persistConnectorVerdicts(WS, evaluation);

    const { data } = prisma.decision.create.mock.calls[0][0];
    // Same verdict, same rationale, same confidence, same cause — because it is
    // the same object, not a second computation that happens to agree.
    expect(data.verdict).toBe(evaluated.verdict);
    expect(data.diagnosis).toBe(evaluated.rationale);
    expect(data.confidence).toBe(evaluated.verdictConfidence);
    expect(data.rootCause).toBe(evaluated.rootCause ?? evaluated.signalType ?? null);
  });

  // CONTROL 2/12 (a downstream consumer recomputes). The evidence read is the
  // observable proof: one logical evaluation must touch it exactly once.
  it('reads the canonical evidence ZERO times of its own', async () => {
    mockCampaigns([camp()]);
    const evaluation = await evaluateConnectorVerdicts(WS);
    expect(getCanonicalVerdictCampaigns).toHaveBeenCalledTimes(1);

    await persistConnectorVerdicts(WS, evaluation);

    // Still one. If persistence ever goes back to reading for itself, this is 2.
    expect(getCanonicalVerdictCampaigns).toHaveBeenCalledTimes(1);
  });

  // CONTROL 9/10 (failure → invented or fallback verdict).
  it('REFUSES a failed evaluation rather than persisting an empty set', async () => {
    const failed = failedEvaluation(WS, new Error('canonical read timed out'));
    await expect(persistConnectorVerdicts(WS, failed))
      .rejects.toThrow('evaluation unavailable');
    // Nothing written, and — critically — nothing SUPERSEDED either. Treating a
    // failed evaluation as "no campaign is eligible" would supersede every live
    // verdict in the workspace and empty the agenda on an outage.
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to persist without an evaluation at all', async () => {
    await expect(persistConnectorVerdicts(WS)).rejects.toThrow('evaluation required');
    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
  });

  // CONTROL 7 (workspace scoping loss). Threading makes this newly possible:
  // a result computed for one account is now a value that can be passed around.
  it('refuses an evaluation computed for a DIFFERENT workspace', async () => {
    const OTHER = '00000000-1111-2222-3333-444444444444';
    mockCampaigns([camp()]);
    const evaluation = await evaluateConnectorVerdicts(OTHER);

    await expect(persistConnectorVerdicts(WS, evaluation))
      .rejects.toThrow('different workspace');
    expect(prisma.decision.create).not.toHaveBeenCalled();
  });
});

describe('persistConnectorVerdicts — stale-verdict prune (agenda de-inflation)', () => {
  it('supersedes PROPOSED verdicts for campaigns no longer in the eligible set', async () => {
    mockCampaigns([camp()]); // only CAMPAIGN is eligible now
    prisma.decision.updateMany.mockResolvedValue({ count: 2 }); // two orphans dropped out

    const res = await persist();

    expect(res.superseded).toBe(2);
    expect(prisma.decision.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = prisma.decision.updateMany.mock.calls[0][0];
    expect(data).toEqual({ status: 'SUPERSEDED' });
    expect(where).toMatchObject({
      workspaceId: WS, status: 'PROPOSED', entityLevel: 'CAMPAIGN',
      entityId: { notIn: [CAMPAIGN] }, // the currently-eligible campaign is KEPT
    });
  });

  it('scopes the prune to SIGNAL decisions — never guardrail/allocation rows', async () => {
    mockCampaigns([camp()]);
    await persist();
    const { where } = prisma.decision.updateMany.mock.calls[0][0];
    // C-10 — the prune scopes on the CLASS. It used to reproduce a union of
    // three enum families in the where clause, which is a class filter written
    // as a string match: any cause the engine gained and this list missed made
    // its verdicts un-supersedable, and they piled up as permanently-open rows.
    expect(where.decisionClass).toEqual({ in: [DECISION_CLASS.SIGNAL] });
    for (const foreign of [DECISION_CLASS.GUARDRAIL, DECISION_CLASS.ALLOCATION, DECISION_CLASS.EXPERIMENT]) {
      expect(where.decisionClass.in).not.toContain(foreign);
    }
  });

  it('with NO eligible campaigns, supersedes every connector verdict (omits the entityId filter)', async () => {
    // dataless campaign → gatedOut → tree null → eligibleIds []
    mockCampaigns([camp({ revenueMinor: 0, spendMinor: 0, impressions: 0 })]);
    prisma.decision.updateMany.mockResolvedValue({ count: 3 });

    const res = await persist();

    expect(res.status).toBe('NO_ELIGIBLE_CAMPAIGNS');
    expect(res.superseded).toBe(3);
    const { where } = prisma.decision.updateMany.mock.calls[0][0];
    expect(where.entityId).toBeUndefined(); // no filter ⇒ ALL connector verdicts are stale
  });

  it('the prune runs even when NO campaigns exist at all (honest empty account)', async () => {
    mockCampaigns([]);
    const res = await persist();
    expect(res.status).toBe('NO_CAMPAIGNS');
    expect(prisma.decision.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.decision.updateMany.mock.calls[0][0].where.entityId).toBeUndefined();
  });

  it('re-proposes a returning campaign: change-detection ignores SUPERSEDED rows', async () => {
    mockCampaigns([camp()]);
    // The only prior row for this entity was SUPERSEDED when it dropped out; the
    // status:{not:'SUPERSEDED'} filter means findFirst returns null → a fresh
    // PROPOSED is created even though the verdict text is unchanged.
    prisma.decision.findFirst.mockResolvedValue(null);

    const res = await persist();

    const { where } = prisma.decision.findFirst.mock.calls[0][0];
    expect(where.status).toEqual({ not: 'SUPERSEDED' });
    expect(res.created).toHaveLength(1); // returns to the agenda with a fresh row
  });
});
