// ============================================================
// B5-01D — the three connector-campaign read outcomes, on real PostgreSQL
// ============================================================
// The unit suite beside this one proves the branch logic with a mocked Prisma
// client. That is the right tool for the branching and the wrong tool for the
// question here: does the REAL driver, against a REAL database, actually produce
// each of the three outcomes the contract names?
//
// The failure case is the reason this file earns its place, and §14 forbids
// standing it up on `mockRejectedValue`. It is not an injected rejection and not
// a second client standing in for the first: a non-UUID workspaceId against a
// `@db.Uuid` column makes PostgreSQL's driver raise P2023 inside the very call
// the production reader makes, through the shared singleton, on the real code
// path. Nothing is faked — the only thing arranged is an input the database
// itself refuses.
//
// Discovery 01D ran exactly this against master and recorded
// `deepEqualToS2: true` — the failed read and the genuinely empty read returned
// the same value. The last test here is that finding, inverted into a guard.
//
// Skips when no migrated database is reachable (src/tests/dbProbe.js). That is a
// real gap in the default local baseline (B5 F-8), not a claim of coverage.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import {
  getConnectorCampaigns,
  CampaignsUnavailableError,
  CAMPAIGN_READ_FAILED,
} from './EntityGraphService.js';

const DB_OK = await dbAvailable();

describe.skipIf(!DB_OK)('B5-01D · connector campaign read outcomes on real PostgreSQL', () => {
  const populated = randomUUID();  // a workspace WITH a synced campaign
  const empty = randomUUID();      // a real workspace with none
  const accountId = randomUUID();
  const campaignId = randomUUID();

  beforeAll(async () => {
    for (const [id, name] of [[populated, 'b5-01d-populated'], [empty, 'b5-01d-empty']]) {
      await prisma.workspace.create({ data: { id, name: `${name}-${id.slice(0, 8)}` } });
    }
    await prisma.account.create({
      data: { id: accountId, workspaceId: populated, channel: 'META', name: 'B5D acct', externalId: `act-${accountId.slice(0, 8)}` },
    });
    await prisma.campaign.create({
      data: {
        id: campaignId, workspaceId: populated, accountId, channel: 'META',
        name: 'Alpha', externalId: `c-${campaignId.slice(0, 8)}`, objective: 'OUTCOME_SALES',
      },
    });
    await prisma.metricSnapshot.create({
      data: {
        workspaceId: populated, entityId: campaignId, entityLevel: 'CAMPAIGN',
        source: 'META', date: new Date(), granularity: 'DAILY',
        measurementWindow: 'ROLLING_WINDOW',
        spendMinor: 500_000, revenueMinor: 1_000_000, roas: 2, ctr: 0.02, frequency: 2.5,
        impressions: 100_000, clicks: 2_000, conversions: 40, currency: 'EGP',
      },
    });
  });

  afterAll(async () => {
    for (const ws of [populated, empty]) {
      await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
      await prisma.campaign.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
      await prisma.account.deleteMany({ where: { workspaceId: ws } }).catch(() => {});
      await prisma.workspace.deleteMany({ where: { id: ws } }).catch(() => {});
    }
  });

  // ── A · real populated read ──────────────────────────────────────────────────
  it('READ SUCCESS + CAMPAIGNS — rows come back from the database with real metrics', async () => {
    const rows = await getConnectorCampaigns(populated);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityId: campaignId, name: 'Alpha', channel: 'META',
      spendMinor: 500_000, roas: 2, frequency: 2.5, currency: 'EGP',
    });
  });

  // ── B · real empty read ──────────────────────────────────────────────────────
  it('READ SUCCESS + ZERO CAMPAIGNS — a real empty workspace still resolves to []', async () => {
    await expect(getConnectorCampaigns(empty)).resolves.toEqual([]);
  });

  // ── C · genuine driver failure ───────────────────────────────────────────────
  it('READ FAILURE — a genuine P2023 from the real driver becomes the typed error', async () => {
    const err = await getConnectorCampaigns('not-a-uuid').catch((e) => e);

    expect(err).toBeInstanceOf(CampaignsUnavailableError);
    expect(err.code).toBe(CAMPAIGN_READ_FAILED);
    // Raised by Prisma itself, not constructed by the test.
    expect(err.cause?.code).toBe('P2023');
    // The distinction B5-01D is about: this is not an empty population.
    expect(Array.isArray(err)).toBe(false);
    expect(err.campaigns).toBeUndefined();
  });

  it('THE DISCOVERY 01D FINDING, INVERTED — the failed read is no longer deep-equal to the empty read', async () => {
    const emptyResult = await getConnectorCampaigns(empty);
    const failedResult = await getConnectorCampaigns('not-a-uuid').then(() => 'RESOLVED', (e) => e);

    // On master this assertion was false in the worst possible way: the two
    // values were identical, which is why HTTP 200 could report a false absence.
    expect(JSON.stringify(failedResult)).not.toBe(JSON.stringify(emptyResult));
    expect(failedResult).toBeInstanceOf(Error);
    expect(emptyResult).toEqual([]);
  });

  it('a failure for one workspace leaves another workspace readable and unchanged', async () => {
    await getConnectorCampaigns('not-a-uuid').catch(() => {});

    const rows = await getConnectorCampaigns(populated);
    expect(rows.map((r) => r.entityId)).toEqual([campaignId]);
  });
});
