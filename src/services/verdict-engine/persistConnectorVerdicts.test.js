// ============================================================
// persistConnectorVerdicts — the write twin of getConnectorVerdicts
// ------------------------------------------------------------
// Proves the wiring actually PERSISTS rows: the REAL verdict engine +
// buildConnectorVerdictTree run; only the connector read (getCanonicalVerdictCampaigns)
// and the DB are mocked. Asserts the row that lands, the revenue gate, the
// synthetic-root skip, PROPOSED status, and idempotency.
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
import { SIGNAL_TYPE } from '../diagnosis-engine/index.js';
import { persistConnectorVerdicts } from './VerdictService.js';

const WS       = '7517d1b9-b967-44f3-a77f-60f5c577f867';
const CAMPAIGN = 'c1d2e3f4-0000-0000-0000-000000000010';

// A connector row as EntityGraphService projects it. roas 4, ctr 5%, freq 1.5 → SCALE.
const camp = (over = {}) => ({
  entityId: CAMPAIGN, name: 'Eid Sale', channel: 'META',
  spendMinor: 10000, revenueMinor: 40000, impressions: 1000, clicks: 50,
  conversions: 8, frequency: 1.5, currency: 'USD', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findFirst.mockResolvedValue(null); // no prior verdict on file
  prisma.decision.create.mockResolvedValue({});
  prisma.decision.updateMany.mockResolvedValue({ count: 0 }); // nothing stale by default
});

describe('persistConnectorVerdicts', () => {
  it('persists a PROPOSED campaign Decision for a revenue-eligible campaign', async () => {
    mockCampaigns([camp()]);

    const res = await persistConnectorVerdicts(WS);

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
    await persistConnectorVerdicts(WS);
    for (const call of prisma.decision.create.mock.calls) {
      expect(call[0].data.entityId).not.toBe(WS);
      expect(call[0].data.entityLevel).not.toBe('ACCOUNT');
    }
  });

  it('persists an AWARENESS verdict for an engaged zero-revenue campaign — never a fabricated KILL', async () => {
    const AWARE = 'e2e2e2e2-0000-0000-0000-000000000011';
    // spend + impressions but no revenue → awareness track (HOLD for healthy engagement).
    mockCampaigns([camp({ entityId: AWARE, name: 'Awareness', revenueMinor: 0 })]);
    const res = await persistConnectorVerdicts(WS);
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
    const res = await persistConnectorVerdicts(WS);
    expect(res.gatedOut.map((g) => g.id)).toContain(NODATA);
    expect(prisma.decision.create).toHaveBeenCalledTimes(1); // only the revenue-eligible one
  });

  it('no-ops honestly when no campaign has revenue OR engagement', async () => {
    mockCampaigns([camp({ revenueMinor: 0, spendMinor: 0, impressions: 0 })]);
    const res = await persistConnectorVerdicts(WS);
    expect(res.status).toBe('NO_ELIGIBLE_CAMPAIGNS');
    expect(prisma.decision.create).not.toHaveBeenCalled();
  });

  it('is idempotent: writes no new row when the latest verdict is unchanged', async () => {
    mockCampaigns([camp()]);
    prisma.decision.findFirst.mockResolvedValue({ verdict: 'SCALE' });
    const res = await persistConnectorVerdicts(WS);
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(res.created).toHaveLength(0);
  });

  it('requires a workspaceId', async () => {
    await expect(persistConnectorVerdicts()).rejects.toThrow('workspaceId required');
  });
});

describe('persistConnectorVerdicts — stale-verdict prune (agenda de-inflation)', () => {
  it('supersedes PROPOSED verdicts for campaigns no longer in the eligible set', async () => {
    mockCampaigns([camp()]); // only CAMPAIGN is eligible now
    prisma.decision.updateMany.mockResolvedValue({ count: 2 }); // two orphans dropped out

    const res = await persistConnectorVerdicts(WS);

    expect(res.superseded).toBe(2);
    expect(prisma.decision.updateMany).toHaveBeenCalledTimes(1);
    const { where, data } = prisma.decision.updateMany.mock.calls[0][0];
    expect(data).toEqual({ status: 'SUPERSEDED' });
    expect(where).toMatchObject({
      workspaceId: WS, status: 'PROPOSED', entityLevel: 'CAMPAIGN',
      entityId: { notIn: [CAMPAIGN] }, // the currently-eligible campaign is KEPT
    });
  });

  it('scopes the prune to connector verdicts only (signalType rootCause OR null) — never guardrail/allocation rows', async () => {
    mockCampaigns([camp()]);
    await persistConnectorVerdicts(WS);
    const { where } = prisma.decision.updateMany.mock.calls[0][0];
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0].rootCause.in).toEqual(expect.arrayContaining(Object.values(SIGNAL_TYPE)));
    expect(where.OR[1]).toEqual({ rootCause: null });
    // A guardrail:/allocation: rootCause is neither in the signalType set nor null,
    // so it can never match this filter.
    expect(where.OR[0].rootCause.in).not.toContain('guardrail:BUDGET_CAP');
  });

  it('with NO eligible campaigns, supersedes every connector verdict (omits the entityId filter)', async () => {
    // dataless campaign → gatedOut → tree null → eligibleIds []
    mockCampaigns([camp({ revenueMinor: 0, spendMinor: 0, impressions: 0 })]);
    prisma.decision.updateMany.mockResolvedValue({ count: 3 });

    const res = await persistConnectorVerdicts(WS);

    expect(res.status).toBe('NO_ELIGIBLE_CAMPAIGNS');
    expect(res.superseded).toBe(3);
    const { where } = prisma.decision.updateMany.mock.calls[0][0];
    expect(where.entityId).toBeUndefined(); // no filter ⇒ ALL connector verdicts are stale
  });

  it('the prune runs even when NO campaigns exist at all (honest empty account)', async () => {
    mockCampaigns([]);
    const res = await persistConnectorVerdicts(WS);
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

    const res = await persistConnectorVerdicts(WS);

    const { where } = prisma.decision.findFirst.mock.calls[0][0];
    expect(where.status).toEqual({ not: 'SUPERSEDED' });
    expect(res.created).toHaveLength(1); // returns to the agenda with a fresh row
  });
});
