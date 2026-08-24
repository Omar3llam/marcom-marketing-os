// ============================================================
// snapshotSink.landSnapshots — objective ingest + re-sync preservation
// ------------------------------------------------------------
// The objective pipeline (Meta → metaNormalize → toEntityOps) is covered by
// metaAdsService.merge.test.js up to the entity OP. This closes the last hop:
// the landSnapshots UPSERT itself. Two load-bearing contracts, untested until
// now:
//   1. A campaign upserts on its DETERMINISTIC id (detId) — so a re-sync
//      updates the same row (the id is Campaign.id = det(externalId)); a broken
//      where clause would mint duplicates and strand the objective.
//   2. A later sync that LACKS objective (null) must NOT clobber a previously
//      resolved objective — the update omits the key (snapshotSink.js guard).
//      Regressing this silently reverts real conversion campaigns to "awareness".
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => {
  const model = () => ({ upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) });
  return {
    prisma: {
      account: model(), campaign: model(), adSet: model(), ad: model(), creative: model(),
      metricSnapshot: model(),
      // The two sink transactions just await the array of upsert promises.
      $transaction: vi.fn((arr) => Promise.all(arr)),
      // B4-E4: snapshots are written through a raw predicated upsert now. These
      // suites are about the ENTITY ops above and do not inspect it, but the
      // mock has to answer the call the code makes.
      $executeRaw: vi.fn().mockResolvedValue(1),
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { landSnapshots } from './snapshotSink.js';
import { detId } from './connectorTypes.js';

const WS = 'ws-1';
const DATE = new Date('2026-07-01T00:00:00Z');

// A normalized ACCOUNT parent + one CAMPAIGN leaf (positive spend, so the
// zero-shadow guard makes no DB read and the snapshot lands normally).
const batch = (campaignOver = {}) => [
  {
    entityLevel: 'ACCOUNT', externalId: 'act_9', name: 'Acme', source: 'META',
    date: DATE, spendMinor: 5000, revenueMinor: 0, impressions: 100, clicks: 5,
    conversions: 0, frequency: 1.2, currency: 'USD',
    measurementWindow: 'ROLLING_WINDOW', // Phase C: every row states its period
  },
  {
    entityLevel: 'CAMPAIGN', externalId: 'c1', parentExternalId: 'act_9', name: 'Leads Q3',
    objective: 'OUTCOME_LEADS', source: 'META',
    date: DATE, spendMinor: 10000, revenueMinor: 0, impressions: 1000, clicks: 50,
    conversions: 8, frequency: 1.5, currency: 'USD',
    measurementWindow: 'ROLLING_WINDOW',
    ...campaignOver,
  },
];

const campaignUpsertArg = () => prisma.campaign.upsert.mock.calls[0][0];

describe('landSnapshots — objective ingest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts the campaign on its deterministic id (re-sync hits the same row)', async () => {
    await landSnapshots(WS, 'META', batch());
    expect(campaignUpsertArg().where).toEqual({ id: detId(WS, 'META', 'CAMPAIGN', 'c1') });
  });

  it('a KNOWN objective is written on both create and update', async () => {
    await landSnapshots(WS, 'META', batch());
    const arg = campaignUpsertArg();
    expect(arg.create.objective).toBe('OUTCOME_LEADS');
    expect(arg.update.objective).toBe('OUTCOME_LEADS');
  });

  it('a later sync with NULL objective preserves the prior one (update omits the key)', async () => {
    await landSnapshots(WS, 'META', batch({ objective: null }));
    const arg = campaignUpsertArg();
    // create still records the null (a first-ever sight of the campaign)…
    expect(arg.create.objective).toBeNull();
    // …but update must NOT carry objective, so an already-resolved value survives.
    expect('objective' in arg.update).toBe(false);
  });

  it('objective is a campaign-only column — never stamped on the account op', async () => {
    await landSnapshots(WS, 'META', batch());
    const accountArg = prisma.account.upsert.mock.calls[0][0];
    expect('objective' in accountArg.create).toBe(false);
    expect('objective' in accountArg.update).toBe(false);
  });
});
