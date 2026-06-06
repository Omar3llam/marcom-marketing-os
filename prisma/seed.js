// ============================================================
// MARCOM / Lumi — Phase 1 substrate seed
// ============================================================
// Loads the apparel / riyadh / dubai fixtures into the new numeric
// schema: Workspace → Account → Campaign → AdSet → Ad → Creative,
// with MetricSnapshot rows in INTEGER minor units, plus one example
// Decision → OutcomeSnapshot → DecisionMemoryEntry (apparel Eid KILL)
// to exercise the decision graph end-to-end.
//
// Idempotent: every row uses a deterministic UUID, so re-running
// upserts in place. Run with:  npm run seed
// ============================================================

import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { toMinor } from '../src/lib/money.js';

const prisma = new PrismaClient();

/** Deterministic UUID (v5-style) so seeds are idempotent. */
function det(name) {
  const hex = createHash('sha1').update(`marcom-seed:${name}`).digest('hex');
  const s = hex.slice(0, 32).split('');
  s[12] = '5'; // version
  s[16] = ((parseInt(s[16], 16) & 0x3) | 0x8).toString(16); // variant
  const j = s.join('');
  return `${j.slice(0, 8)}-${j.slice(8, 12)}-${j.slice(12, 16)}-${j.slice(16, 20)}-${j.slice(20, 32)}`;
}

const DATE = new Date('2026-05-19T00:00:00.000Z');

// ── Fixtures (major units; converted to minor at write time) ──
// Leaf spend/revenue sum to the campaign totals shown in the demo.
const WORKSPACES = [
  {
    key: 'apparel',
    name: 'Maison Salam',
    currency: 'EGP',
    channel: 'META',
    accountName: 'Maison Salam · Meta',
    campaigns: [
      {
        name: 'Eid Drop · Carousel · Cold ME',
        adsets: [
          {
            name: 'Carousel · 5 SKUs',
            ads: [
              { name: 'Carousel A', creatives: [{ name: 'Eid Hero 01', spend: 50000, revenue: 30000 }] },
              { name: 'Carousel B', creatives: [{ name: 'Eid Hero 02', spend: 34310, revenue: 20586 }] },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'riyadh',
    name: 'Layla & Co.',
    currency: 'SAR',
    channel: 'SNAP',
    accountName: 'Layla & Co. · Snap',
    campaigns: [
      {
        name: 'Static · Cold ME · Beauty Bundle',
        adsets: [
          {
            name: 'Static · 3 creatives',
            ads: [
              { name: 'Static A', creatives: [{ name: 'Bundle Still 01', spend: 30000, revenue: 27000 }] },
              { name: 'Static B', creatives: [{ name: 'Bundle Still 02', spend: 22400, revenue: 20160 }] },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'dubai',
    name: 'Forge Studio',
    currency: 'AED',
    channel: 'LINKEDIN',
    accountName: 'Forge Studio · Meta',
    campaigns: [
      {
        name: 'Meta Lead Form · Broad · CTO',
        adsets: [
          {
            name: 'Lead Form · 2 variants',
            ads: [
              { name: 'Lead Form A', creatives: [{ name: 'CTO Hook 01', spend: 10000, revenue: 0 }] },
              { name: 'Lead Form B', creatives: [{ name: 'CTO Hook 02', spend: 8900, revenue: 0 }] },
            ],
          },
        ],
      },
    ],
  },
];

/** Write a numeric MetricSnapshot for an entity (idempotent by id). */
async function snapshot({ workspaceId, entityId, entityLevel, currency, channel, spend, revenue, impressions, clicks, conversions }) {
  const spendMinor = toMinor(spend, currency);
  const revenueMinor = toMinor(revenue, currency);
  const cpaMinor = conversions > 0 ? Math.round(spendMinor / conversions) : null;
  const ctr = impressions > 0 ? clicks / impressions : null;
  const roas = spendMinor > 0 ? revenueMinor / spendMinor : null;

  const data = {
    workspaceId,
    entityId,
    entityLevel,
    date: DATE,
    source: channel === 'SNAP' ? 'SNAP' : channel === 'LINKEDIN' ? 'LINKEDIN' : 'META',
    granularity: 'DAILY',
    spendMinor,
    revenueMinor,
    cpaMinor,
    impressions,
    clicks,
    conversions,
    ctr,
    roas,
    frequency: null,
    currency,
  };
  const id = det(`snap:${entityId}`);
  await prisma.metricSnapshot.upsert({ where: { id }, create: { id, ...data }, update: data });
}

async function seedWorkspace(ws) {
  const workspaceId = det(`ws:${ws.key}`);
  await prisma.workspace.upsert({
    where: { id: workspaceId },
    create: { id: workspaceId, name: ws.name, currency: ws.currency },
    update: { name: ws.name, currency: ws.currency },
  });

  const accountId = det(`acct:${ws.key}`);
  const ent = { workspaceId, channel: ws.channel, status: 'ACTIVE' };
  await prisma.account.upsert({
    where: { id: accountId },
    create: { id: accountId, ...ent, name: ws.accountName },
    update: { ...ent, name: ws.accountName },
  });

  for (const camp of ws.campaigns) {
    const campaignId = det(`camp:${ws.key}:${camp.name}`);
    await prisma.campaign.upsert({
      where: { id: campaignId },
      create: { id: campaignId, ...ent, accountId, name: camp.name },
      update: { ...ent, accountId, name: camp.name },
    });

    for (const as of camp.adsets) {
      const adSetId = det(`adset:${ws.key}:${as.name}`);
      await prisma.adSet.upsert({
        where: { id: adSetId },
        create: { id: adSetId, ...ent, campaignId, name: as.name },
        update: { ...ent, campaignId, name: as.name },
      });

      for (const ad of as.ads) {
        const adId = det(`ad:${ws.key}:${ad.name}`);
        await prisma.ad.upsert({
          where: { id: adId },
          create: { id: adId, ...ent, adSetId, name: ad.name },
          update: { ...ent, adSetId, name: ad.name },
        });

        for (const cr of ad.creatives) {
          const creativeId = det(`cr:${ws.key}:${cr.name}`);
          await prisma.creative.upsert({
            where: { id: creativeId },
            create: { id: creativeId, ...ent, adId, name: cr.name },
            update: { ...ent, adId, name: cr.name },
          });

          // Leaf numeric snapshot (the substrate of truth). Synthetic
          // impressions/clicks/conversions derived from spend so ratios
          // are computable but coherent.
          const impressions = Math.round(cr.spend * 30);
          const clicks = Math.round(impressions * 0.01);
          const conversions = cr.revenue > 0 ? Math.max(1, Math.round(cr.revenue / 300)) : 0;
          await snapshot({
            workspaceId,
            entityId: creativeId,
            entityLevel: 'CREATIVE',
            currency: ws.currency,
            channel: ws.channel,
            spend: cr.spend,
            revenue: cr.revenue,
            impressions,
            clicks,
            conversions,
          });
        }
      }
    }
  }

  return { workspaceId, accountId };
}

async function seedDecisionGraph(ws) {
  // Apparel only: the Eid KILL verdict, with a realized outcome + memory.
  const workspaceId = det(`ws:${ws.key}`);
  const adSetId = det(`adset:${ws.key}:Carousel · 5 SKUs`);

  const decisionId = det(`decision:${ws.key}:eid-kill`);
  await prisma.decision.upsert({
    where: { id: decisionId },
    create: {
      id: decisionId,
      workspaceId,
      entityId: adSetId,
      entityLevel: 'ADSET',
      verdict: 'KILL',
      confidence: 0.92,
      diagnosis: 'CPA 73% above target, frequency past fatigue threshold, CTR collapsed 36% in 48h.',
      rootCause: 'CPA breach',
      status: 'EXECUTED',
    },
    update: {},
  });

  const outcomeId = det(`outcome:${ws.key}:eid-kill`);
  await prisma.outcomeSnapshot.upsert({
    where: { id: outcomeId },
    create: {
      id: outcomeId,
      workspaceId,
      decisionId,
      entityId: adSetId,
      entityLevel: 'ADSET',
      spendDeltaMinor: -toMinor(4200, ws.currency), // weekly bleed stopped
      revenueDeltaMinor: toMinor(18200, ws.currency), // monthly recovered
      roasDelta: 1.8,
      sustained: true,
    },
    update: {},
  });

  const memoryId = det(`memory:${ws.key}:eid-kill`);
  await prisma.decisionMemoryEntry.upsert({
    where: { id: memoryId },
    create: {
      id: memoryId,
      workspaceId,
      decisionId,
      entityId: adSetId,
      actionType: 'KILL',
      rationale: 'Eid cold-audience launches hit fatigue by day 14 — three prior matches confirm the pattern.',
      isSustainable: true,
      impactDurationHrs: 720,
    },
    update: {},
  });
}

async function main() {
  for (const ws of WORKSPACES) {
    await seedWorkspace(ws);
  }
  await seedDecisionGraph(WORKSPACES[0]); // apparel
  console.log('✓ Seeded entity graph + metric snapshots + decision graph for apparel/riyadh/dubai.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
