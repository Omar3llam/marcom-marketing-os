// ============================================================
// persistConnectorVerdicts — the write twin of getConnectorVerdicts
// ------------------------------------------------------------
// Proves the wiring actually PERSISTS rows: the REAL verdict engine +
// buildConnectorVerdictTree run; only the connector read (getConnectorCampaigns)
// and the DB are mocked. Asserts the row that lands, the revenue gate, the
// synthetic-root skip, PROPOSED status, and idempotency.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../entity-graph/index.js', () => ({ getConnectorCampaigns: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { decision: { findFirst: vi.fn(), create: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import { getConnectorCampaigns } from '../entity-graph/index.js';
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
});

describe('persistConnectorVerdicts', () => {
  it('persists a PROPOSED campaign Decision for a revenue-eligible campaign', async () => {
    getConnectorCampaigns.mockResolvedValue([camp()]);

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
    getConnectorCampaigns.mockResolvedValue([camp()]);
    await persistConnectorVerdicts(WS);
    for (const call of prisma.decision.create.mock.calls) {
      expect(call[0].data.entityId).not.toBe(WS);
      expect(call[0].data.entityLevel).not.toBe('ACCOUNT');
    }
  });

  it('persists an AWARENESS verdict for an engaged zero-revenue campaign — never a fabricated KILL', async () => {
    const AWARE = 'e2e2e2e2-0000-0000-0000-000000000011';
    // spend + impressions but no revenue → awareness track (HOLD for healthy engagement).
    getConnectorCampaigns.mockResolvedValue([camp({ entityId: AWARE, name: 'Awareness', revenueMinor: 0 })]);
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
    getConnectorCampaigns.mockResolvedValue([camp(), camp({ entityId: NODATA, name: 'No data', revenueMinor: 0, spendMinor: 0, impressions: 0 })]);
    const res = await persistConnectorVerdicts(WS);
    expect(res.gatedOut.map((g) => g.id)).toContain(NODATA);
    expect(prisma.decision.create).toHaveBeenCalledTimes(1); // only the revenue-eligible one
  });

  it('no-ops honestly when no campaign has revenue OR engagement', async () => {
    getConnectorCampaigns.mockResolvedValue([camp({ revenueMinor: 0, spendMinor: 0, impressions: 0 })]);
    const res = await persistConnectorVerdicts(WS);
    expect(res.status).toBe('NO_ELIGIBLE_CAMPAIGNS');
    expect(prisma.decision.create).not.toHaveBeenCalled();
  });

  it('is idempotent: writes no new row when the latest verdict is unchanged', async () => {
    getConnectorCampaigns.mockResolvedValue([camp()]);
    prisma.decision.findFirst.mockResolvedValue({ verdict: 'SCALE' });
    const res = await persistConnectorVerdicts(WS);
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(res.created).toHaveLength(0);
  });

  it('requires a workspaceId', async () => {
    await expect(persistConnectorVerdicts()).rejects.toThrow('workspaceId required');
  });
});
