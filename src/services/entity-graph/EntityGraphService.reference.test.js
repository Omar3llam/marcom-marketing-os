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
    metricSnapshot: { findMany: vi.fn() },
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
  actionMetrics: null, dailyBudgetMinor: null, ...over,
});

const project = (rows, select) => {
  const fields = Object.keys(select ?? {}).filter((k) => select[k]);
  return rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
};

const rowFor = (rows, id) => rows.find((r) => r.entityId === id);

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.campaign.findMany.mockResolvedValue(CAMPAIGNS);
  h.prisma.metricSnapshot.findMany.mockImplementation((args) =>
    Promise.resolve(project([canonicalRow()], args.select)));
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
      reduction:         'latest-per-entity',
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
    h.prisma.metricSnapshot.findMany.mockImplementation((args) => Promise.resolve(project([
      canonicalRow({ date: ago(3) }),
      canonicalRow({ date: ago(2) }),
      canonicalRow({ date: ago(1) }),
    ], args.select)));

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceBasis.rowCount).toBe(3);
    // …and the row still carries the ONE contributing observation.
    expect(rowFor(campaigns, C1).evidenceRows).toHaveLength(1);
  });

  it('counts per campaign, never the whole read', async () => {
    // Two campaigns, two rows each. A count taken over the query rather than
    // per entity would report 4 against both.
    h.prisma.metricSnapshot.findMany.mockImplementation((args) => Promise.resolve(project([
      canonicalRow({ entityId: C1, date: ago(2) }),
      canonicalRow({ entityId: C1, date: ago(1) }),
      canonicalRow({ entityId: C2, date: ago(1) }),
    ], args.select)));

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceBasis.rowCount).toBe(2);
    expect(rowFor(campaigns, C2).evidenceBasis.rowCount).toBe(1);
  });

  it('carries the contributing row\'s source and observation time', async () => {
    const observed = ago(1);
    h.prisma.metricSnapshot.findMany.mockImplementation((args) =>
      Promise.resolve(project([canonicalRow({ date: observed })], args.select)));

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(rowFor(campaigns, C1).evidenceRows).toEqual([
      { entityId: C1, source: 'META', observedAt: observed },
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
