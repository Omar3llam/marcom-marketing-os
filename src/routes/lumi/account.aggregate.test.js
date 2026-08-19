// ============================================================
// R13-D / B2 — the account aggregate, against a real database
// ============================================================
// The pure arithmetic is pinned in AccountAggregateService.test.js. Three of
// this contract's claims cannot be proven there, because they are claims about
// a QUERY rather than a function:
//
//   ISOLATION    workspace A never aggregates workspace B's money
//   POPULATION   an operational row cannot become canonical by sitting nearby
//   HIERARCHY    an ad-set's spend is a SUBSET of its campaign's, and adding
//                both counts the same money twice
//
// A mocked prisma agrees with whatever the code asks it for, so none of the
// three can fail against one. Everything below runs through the real generated
// client, the real migrated schema and the real role gate.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { accountRouter } from './account.js';

const DB_OK = await dbAvailable();

const WS       = '00000000-0000-4000-8000-00000000b200';
const OTHER_WS = '00000000-0000-4000-8000-00000000b201';
const ACC      = '00000000-0000-4000-8000-00000000b2a0';
const OTHER_ACC = '00000000-0000-4000-8000-00000000b2a1';
const C1       = '00000000-0000-4000-8000-00000000b2c1';
const C2       = '00000000-0000-4000-8000-00000000b2c2';
const OTHER_C  = '00000000-0000-4000-8000-00000000b2c9';
const ADSET    = '00000000-0000-4000-8000-00000000b2d1';

const START = new Date('2026-07-20T00:00:00Z');
const END   = new Date('2026-08-18T00:00:00Z');
const SYNCED = new Date('2026-08-19T06:00:00Z');

function makeApp({ workspaceId = WS, collabRole = 'BUYER' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = workspaceId; req.collabRole = collabRole; next(); });
  app.use('/api/lumi', accountRouter); // flat-mounted, exactly as lumi/index.js does
  return app;
}

const get = (opts) => request(makeApp(opts)).get('/api/lumi/account/aggregate');

/** A canonical CUMULATIVE_30D campaign snapshot — the verdict population. */
const canonical = (entityId, over = {}) => ({
  workspaceId: WS, entityId, entityLevel: 'CAMPAIGN', date: SYNCED, source: 'META',
  measurementWindow: 'CUMULATIVE_30D', windowStart: START, windowEnd: END,
  spendMinor: 100_000, revenueMinor: 400_000, impressions: 50_000, clicks: 800,
  conversions: 20, roas: 4, ctr: 0.016, frequency: 2.1, currency: 'EGP',
  ...over,
});

async function seedCampaign(id, name, workspaceId = WS, accountId = ACC) {
  await prisma.campaign.create({
    data: {
      id, workspaceId, accountId, channel: 'META', name,
      objective: 'OUTCOME_SALES', externalId: `ext-${id.slice(-4)}`,
    },
  });
}

// ============================================================
// NOT SKIPPABLE. `describe.skipIf` turns an absent database into a green suite —
// the shape that let R12-1d hide for five weeks — so CI is required to have
// provided one. Locally the blocks below may skip; in CI they may not.
// ============================================================
describe('B2 — this contract must actually run', () => {
  it('CI provides a migrated database, so nothing below is vacuous', () => {
    if (process.env.CI) expect(DB_OK, 'CI must run this suite against real Postgres').toBe(true);
    else expect(typeof DB_OK).toBe('boolean');
  });
});

describe.skipIf(!DB_OK)('B2 — account aggregate over real rows', () => {
  beforeAll(async () => {
    for (const [id, name, cur] of [[WS, 'B2 WS', 'EGP'], [OTHER_WS, 'B2 Other', 'EGP']]) {
      await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, name, currency: cur } });
    }
    for (const [id, ws] of [[ACC, WS], [OTHER_ACC, OTHER_WS]]) {
      await prisma.account.upsert({
        where: { id }, update: {},
        create: { id, workspaceId: ws, channel: 'META', name: 'act', externalId: `act-${id.slice(-4)}` },
      });
    }
  });

  afterAll(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.campaign.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.account.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [WS, OTHER_WS] } } });
  });

  beforeEach(async () => {
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
    await prisma.campaign.deleteMany({ where: { workspaceId: { in: [WS, OTHER_WS] } } });
  });

  // ── 1. Contract shape ──────────────────────────────────────────────────────
  it('1. returns the aggregate structure with its provenance attached', async () => {
    await seedCampaign(C1, 'Eid');
    await prisma.metricSnapshot.create({ data: canonical(C1) });

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);

    const a = res.body.aggregate;
    expect(a.aggregationLevel).toBe('CAMPAIGN');
    expect(a.population.measurementWindow).toBe('CUMULATIVE_30D');
    expect(new Date(a.population.windowStart)).toEqual(START);
    expect(new Date(a.population.windowEnd)).toEqual(END);
    expect(a.population.boundsStatus).toBe('REPORTED');
    expect(a.currency).toBe('EGP');
    expect(a.spend.minor).toBe(100_000);
    expect(a.acquisition.conversions).toBe(20);
    expect(a.acquisition.blendedCpaMinor).toBe(5_000); // 100_000 / 20
    expect(a.verdicts).toHaveProperty('KILL');
    expect(a.spendByVerdict).toHaveProperty('KILL');
  });

  // ── 2. Workspace isolation ─────────────────────────────────────────────────
  it('2. never aggregates another workspace\'s money', async () => {
    await seedCampaign(C1, 'Ours');
    await prisma.metricSnapshot.create({ data: canonical(C1, { spendMinor: 10_000 }) });

    await seedCampaign(OTHER_C, 'Theirs', OTHER_WS, OTHER_ACC);
    await prisma.metricSnapshot.create({
      data: canonical(OTHER_C, { workspaceId: OTHER_WS, spendMinor: 999_999 }),
    });

    const res = await get();
    expect(res.body.aggregate.spend.minor).toBe(10_000);
    expect(res.body.aggregate.population.campaignCount).toBe(1);
  });

  it('2b. the other workspace sees only its own', async () => {
    await seedCampaign(C1, 'Ours');
    await prisma.metricSnapshot.create({ data: canonical(C1, { spendMinor: 10_000 }) });
    await seedCampaign(OTHER_C, 'Theirs', OTHER_WS, OTHER_ACC);
    await prisma.metricSnapshot.create({
      data: canonical(OTHER_C, { workspaceId: OTHER_WS, spendMinor: 777 }),
    });

    const res = await get({ workspaceId: OTHER_WS });
    expect(res.body.aggregate.spend.minor).toBe(777);
  });

  // ── 3. Population — the canonical filter is real, not decorative ───────────
  it('3. an operational row sitting beside a canonical one cannot enter the total', async () => {
    await seedCampaign(C1, 'Eid');
    await prisma.metricSnapshot.create({ data: canonical(C1, { spendMinor: 30_000 }) });
    // The SAME campaign, a ROLLING_WINDOW row synced later with a lifetime
    // figure. This is exactly the row that used to decide the number: the
    // operational reader ranks on `date`, and this one is newer.
    await prisma.metricSnapshot.create({
      data: canonical(C1, {
        measurementWindow: 'ROLLING_WINDOW',
        date: new Date('2026-08-19T23:00:00Z'),
        spendMinor: 5_000_000,
      }),
    });

    const res = await get();
    expect(res.body.aggregate.spend.minor).toBe(30_000);
    expect(res.body.aggregate.population.measurementWindow).toBe('CUMULATIVE_30D');
  });

  it('3b. a campaign whose ONLY row is operational contributes nothing at all', async () => {
    await seedCampaign(C1, 'Canonical');
    await prisma.metricSnapshot.create({ data: canonical(C1, { spendMinor: 40_000 }) });
    await seedCampaign(C2, 'Operational only');
    await prisma.metricSnapshot.create({
      data: canonical(C2, { measurementWindow: 'ROLLING_WINDOW', spendMinor: 60_000 }),
    });

    const res = await get();
    // Not 100_000. "Never measured over this window" is not "measured, and it
    // was zero" — and it is certainly not "add it in anyway".
    expect(res.body.aggregate.spend.minor).toBe(40_000);
    expect(res.body.aggregate.population.campaignCount).toBe(1);
  });

  it('3c. a non-platform (GA4) row cannot become verdict evidence', async () => {
    await seedCampaign(C1, 'Eid');
    await prisma.metricSnapshot.create({ data: canonical(C1, { spendMinor: 20_000 }) });
    await prisma.metricSnapshot.create({
      data: canonical(C1, {
        source: 'GA4', date: new Date('2026-08-19T23:00:00Z'), spendMinor: 888_888,
      }),
    });

    const res = await get();
    expect(res.body.aggregate.spend.minor).toBe(20_000);
  });

  // ── 4. Hierarchy — one level, never two summed ─────────────────────────────
  it('4. ad-set and ad rows never join the campaign total', async () => {
    await seedCampaign(C1, 'Eid');
    await prisma.metricSnapshot.create({ data: canonical(C1, { spendMinor: 100_000 }) });
    // The SAME money, reported one and two levels down. A reader that summed
    // levels would report 160_000 for an account that spent 100_000.
    await prisma.metricSnapshot.create({
      data: canonical(ADSET, { entityLevel: 'ADSET', spendMinor: 60_000 }),
    });
    await prisma.metricSnapshot.create({
      data: canonical(ADSET, { entityLevel: 'AD', spendMinor: 25_000 }),
    });

    const res = await get();
    expect(res.body.aggregate.spend.minor).toBe(100_000);
    expect(res.body.aggregate.aggregationLevel).toBe('CAMPAIGN');
  });

  it('4b. a row at the WRONG LEVEL under a campaign\'s own id cannot win the reduction', async () => {
    // The case the entityLevel filter is actually load-bearing for. The join
    // above is by campaign identity, so an ad-set row with its OWN id can never
    // be mistaken for a campaign. A row carrying the CAMPAIGN's id at ADSET
    // level can — it survives the identity join and is newer, so it would win
    // latest-per-entity and replace the campaign's spend with a subset of it.
    await seedCampaign(C1, 'Eid');
    await prisma.metricSnapshot.create({ data: canonical(C1, { spendMinor: 100_000 }) });
    await prisma.metricSnapshot.create({
      data: canonical(C1, {
        entityLevel: 'ADSET',
        date: new Date('2026-08-19T23:00:00Z'),
        spendMinor: 7,
      }),
    });

    const res = await get();
    expect(res.body.aggregate.spend.minor).toBe(100_000);
  });

  // ── 5. Spend + CPA over known rows ─────────────────────────────────────────
  it('5. sums exactly, and divides totals rather than averaging ratios', async () => {
    await seedCampaign(C1, 'Big');
    await seedCampaign(C2, 'Small');
    await prisma.metricSnapshot.create({ data: canonical(C1, { spendMinor: 90_000, conversions: 30 }) });
    await prisma.metricSnapshot.create({ data: canonical(C2, { spendMinor: 10_000, conversions: 20 }) });

    const a = (await get()).body.aggregate;
    expect(a.spend.minor).toBe(100_000);
    expect(a.acquisition.conversions).toBe(50);
    expect(a.acquisition.blendedCpaMinor).toBe(2_000);  // 100_000 / 50
    expect(a.acquisition.blendedCpaMinor).not.toBe(1_750); // mean(3_000, 500)
  });

  it('6. no conversions anywhere → null CPA, never 0', async () => {
    await seedCampaign(C1, 'Awareness');
    await prisma.metricSnapshot.create({ data: canonical(C1, { conversions: 0, revenueMinor: 0, roas: null }) });

    const a = (await get()).body.aggregate;
    expect(a.acquisition.conversions).toBe(0);
    expect(a.acquisition.blendedCpaMinor).toBeNull();
    expect(a.acquisition.unavailable).toBe('NO_CONVERSIONS');
  });

  // ── 6. Mixed currency ──────────────────────────────────────────────────────
  it('7. two currencies produce no money figure at all', async () => {
    await seedCampaign(C1, 'EGP campaign');
    await seedCampaign(C2, 'USD campaign');
    await prisma.metricSnapshot.create({ data: canonical(C1, { currency: 'EGP', spendMinor: 100_000 }) });
    await prisma.metricSnapshot.create({ data: canonical(C2, { currency: 'USD', spendMinor: 50_000 }) });

    const a = (await get()).body.aggregate;
    expect(a.currencyStatus).toBe('MIXED');
    expect(a.spend.minor).toBeNull();
    expect(a.spend.unavailable).toBe('MIXED_CURRENCY');
    expect(a.spendByVerdict).toBeNull();
    // Counts are currency-free and survive.
    expect(a.population.campaignCount).toBe(2);
    expect(a.acquisition.conversions).toBe(40);
  });

  // ── 7. Empty ───────────────────────────────────────────────────────────────
  it('8. an account with no canonical rows returns an explicit empty state', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('NO_CANONICAL_MEASUREMENT');
    expect(res.body.aggregate).toBeNull();
    // The thing this must never be: a shell of zeroes that reads as a measured
    // account with nothing in it.
    expect(JSON.stringify(res.body)).not.toMatch(/"spend":\s*\{"minor":0/);
  });

  it('9. a campaign with no snapshot at all is not counted as zero spend', async () => {
    await seedCampaign(C1, 'Never synced');
    const res = await get();
    expect(res.body.available).toBe(false);
  });

  // ── 8. Verdict lanes reconcile against real rows ───────────────────────────
  it('10. every campaign\'s spend lands in exactly one lane, and the lanes sum to the total', async () => {
    await seedCampaign(C1, 'One');
    await seedCampaign(C2, 'Two');
    await prisma.metricSnapshot.create({ data: canonical(C1, { spendMinor: 70_000 }) });
    await prisma.metricSnapshot.create({ data: canonical(C2, { spendMinor: 30_000 }) });

    const a = (await get()).body.aggregate;
    const laneSum = Object.values(a.spendByVerdict).reduce((s, v) => s + v, 0);
    expect(laneSum).toBe(a.spend.minor);
    expect(laneSum).toBe(100_000);
  });

  // ── 9. Authorization ───────────────────────────────────────────────────────
  it('11. a CLIENT cannot read the efficiency aggregate', async () => {
    await seedCampaign(C1, 'Eid');
    await prisma.metricSnapshot.create({ data: canonical(C1) });

    const res = await get({ collabRole: 'CLIENT' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/spend/i);
  });

  it('12. a STRATEGIST can', async () => {
    await seedCampaign(C1, 'Eid');
    await prisma.metricSnapshot.create({ data: canonical(C1) });
    expect((await get({ collabRole: 'STRATEGIST' })).status).toBe(200);
  });
});
