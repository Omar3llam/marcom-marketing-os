// ============================================================
// B5 F-1 — the three identity-read outcomes, on real PostgreSQL
// ============================================================
// The unit suite beside this one proves the DISTINCTION with a mocked Prisma
// client. That is the right tool for the branch logic and the wrong tool for
// the question here: does the REAL driver, against a REAL database, actually
// produce each of the three outcomes the contract names?
//
// The failure case is the reason this file earns its place. It is not an
// injected rejection and not a second client standing in for the first: a
// non-UUID workspaceId against a `@db.Uuid` column makes PostgreSQL's driver
// raise P2023 inside the very call the production reader makes, through the
// shared singleton, on the real code path. Nothing is faked — the only thing
// arranged is an input the database itself refuses.
//
// Skips when no migrated database is reachable (src/tests/dbProbe.js). That is
// a real gap in the default local baseline (B5 F-8), not a claim of coverage.
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import {
  getCanonicalVerdictCampaigns,
  CampaignIdentityUnavailableError,
  CAMPAIGN_IDENTITY_READ_FAILED,
} from './EntityGraphService.js';
import { evaluateConnectorVerdicts } from '../verdict-engine/connectorVerdictService.js';

const DB_OK = await dbAvailable();

describe.skipIf(!DB_OK)('B5 F-1 · campaign identity read outcomes on real PostgreSQL', () => {
  const populated = randomUUID();  // a workspace WITH campaigns
  const empty = randomUUID();      // a real workspace with none
  const accountId = randomUUID();
  const campaignId = randomUUID();

  beforeAll(async () => {
    for (const [id, name] of [[populated, 'b5-01c-populated'], [empty, 'b5-01c-empty']]) {
      await prisma.workspace.create({ data: { id, name: `${name}-${id.slice(0, 8)}` } });
    }
    await prisma.account.create({
      data: { id: accountId, workspaceId: populated, channel: 'META', name: 'B5 acct', externalId: `act-${accountId.slice(0, 8)}` },
    });
    await prisma.campaign.create({
      data: {
        id: campaignId, workspaceId: populated, accountId, channel: 'META',
        name: 'Alpha', externalId: `c-${campaignId.slice(0, 8)}`,
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

  it('READ SUCCESS + CAMPAIGNS — identities come back from the database', async () => {
    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(populated);
    // One campaign, and no canonical snapshot for it — so it is correctly
    // reported as absent rather than scored. That is the F-2 state, unchanged.
    expect(noCanonicalWindow).toHaveLength(1);
    expect(noCanonicalWindow[0].id).toBe(campaignId);
    expect(campaigns).toEqual([]);
  });

  it('READ SUCCESS + ZERO CAMPAIGNS — a real empty workspace still yields NO_CAMPAIGNS', async () => {
    await expect(getCanonicalVerdictCampaigns(empty))
      .resolves.toEqual({ campaigns: [], noCanonicalWindow: [], staleEvidence: [] });

    const ev = await evaluateConnectorVerdicts(empty);
    expect(ev.status).toBe('NO_CAMPAIGNS');
  });

  it('READ FAILURE — a genuine P2023 from the real driver becomes the typed error', async () => {
    const err = await getCanonicalVerdictCampaigns('not-a-uuid').catch((e) => e);

    expect(err).toBeInstanceOf(CampaignIdentityUnavailableError);
    expect(err.code).toBe(CAMPAIGN_IDENTITY_READ_FAILED);
    // Raised by Prisma itself, not constructed by the test.
    expect(err.cause?.code).toBe('P2023');
    // The distinction F-1 is about: this is not an empty population.
    expect(err.campaigns).toBeUndefined();
    expect(err.status).toBeUndefined();
  });

  it('READ FAILURE — the evaluation rejects rather than reporting NO_CAMPAIGNS', async () => {
    const out = await evaluateConnectorVerdicts('not-a-uuid').then((v) => v, (e) => e);
    expect(out).toBeInstanceOf(Error);
    expect(out.code).toBe(CAMPAIGN_IDENTITY_READ_FAILED);
    expect(out.status).toBeUndefined();
  });

  it('a failure for one workspace leaves another workspace unaffected', async () => {
    await getCanonicalVerdictCampaigns('not-a-uuid').catch(() => {});
    const { noCanonicalWindow } = await getCanonicalVerdictCampaigns(populated);
    expect(noCanonicalWindow.map((c) => c.id)).toEqual([campaignId]);
  });
});
