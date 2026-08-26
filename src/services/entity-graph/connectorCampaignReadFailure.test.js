// ============================================================
// B5-01D — a failed connector-campaign read is a system failure, not an
//          empty campaign population
// ============================================================
// The operational-population twin of B5 F-1 (the identity read), and the one
// with the widest product surface, because its output was believed by six
// consumers and spoken aloud by one:
//
//   prisma.campaign.findMany(...).catch(() => [])
//        ↓  getConnectorCampaigns returns []  ← byte-identical to a real empty
//        ↓  GET /entities/campaigns answers HTTP 200 { campaigns: [] }
//        ↓  the Campaigns surface renders "No campaigns synced yet"
//        ↓  the copilot prompt says "the answer is 0 campaigns"
//
// Discovery 01D proved that last step against a real database: a non-UUID
// workspaceId raises P2023 inside the findMany, and the value that came back was
// deep-equal to the one a genuinely empty workspace produces. The route's own
// 500 handler never ran, because nothing ever threw.
//
// WHAT THIS SUITE DELIBERATELY ALSO GUARDS
// -----------------------------------------
// Test 1 exists because the cheap way to close this is to make every empty
// population an error, and that is the opposite defect. A workspace that has
// genuinely connected nothing yet is not an outage, and "connect a channel" must
// survive as an honest state.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { campaign: { findMany: vi.fn() } },
}));
vi.mock('../evidence/index.js', () => ({ selectOperationalSnapshots: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { selectOperationalSnapshots } from '../evidence/index.js';
import {
  getConnectorCampaigns,
  CampaignsUnavailableError,
  CAMPAIGN_READ_FAILED,
} from './EntityGraphService.js';

const SOURCE = readFileSync(fileURLToPath(new URL('./EntityGraphService.js', import.meta.url)), 'utf8');
/** Comments stripped — the docblock QUOTES the removed `.catch(() => [])` to
 *  explain it, and a ratchet that cannot tell prose from a call fires on its own
 *  documentation. §17 asks for runtime integrity, not textual theater. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const WS_A = 'ws-a';
const WS_B = 'ws-b';

const campaignRow = (id, name) => ({
  id, name, channel: 'META', objective: 'OUTCOME_SALES',
  externalId: `ext-${id}`, platformCreatedTime: new Date('2026-01-01T00:00:00Z'),
  _count: { adSets: 2 },
});
const snapshotRow = (entityId) => ({
  entityId, date: new Date('2026-08-24T09:00:00Z'), source: 'META', currency: 'EGP',
  spendMinor: 500_000, revenueMinor: 1_000_000, impressions: 200_000, clicks: 4_000,
  conversions: 60, roas: 2, ctr: 0.02, frequency: 2.5, reach: 80_000,
  actionMetrics: null, dailyBudgetMinor: null, measurementWindow: 'ROLLING_WINDOW',
  windowStart: null, windowEnd: null,
});

/**
 * Arrange a failing campaign read — LAZILY.
 *
 * mockImplementation (not mockRejectedValue) so no rejected promise exists until
 * the reader actually calls it, and every caller below uses a BLOCK body: a
 * concise arrow would return the mock from beforeEach, which Vitest treats as a
 * teardown callback and invokes after each test.
 */
const failRead = (err = new Error('connection terminated')) =>
  prisma.campaign.findMany.mockImplementation(() => Promise.reject(err));

beforeEach(() => {
  vi.clearAllMocks();
  selectOperationalSnapshots.mockResolvedValue([]);
});

// ── TEST 2 · the populated read is untouched ───────────────────────────────────
describe('B5-01D · Test 2 — a successful populated read is unchanged', () => {
  it('returns one projected row per campaign, with its metrics', async () => {
    prisma.campaign.findMany.mockResolvedValue([campaignRow('c1', 'Ramadan Wave')]);
    selectOperationalSnapshots.mockResolvedValue([snapshotRow('c1')]);

    const rows = await getConnectorCampaigns(WS_A);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityId: 'c1', name: 'Ramadan Wave', channel: 'META',
      spendMinor: 500_000, roas: 2, ctr: 0.02, frequency: 2.5, adSetCount: 2,
    });
  });

  it('still queries by workspace, newest first, capped — the query is not the change', async () => {
    prisma.campaign.findMany.mockResolvedValue([]);
    await getConnectorCampaigns(WS_A);

    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { workspaceId: WS_A },
        orderBy: { createdAt: 'desc' },
        take:    200,
      }),
    );
  });

  it('a campaign with no snapshot keeps null metrics, never a fabricated 0', async () => {
    prisma.campaign.findMany.mockResolvedValue([campaignRow('c1', 'No Metrics')]);
    selectOperationalSnapshots.mockResolvedValue([]);

    const [row] = await getConnectorCampaigns(WS_A);
    expect(row.spendMinor).toBeNull();
    expect(row.roas).toBeNull();
    expect(row.frequency).toBeNull();
  });
});

// ── TEST 1 · the genuine empty population survives ────────────────────────────
describe('B5-01D · Test 1 — a successful EMPTY read is still an empty array', () => {
  it('a workspace that has connected nothing returns [] and does NOT throw', async () => {
    prisma.campaign.findMany.mockResolvedValue([]);
    await expect(getConnectorCampaigns(WS_A)).resolves.toEqual([]);
  });

  it('the empty case is not logged as a failure — nothing failed', async () => {
    prisma.campaign.findMany.mockResolvedValue([]);
    await getConnectorCampaigns(WS_A);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a missing workspaceId is still an empty read, not an outage', async () => {
    await expect(getConnectorCampaigns(null)).resolves.toEqual([]);
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
  });
});

// ── TEST 3 · the failure is a thrown, coded, caused error ─────────────────────
describe('B5-01D · Test 3 — a failed read throws CampaignsUnavailableError', () => {
  beforeEach(() => { failRead(); });

  it('rejects rather than resolving', async () => {
    await expect(getConnectorCampaigns(WS_A)).rejects.toBeInstanceOf(CampaignsUnavailableError);
  });

  it('carries the stable machine-matchable code', async () => {
    const err = await getConnectorCampaigns(WS_A).catch((e) => e);
    expect(err.code).toBe(CAMPAIGN_READ_FAILED);
    expect(CAMPAIGN_READ_FAILED).toBe('CAMPAIGN_READ_FAILED');
  });

  it('preserves the original error as `cause`', async () => {
    const underlying = new Error('connection terminated');
    failRead(underlying);
    const err = await getConnectorCampaigns(WS_A).catch((e) => e);
    expect(err.cause).toBe(underlying);
  });

  it('does not leak database internals into the client-facing message', async () => {
    failRead(new Error('relation "campaigns" does not exist at character 42'));
    const err = await getConnectorCampaigns(WS_A).catch((e) => e);
    expect(err.message).toBe('Connector campaigns could not be read');
    expect(err.message).not.toMatch(/relation|character|prisma|sql/i);
  });

  it('logs at ERROR with the workspace and the code — debug is invisible in production', async () => {
    await getConnectorCampaigns(WS_A).catch(() => {});
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS_A, code: CAMPAIGN_READ_FAILED }),
      expect.stringMatching(/connector campaign read failed/i),
    );
    expect(logger.debug).not.toHaveBeenCalled();
  });
});

// ── TEST 4 · the failure is NOT an empty array, in any disguise ───────────────
describe('B5-01D · Test 4 — the failure can never be read as an empty population', () => {
  it('the rejection value is an Error, and has no array-shaped payload', async () => {
    failRead();
    const err = await getConnectorCampaigns(WS_A).catch((e) => e);

    expect(Array.isArray(err)).toBe(false);
    expect(err.campaigns).toBeUndefined();
    expect(err.length).toBeUndefined();
    expect(err.rows).toBeUndefined();
  });

  it('THE DISTINCTION — the empty read and the failed read are different KINDS', async () => {
    prisma.campaign.findMany.mockResolvedValue([]);
    const empty = await getConnectorCampaigns(WS_A);

    failRead();
    const failed = await getConnectorCampaigns(WS_A).then(() => 'RESOLVED', (e) => e);

    // Before B5-01D these two were deep-equal. That is the whole defect.
    expect(empty).toEqual([]);
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toEqual(empty);
  });

  it('a caller that only checks `.length` cannot silently proceed', async () => {
    failRead();
    // The realistic downstream shape: `if (!campaigns.length) return []`. If the
    // failure resolved to anything array-like this would run and report absence.
    let reached = false;
    await getConnectorCampaigns(WS_A).then((rows) => { reached = !rows.length; }).catch(() => {});
    expect(reached).toBe(false);
  });
});

// ── TEST 7 · isolation — no cross-workspace, no last-known population ─────────
describe('B5-01D · Test 7 — a failure borrows nothing from anywhere else', () => {
  it('a failure in workspace A does not return workspace B rows', async () => {
    prisma.campaign.findMany.mockImplementation(({ where }) =>
      (where.workspaceId === WS_B
        ? Promise.resolve([campaignRow('b1', 'B campaign')])
        : Promise.reject(new Error('A is down'))));

    const b = await getConnectorCampaigns(WS_B);
    expect(b.map((r) => r.entityId)).toEqual(['b1']);

    const a = await getConnectorCampaigns(WS_A).then(() => 'RESOLVED', (e) => e);
    expect(a).toBeInstanceOf(CampaignsUnavailableError);
  });

  it('a failure does NOT serve the population a previous successful call returned', async () => {
    prisma.campaign.findMany.mockResolvedValue([campaignRow('c1', 'Ramadan Wave')]);
    const first = await getConnectorCampaigns(WS_A);
    expect(first).toHaveLength(1);

    failRead();
    const second = await getConnectorCampaigns(WS_A).then(() => 'RESOLVED', (e) => e);
    expect(second).toBeInstanceOf(CampaignsUnavailableError);
  });

  it('a workspace unaffected by the outage still reads normally afterwards', async () => {
    failRead();
    await getConnectorCampaigns(WS_A).catch(() => {});

    prisma.campaign.findMany.mockResolvedValue([campaignRow('b1', 'B campaign')]);
    await expect(getConnectorCampaigns(WS_B)).resolves.toHaveLength(1);
  });
});

// ── SOURCE RATCHETS · cheap regression bars, behavioural tests remain primary ──
describe('B5-01D · source ratchets (comments stripped)', () => {
  it('the connector-campaign read has no catch that returns an empty array', () => {
    // Matches `.catch(...)` bodies containing a bare `return []`. The identity
    // read above it already throws; neither may reintroduce the collapse.
    expect(CODE).not.toMatch(/catch\s*\([^)]*\)\s*=>\s*\{[^}]*return\s*\[\s*\]/);
  });

  it('the error class and its code are exported for consumers to match on', () => {
    expect(CODE).toMatch(/export\s+class\s+CampaignsUnavailableError\s+extends\s+Error/);
    expect(CODE).toMatch(/export\s+const\s+CAMPAIGN_READ_FAILED\s*=/);
  });

  it('the failure is thrown, and the throw is what the catch does', () => {
    expect(CODE).toMatch(/throw\s+new\s+CampaignsUnavailableError/);
  });
});
