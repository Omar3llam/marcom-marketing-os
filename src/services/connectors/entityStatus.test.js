// ============================================================
// Delivery status — the end of the hardcoded ACTIVE
// ------------------------------------------------------------
// snapshotSink stamped `status: 'ACTIVE'` on every entity it wrote, and the
// update path re-wrote it on EVERY sync. So a paused campaign asserted it was
// running, forever, and the diagnosis engine had no way to know otherwise —
// "creative fatigue" on an ad set that stopped delivering weeks ago.
//
// The chain has three hops and each one dropped it independently:
//   merge      — /insights never returns status; only the roster does, and the
//                roster row is DISCARDED for any entity that has insights
//   normalize  — read neither field
//   sink       — hardcoded ACTIVE over whatever arrived
//
// These cover all three, plus the mapping: Meta's effective_status vocabulary
// is far wider than our three-value enum, and passing one through raw would
// throw on the Prisma column.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => {
  const model = () => ({ upsert: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) });
  const prisma = {
      workspace: { findUnique: vi.fn(async () => ({ id: 'ws-1' })) },
      account: model(), campaign: model(), adSet: model(), ad: model(), creative: model(),
      metricSnapshot: model(),
      $transaction: vi.fn((operation) => operation(prisma)),
      $queryRaw: vi.fn(async () => [{ id: 'ws-1' }]),
      // B4-E4: snapshots are written through a raw predicated upsert now. These
      // suites are about the ENTITY ops above and do not inspect it, but the
      // mock has to answer the call the code makes.
      $executeRaw: vi.fn().mockResolvedValue(1),
  };
  return { prisma };
});
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { landSnapshots, toEntityOps } from './snapshotSink.js';
import { metaNormalize, toEntityStatus } from './normalize/metaNormalize.js';
import { mergeMetaAdSets, mergeMetaCampaigns } from '../metaAdsService.js';

const WS = 'ws-1';
const DATE = new Date('2026-07-01T00:00:00Z');

const normalizeMeta = (rows) => metaNormalize({
  accountExternalId: 'act_1', currency: 'USD', date: DATE, rows,
});
const adSetOut = (rows) => normalizeMeta(rows).find((n) => n.entityLevel === 'ADSET');
const campaignOut = (rows) => normalizeMeta(rows).find((n) => n.entityLevel === 'CAMPAIGN');

beforeEach(() => vi.clearAllMocks());

describe('toEntityStatus — Meta vocabulary → the EntityStatus enum', () => {
  it.each([
    ['ACTIVE', 'ACTIVE'],
    ['PAUSED', 'PAUSED'],
    ['ARCHIVED', 'ARCHIVED'],
    ['DELETED', 'ARCHIVED'],
  ])('%s → %s', (raw, expected) => {
    expect(toEntityStatus(raw, null)).toBe(expected);
  });

  // The one that matters most: an ad set whose OWN switch is on, inside a paused
  // campaign, is not running. Reading `status` alone would call it active.
  it.each([['CAMPAIGN_PAUSED'], ['ADSET_PAUSED']])('%s is PAUSED, not ACTIVE', (eff) => {
    expect(toEntityStatus('ACTIVE', eff)).toBe('PAUSED');
  });

  it('prefers effective_status over status', () => {
    expect(toEntityStatus('ACTIVE', 'PAUSED')).toBe('PAUSED');
    expect(toEntityStatus('PAUSED', 'ACTIVE')).toBe('ACTIVE');
  });

  // Neither running nor paused. Guessing either would be a fabrication, and
  // passing the raw string through would throw on the Prisma enum column.
  it.each([['PENDING_REVIEW'], ['DISAPPROVED'], ['IN_PROCESS'], ['WITH_ISSUES'], ['PREAPPROVED']])(
    '%s is unknown → null, never a guess', (eff) => {
      expect(toEntityStatus(null, eff)).toBeNull();
    });

  it.each([[null], [undefined], ['']])('absent (%s) → null', (v) => {
    expect(toEntityStatus(v, v)).toBeNull();
  });
});

describe('merge — status reaches the DELIVERING rows, not just the roster', () => {
  // /insights carries no status at all, and the roster row for an entity that
  // HAS insights is discarded. Without the fold, every delivering entity — the
  // common case — arrives with no status and falls to the ACTIVE default.
  it('folds the ad-set roster status onto its insight row', () => {
    const [row] = mergeMetaAdSets(
      [{ adset_id: 'as1', campaign_id: 'c1', spend: '100' }],
      [{ id: 'as1', name: 'Broad', campaign_id: 'c1', status: 'PAUSED', effective_status: 'PAUSED' }],
    );
    expect(row).toMatchObject({ adset_id: 'as1', status: 'PAUSED', effective_status: 'PAUSED' });
  });

  it('folds the campaign roster status onto its insight row', () => {
    const [row] = mergeMetaCampaigns(
      [{ campaign_id: 'c1', spend: '100' }],
      [{ id: 'c1', name: 'Eid', status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED' }],
    );
    expect(row).toMatchObject({ status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED' });
  });

  it('roster-only ad sets carry their own status', () => {
    const [row] = mergeMetaAdSets([], [
      { id: 'as1', name: 'Broad', campaign_id: 'c1', status: 'PAUSED', effective_status: 'PAUSED' },
    ]);
    expect(row).toMatchObject({ _rosterOnly: true, status: 'PAUSED' });
  });

  // Same contract `objective` already keeps: an absent value adds NO key, so
  // rows stay byte-identical when Meta omits it.
  it('a roster with no status adds no key at all', () => {
    const [row] = mergeMetaAdSets(
      [{ adset_id: 'as1', campaign_id: 'c1', spend: '100' }],
      [{ id: 'as1', name: 'Broad', campaign_id: 'c1' }],
    );
    expect(row).not.toHaveProperty('status');
    expect(row).not.toHaveProperty('effective_status');
  });
});

describe('normalize — both levels project a mapped status', () => {
  it('an ad-set row carries its status', () => {
    const out = adSetOut([{ adset_id: 'as1', campaign_id: 'c1', spend: '100', impressions: '1000', status: 'PAUSED' }]);
    expect(out.status).toBe('PAUSED');
  });

  it('a campaign row carries its status — the same drop, one level up', () => {
    const out = campaignOut([{ campaign_id: 'c1', campaign_name: 'Eid', spend: '100', effective_status: 'CAMPAIGN_PAUSED' }]);
    expect(out.status).toBe('PAUSED');
  });

  it.each([['adSet'], ['campaign']])('a %s row Meta said nothing about is null, never ACTIVE', (level) => {
    const out = level === 'adSet'
      ? adSetOut([{ adset_id: 'as1', campaign_id: 'c1', spend: '100' }])
      : campaignOut([{ campaign_id: 'c1', campaign_name: 'Eid', spend: '100' }]);
    expect(out.status).toBeNull();
  });
});

describe('toEntityOps — the hardcode is gone', () => {
  const op = (over = {}) => toEntityOps(WS, 'META', [{
    externalId: 'c1', entityLevel: 'CAMPAIGN', parentExternalId: 'act_1',
    name: 'Eid', date: DATE, currency: 'USD', spendMinor: 100, ...over,
  }])[0];

  it('never stamps a status the connector did not resolve', () => {
    expect(op({ status: null })).not.toHaveProperty('data.status');
    expect(op({ status: null }).data.status).toBeUndefined();
  });

  it.each([['PAUSED'], ['ARCHIVED'], ['ACTIVE']])('passes %s through when it IS known', (status) => {
    expect(op({ status }).data.status).toBe(status);
  });
});

describe('landSnapshots — a re-sync never re-activates a paused entity', () => {
  // Phase C: measurementWindow is required on every normalized row reaching the
  // sink — ROLLING_WINDOW is what a live Meta sync produces.
  //
  // B4-E4: `source` is stated too. It is NOT NULL in the schema and part of the
  // write identity, so a row without one could never have persisted — the mock
  // simply never checked. These tests are about the ENTITY upsert either way.
  const land = (status) => landSnapshots(WS, 'META', [
    { externalId: 'act_1', entityLevel: 'ACCOUNT', name: 'Acct', date: DATE, source: 'META', currency: 'USD', spendMinor: 100, measurementWindow: 'ROLLING_WINDOW' },
    { externalId: 'c1', entityLevel: 'CAMPAIGN', parentExternalId: 'act_1', name: 'Eid', date: DATE, source: 'META', currency: 'USD', spendMinor: 100, status, measurementWindow: 'ROLLING_WINDOW' },
  ]);
  const campaignUpsert = () => prisma.campaign.upsert.mock.calls[0][0];

  it('writes a known PAUSED on both create and update', async () => {
    await land('PAUSED');
    expect(campaignUpsert().create.status).toBe('PAUSED');
    expect(campaignUpsert().update.status).toBe('PAUSED');
  });

  // THE BUG. The update path unconditionally wrote op.data.status, which was
  // always the hardcoded 'ACTIVE' — so every sync silently un-paused everything.
  it('omits status entirely when unknown, leaving the stored value alone', async () => {
    await land(null);
    expect(campaignUpsert().create).not.toHaveProperty('status');
    expect(campaignUpsert().update).not.toHaveProperty('status');
  });

  it('still writes the name on every sync (unchanged)', async () => {
    await land(null);
    expect(campaignUpsert().update.name).toBe('Eid');
  });
});
