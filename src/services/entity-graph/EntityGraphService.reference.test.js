import { canonicalContentHash } from '../verdict-engine/evidenceReference.js';
import { Prisma } from '@prisma/client';
// ============================================================
// R5 — the READER declares the basis, and it reaches the row
// ============================================================
// This file exists because a negative control found it missing. Dropping
// `population` from CANONICAL_VERDICT_EVIDENCE_BASIS broke nothing: the write
// path is tested against a hand-written basis (on purpose — a parity test must
// not agree with the implementation about the shape), and the projector is
// tested in isolation. Nothing tested the seam BETWEEN them: that the canonical
// read actually declares a basis, that it is the right one, and that the row
// count is the number of rows the reduction ranked rather than the one it kept.
//
// Every assertion here is against a literal, never against the exported
// constant. Importing it would make this file agree with the thing it is
// checking, which is exactly how the gap got here.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  prisma: {
    campaign:       { findMany: vi.fn(), findFirst: vi.fn() },
    adSet:          { findMany: vi.fn() },
    ad:             { findMany: vi.fn() },
    metricSnapshot: { findMany: vi.fn() }, $queryRaw: vi.fn(),
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: h.prisma }));
vi.mock('../../utils/logger.js', () => ({ logger: h.logger }));

import { getCanonicalVerdictCampaigns, getConnectorCampaigns } from './EntityGraphService.js';

const WS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';

const ago = (d) => new Date(Date.now() - d * 86_400_000);

const CAMPAIGNS = [
  { id: C1, name: 'Always On', channel: 'META', objective: 'CONVERSIONS', externalId: '111', platformCreatedTime: ago(300), _count: { adSets: 2 } },
  { id: C2, name: 'Second',    channel: 'META', objective: 'TRAFFIC',     externalId: '222', platformCreatedTime: ago(200), _count: { adSets: 0 } },
];

// A canonical row. The selector's own filters are exercised by
// canonicalVerdictEvidence.test.js; here the fake simply returns what it is told
// so the assertions are about the BASIS the reader declares over those rows.
const canonicalRow = (over = {}) => ({
  entityId: C1, source: 'META', date: ago(1), currency: 'EGP',
  spendMinor: 100_000, revenueMinor: 400_000, impressions: 50_000, clicks: 800,
  conversions: 20, roas: 4, ctr: 0.016, frequency: 2.1, reach: 20_000,
  actionMetrics: null, dailyBudgetMinor: null,
  // R13-D / B1 — the period this row measured, as the platform stated it.
  // Deliberately NOT derivable from `date`: the row was synced yesterday and
  // measures 20 Jul → 18 Aug, so anything reconstructed from the sync timestamp
  // lands somewhere else.
  measurementWindow: 'CUMULATIVE_30D',
  windowStart: new Date('2026-07-20T00:00:00Z'),
  windowEnd:   new Date('2026-08-18T00:00:00Z'),
  ...over,
});

const project = (rows, select) => {
  const fields = Object.keys(select ?? {}).filter((k) => select[k]);
  return rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
};

const rowFor = (rows, id) => rows.find((r) => r.entityId === id);

beforeEach(() => {
  vi.clearAllMocks();
  // B5-01F — the canonical reader is now time-relative (evidence older than
  // MAX_CANONICAL_EVIDENCE_AGE_DAYS is gated out), and this suite's fixture
  // describes a window ending 2026-08-18. Pinned so the provenance assertions
  // below stay about provenance; freshness has its own suite.
  //
  // TWO DAYS AFTER that window ends, not on the day itself: the fixture's `date`
  // is RELATIVE (`ago(1)`) while its window bounds are absolute, and the R13-D
  // test below turns on `lastDate` being LATER than `windowEnd` — the whole point
  // being that a sync timestamp is not a measurement period. Pinning to the 18th
  // would put the "synced yesterday" row before the window it measures. The 20th
  // keeps that ordering true and the evidence comfortably fresh (age 2 of 3).
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-20T09:00:00Z'));
  h.prisma.campaign.findMany.mockResolvedValue(CAMPAIGNS);
  arrangeCaptured([canonicalRow()]);
});

describe('R5 — the canonical verdict read declares its basis', () => {
  it('attaches the basis this population actually has', async () => {
    // Against a literal. If the exported constant loses a field, or gains a
    // wrong one, this fails — which is precisely what it did not do before.
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceBasis).toEqual({
      population:        'canonical-verdict',
      selector:          'selectCanonicalVerdictSnapshots',
      measurementWindow: 'CUMULATIVE_30D',
      // B5-01E — the reduction is now the resolver's, and the name changed with
      // it. `latest-per-entity` described ranking on `date` (the sync
      // timestamp); the row is now chosen by structural resolution ordered on
      // windowEnd. A stored decision claiming the old name would describe a
      // selection that no longer happens.
      reduction:         'canonical-resolved-per-entity',
      rowCount:          1,
    });
  });

  it('names the population — it is not left to be inferred downstream', async () => {
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceBasis.population).toBe('canonical-verdict');
    expect(rowFor(campaigns, C1).evidenceBasis.population).not.toBeUndefined();
  });

  it('names the window, because this selector can return exactly one', async () => {
    // `equals`, not an `in` list — so every row it can return represents this
    // window, and saying so is a fact rather than a guess.
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceBasis.measurementWindow).toBe('CUMULATIVE_30D');
  });

  it('counts the rows the reduction RANKED, not the one it kept', async () => {
    // THE MULTI-ROW ASSERTION at the read. Three canonical rows for one campaign,
    // latest-per-entity keeps one — and a basis reporting rowCount 1 would say
    // the verdict rested on a single reading.
    arrangeCaptured([
      canonicalRow({ date: ago(3) }),
      canonicalRow({ date: ago(2) }),
      canonicalRow({ date: ago(1) }),
    ]);

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceBasis.rowCount).toBe(3);
    // …and the row still carries the ONE contributing observation.
    expect(rowFor(campaigns, C1).evidenceRows).toHaveLength(1);
  });

  it('counts per campaign, never the whole read', async () => {
    // Two campaigns, two rows each. A count taken over the query rather than
    // per entity would report 4 against both.
    arrangeCaptured([
      canonicalRow({ entityId: C1, date: ago(2) }),
      canonicalRow({ entityId: C1, date: ago(1) }),
      canonicalRow({ entityId: C2, date: ago(1) }),
    ]);

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceBasis.rowCount).toBe(2);
    expect(rowFor(campaigns, C2).evidenceBasis.rowCount).toBe(1);
  });

  it('carries the contributing row\'s source and observation time', async () => {
    const observed = ago(1);
    arrangeCaptured([canonicalRow({ date: observed })]);

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceRows).toMatchObject([
      { entityId: C1, source: 'META', observedAt: observed.toISOString() },
    ]);
  });

  it('does not change the campaign row it has always produced', async () => {
    // Additive at the read too: the metrics the verdict path consumes are the
    // ones it consumed before.
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    const row = rowFor(campaigns, C1);
    expect(row.spendMinor).toBe(100_000);
    expect(row.roas).toBe(4);
    expect(row.name).toBe('Always On');
  });
});

describe('R5 — the operational read declares a DIFFERENT basis', () => {
  it('names the operational population and its own reduction', async () => {
    const campaigns = await getConnectorCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceBasis).toEqual({
      population: 'operational',
      selector:   'selectOperationalSnapshots',
      reduction:  'effective-by-entity',
      rowCount:   1,
    });
  });

  it('states NO window — that population admits two and projects neither', async () => {
    // The key is absent, not null-valued and not borrowed from the canonical
    // read beside it. Naming either window would invent a measurement period
    // out of a filter's allow-list.
    const campaigns = await getConnectorCampaigns(WS);
    const basis = rowFor(campaigns, C1).evidenceBasis;
    expect(Object.prototype.hasOwnProperty.call(basis, 'measurementWindow')).toBe(false);
    expect(basis.measurementWindow).toBeUndefined();
  });

  it('is distinguishable from the canonical basis on population AND selector', async () => {
    // I4 carried one step further than the query layer: two reads, two
    // measurements, and a decision built on either can say which.
    const operational = rowFor(await getConnectorCampaigns(WS), C1).evidenceBasis;
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    const canonical = rowFor(campaigns, C1).evidenceBasis;

    expect(operational.population).not.toBe(canonical.population);
    expect(operational.selector).not.toBe(canonical.selector);
    expect(operational.reduction).not.toBe(canonical.reduction);
  });
});

// ============================================================
// R13-D / B1 — the DECLARED basis is not the same claim as the row's own
// ============================================================
// The block above pins what the READER declares. This one pins what the ROW
// answers, and the two are separate on purpose: a basis is a description of the
// query, and a query can be described correctly while returning columns it never
// asked for.
//
// That is exactly what was happening. `evidenceBasis.measurementWindow` said
// CUMULATIVE_30D on every canonical row — truthfully, the filter guarantees it —
// while `row.measurementWindow` was null on every one of them, because
// CANONICAL_VERDICT_SELECT did not project the column. The declaration was right
// and the row was empty, and /entities/verdicts publishes the row.
//
// These tests run through the real `project()` fake, so they fail if the SELECT
// stops asking — which is the defect B1 closed, caught at the seam where it lived
// rather than at the API where it showed.
// ============================================================
describe('R13-D — the canonical row states its own period', () => {
  it('carries the window off the query projection, not off the declared basis', async () => {
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    const row = rowFor(campaigns, C1);

    expect(row.measurementWindow).toBe('CUMULATIVE_30D');
    expect(row.windowStart).toEqual(new Date('2026-07-20T00:00:00Z'));
    expect(row.windowEnd).toEqual(new Date('2026-08-18T00:00:00Z'));
  });

  it('the bounds are the platform\'s, never reconstructed from the sync time', async () => {
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    const row = rowFor(campaigns, C1);

    // `lastDate` IS the sync timestamp and is published beside these three. It
    // is a day old here; the window it sits next to ended weeks earlier. A
    // reader that treated one as the other would misdate every canonical figure
    // on the surface by however long the account had been syncing.
    expect(row.lastDate).not.toEqual(row.windowEnd);
    expect(new Date(row.lastDate).getTime()).toBeGreaterThan(row.windowEnd.getTime());
  });

  // B5-01E CHANGED THIS ONE, AND THE CHANGE IS THE POINT.
  //
  // It used to assert that a canonical row reporting NO period was published
  // with null bounds and its label intact — "partial provenance, honestly
  // reported". That was honest about the projection and wrong about the row:
  // a row that cannot say which period it measured is not evidence for a
  // measurement, and canonicalEligibility has always called it MISSING_PERIOD.
  // Nothing consulted that opinion, because the old selector ranked on `date`
  // and validated nothing.
  //
  // Now the resolver decides, so such a row is refused rather than published.
  // The absence is the honest answer, and it is the same absence a campaign with
  // no canonical rows at all receives.
  it('a canonical row that reported NO period is not verdict evidence at all', async () => {
    arrangeCaptured([canonicalRow({ windowStart: null, windowEnd: null })]);

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);

    expect(rowFor(campaigns, C1)).toBeUndefined();
    expect(noCanonicalWindow.map((c) => c.id)).toContain(C1);
    // NOT fabricated into a row with null bounds, and NOT back-filled from the
    // sync timestamp — the two ways a period-less row could have been published.
    expect(campaigns.some((c) => c.windowStart == null)).toBe(false);
  });
});

// ============================================================
// R13-D / B2 — BOTH workspace predicates, not just the load-bearing one
// ============================================================
// Isolation on the canonical verdict path is defended twice: the campaign
// IDENTITY read is workspace-scoped, and so is the snapshot read underneath it.
// A B2 mutation control found that only the second was pinned — deleting
// `where: { workspaceId }` from the identity read broke no test, because the
// snapshot filter still bounded the money and the foreign campaigns simply
// arrived with no evidence.
//
// Harmless for the aggregate; not harmless in general. Those foreign identities
// come back carrying NAME and CHANNEL, and the verdict path reports campaigns
// without canonical evidence as `noCanonicalWindow` — so a missing predicate
// here leaks another workspace's campaign names onto this workspace's payload
// without a single number moving. Defense in depth is only depth if both layers
// are held in place.
// ============================================================
describe('R13-D — the canonical verdict path is workspace-scoped at BOTH reads', () => {
  it('the campaign IDENTITY read names the workspace', async () => {
    await getCanonicalVerdictCampaigns(WS);
    const args = h.prisma.campaign.findMany.mock.calls.at(-1)[0];
    expect(args.where).toEqual({ workspaceId: WS });
  });

  it('the SNAPSHOT read names it too, independently', async () => {
    await getCanonicalVerdictCampaigns(WS);
    const query = Prisma.sql(...h.prisma.$queryRaw.mock.calls.at(-1));
    expect(query.values).toEqual([WS, C1, C2]);
    expect(query.sql).toContain('o.workspace_id=');
  });

  it('no workspace ⇒ no read at all, rather than an unscoped one', async () => {
    h.prisma.campaign.findMany.mockClear();
    const out = await getCanonicalVerdictCampaigns(null);
    expect(out).toEqual({ campaigns: [], noCanonicalWindow: [], staleEvidence: [] });
    expect(h.prisma.campaign.findMany).not.toHaveBeenCalled();
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

function arrangeCaptured(rows) {
  h.prisma.metricSnapshot.findMany.mockImplementation((args) => Promise.resolve(project(rows, args.select)));
  h.prisma.$queryRaw.mockResolvedValue(captured(rows));
}
