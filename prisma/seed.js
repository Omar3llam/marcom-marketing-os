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

async function seedPhase2(ws) {
  // Apparel only: a couple of guardrail rules + a forward-looking
  // fatigue prediction, to exercise the Phase 2 verdict intelligence.
  const workspaceId = det(`ws:${ws.key}`);
  const adSetId = det(`adset:${ws.key}:Carousel · 5 SKUs`);

  const rules = [
    { key: 'cold-cpa', name: 'Cold CPA breach', scopeLevel: 'ADSET', audienceTag: 'cold',
      metric: 'cpaOverTargetPct', comparator: 'GTE', threshold: 50, unit: 'PCT', sustainedDays: 2, emitVerdict: 'KILL' },
    { key: 'roas-floor', name: 'ROAS floor', scopeLevel: 'ADSET', audienceTag: null,
      metric: 'roas', comparator: 'LT', threshold: 1, unit: 'RATIO', sustainedDays: 1, emitVerdict: 'WATCH' },
  ];
  for (const r of rules) {
    const id = det(`guardrail:${ws.key}:${r.key}`);
    const data = {
      workspaceId, name: r.name, enabled: true, scopeLevel: r.scopeLevel, audienceTag: r.audienceTag,
      metric: r.metric, comparator: r.comparator, threshold: r.threshold, unit: r.unit,
      sustainedDays: r.sustainedDays, emitVerdict: r.emitVerdict,
    };
    await prisma.guardrailRule.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  const predId = det(`fatigue:${ws.key}:carousel`);
  const projected = new Date(DATE.getTime() + 3 * 86_400_000); // ~3 days out
  await prisma.fatiguePrediction.upsert({
    where: { id: predId },
    create: {
      id: predId, workspaceId, entityId: adSetId, entityLevel: 'ADSET',
      metric: 'frequency', ceiling: 3.5, projectedBreachDate: projected, confidence: 0.86,
      basis: 'frequency rising +0.3/day over 4-day trend, CTR decaying',
    },
    update: {},
  });
}

/**
 * Seed account-level reconciled channel snapshots, a secondary channel account, and a proposed allocation plan for the given workspace.
 *
 * Upserts: (1) ACCOUNT-level metric snapshots that demonstrate a reconciled META channel (platform vs GA4 actual), (2) a GOOGLE account with a platform snapshot (no GA4 actual, marked unverified), and (3) one PROPOSED AllocationPlan containing a monthly budget ceiling and projected metrics.
 * @param {Object} ws - Workspace fixture object; must include `key` (string) used for deterministic ids and `currency` (string) used to convert monetary values to minor units.
async function seedPhase3(ws) {
  // Apparel only: portfolio-level fixtures for the capital-allocation layer.
  //  • META account: an ACCOUNT-level platform snapshot + a GA4 ACTUAL
  //    snapshot on the SAME entity → the channel RECONCILES, surfacing the
  //    platform-over-reporting gap (blended < platform).
  //  • A second GOOGLE account with a platform snapshot but NO GA4 actual →
  //    stays UNVERIFIED (raw platform number, flagged low-confidence).
  //  • One PROPOSED AllocationPlan (its budget doubles as the monthly ceiling
  //    PortfolioService paces against).
  const workspaceId = det(`ws:${ws.key}`);
  const currency = ws.currency; // EGP

  // Helper: upsert a channel-level MetricSnapshot with an explicit source.
  async function channelSnap(key, { accountId, source, spend, revenue, impressions, clicks, conversions }) {
    const id = det(`p3snap:${key}`);
    const spendMinor = toMinor(spend, currency);
    const revenueMinor = toMinor(revenue, currency);
    const data = {
      workspaceId, entityId: accountId, entityLevel: 'ACCOUNT', date: DATE, source,
      granularity: 'DAILY', spendMinor, revenueMinor,
      cpaMinor: conversions > 0 ? Math.round(spendMinor / conversions) : null,
      impressions, clicks, conversions,
      ctr: impressions > 0 ? clicks / impressions : null,
      roas: spendMinor > 0 ? revenueMinor / spendMinor : null,
      frequency: null, currency,
    };
    await prisma.metricSnapshot.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  // ── Channel 1: META (reconciled) ──
  const metaAccountId = det(`acct:${ws.key}`); // the existing Meta account
  // Platform claims 50,586 EGP revenue on 84,310 spend (= the creative rollup).
  await channelSnap('apparel:meta:platform', {
    accountId: metaAccountId, source: 'META',
    spend: 84310, revenue: 50586, impressions: 2529300, clicks: 25293, conversions: 168,
  });
  // GA4 actual: only 38,000 EGP truly attributable → ~25% platform inflation.
  await channelSnap('apparel:meta:ga4', {
    accountId: metaAccountId, source: 'GA4',
    spend: 0, revenue: 38000, impressions: 0, clicks: 0, conversions: 126,
  });

  // ── Channel 2: GOOGLE (unverified — no GA4 actual) ──
  const googleAccountId = det(`acct:${ws.key}:google`);
  const ent = { workspaceId, channel: 'GOOGLE', status: 'ACTIVE' };
  await prisma.account.upsert({
    where: { id: googleAccountId },
    create: { id: googleAccountId, ...ent, name: 'Maison Salam · Google' },
    update: { ...ent, name: 'Maison Salam · Google' },
  });
  await channelSnap('apparel:google:platform', {
    accountId: googleAccountId, source: 'GOOGLE',
    spend: 40000, revenue: 96000, impressions: 800000, clicks: 16000, conversions: 200,
  });

  // ── A proposed allocation plan (budget = monthly ceiling) ──
  const planId = det(`alloc:${ws.key}:eid`);
  await prisma.allocationPlan.upsert({
    where: { id: planId },
    create: {
      id: planId, workspaceId,
      goalType: 'GROWTH_CEILING', goalValue: null,
      totalBudgetMinor: toMinor(150000, currency), // 150k EGP monthly ceiling
      currency,
      projectedRoas: 1.9, projectedCpaMinor: toMinor(410, currency),
      merBefore: 1.65, merAfter: 1.9,
      reasoning: [
        'Goal GROWTH_CEILING: distribute 150,000 EGP toward marginal efficiency; projected blended ROAS 1.65x → 1.90x.',
        'Grow Google (blended ROAS 2.40x, verified-pending) — strongest marginal return.',
        'Trim Meta: GA4 shows ~25% revenue over-report; blended ROAS 0.45x, below break-even.',
      ].join('\n'),
      status: 'PROPOSED',
    },
    update: {},
  });
}

/**
 * Seed Phase 4 "Testing OS" data for a workspace: upserts several test experiments,
 * their variants, linked decisions, and decision-memory entries to represent a weekly
 * agenda and closed-loop outcomes.
 *
 * Creates four scenarios for the apparel ad set: a PROPOSED hook test, a RUNNING
 * audience test with partial counts, a CONCLUDED hook test that produces a linked
 * PROPOSED decision and a decision memory entry (loop closed), and a CONCLUDED
 * thin-sample test that records a memory entry with no verdict.
 *
 * @param {Object} ws - Workspace fixture used for seeding.
 * @param {string} ws.key - Deterministic key for id generation.
 * @param {string} ws.currency - Currency code used for minor-unit conversions.
 */
async function seedPhase4(ws) {
  // Apparel only: the Testing OS — a weekly agenda in flight plus a
  // visibly CLOSED loop.
  //  • PROPOSED HOOK test (awaiting launch).
  //  • RUNNING AUDIENCE test with partial counts (being watched).
  //  • CONCLUDED HOOK test → confident winner → a linked PROPOSED REFRESH
  //    Decision + a first-class DecisionMemoryEntry (the loop, closed).
  //  • CONCLUDED thin-sample test → memory written, NO verdict (honesty).
  const workspaceId = det(`ws:${ws.key}`);
  const adSetId = det(`adset:${ws.key}:Carousel · 5 SKUs`);

  // Upsert a test + its variants. `decision`/`memory` optional (loop-closed).
  async function upsertTest(key, test, variants) {
    const id = det(`p4test:${ws.key}:${key}`);
    const data = { workspaceId, entityId: adSetId, entityLevel: 'ADSET', currency: ws.currency, ...test };
    await prisma.testExperiment.upsert({ where: { id }, create: { id, ...data }, update: data });
    for (const v of variants) {
      const vid = det(`p4var:${ws.key}:${key}:${v.label}`);
      const vdata = { testId: id, ...v };
      await prisma.testVariant.upsert({ where: { id: vid }, create: { id: vid, ...vdata }, update: vdata });
    }
    return id;
  }

  // (a) PROPOSED — Hook A vs B, awaiting launch.
  await upsertTest('hook-proposed', {
    dimension: 'HOOK', metric: 'CTR', priority: 2.4, status: 'PROPOSED',
    hypothesis: 'A sharper first-frame hook will lift CTR on "Carousel · 5 SKUs".',
    expectedSignal: 'CTR rises within 3–4 days at similar or lower CPM.',
  }, [
    { label: 'A', description: 'Current hook (control)',                 isControl: true  },
    { label: 'B', description: 'Sharper first-frame hook / opening line', isControl: false },
  ]);

  // (b) RUNNING — broad vs lookalike audience, partial data in.
  await upsertTest('audience-running', {
    dimension: 'AUDIENCE', metric: 'CPA', priority: 1.8, status: 'RUNNING', startedAt: DATE,
    hypothesis: 'A fresher audience will lower CPA by breaking saturation.',
    expectedSignal: 'CPA falls and frequency resets on the new audience.',
  }, [
    { label: 'A', description: 'Current audience (control)', isControl: true,
      impressions: 120000, clicks: 1800, conversions: 60, spendMinor: toMinor(2400, ws.currency), revenueMinor: toMinor(6000, ws.currency) },
    { label: 'B', description: 'Broad / advantage+',         isControl: false,
      impressions: 110000, clicks: 1760, conversions: 72, spendMinor: toMinor(2300, ws.currency), revenueMinor: toMinor(7200, ws.currency) },
  ]);

  // (c) CONCLUDED — Hook B beat A by ~22% CTR, MODERATE confidence →
  //     a linked PROPOSED REFRESH Decision + first-class memory (loop closed).
  const concludedDecisionId = det(`decision:${ws.key}:hook-win`);
  await prisma.decision.upsert({
    where: { id: concludedDecisionId },
    create: {
      id: concludedDecisionId, workspaceId, entityId: adSetId, entityLevel: 'ADSET',
      verdict: 'REFRESH', confidence: 0.9,
      diagnosis: 'Hook B beat Hook A by 22.2% CTR (1.83% vs 1.5%), moderate confidence.',
      rootCause: `test:${det(`p4test:${ws.key}:hook-concluded`)}`, status: 'PROPOSED',
    },
    update: {},
  });
  await upsertTest('hook-concluded', {
    dimension: 'HOOK', metric: 'CTR', priority: 2.1, status: 'CONCLUDED',
    hypothesis: 'A sharper first-frame hook will lift CTR.',
    expectedSignal: 'CTR rises within 3–4 days at similar or lower CPM.',
    startedAt: new Date(DATE.getTime() - 10 * 86_400_000), concludedAt: DATE,
    winnerLabel: 'B', lift: 22.2, confidence: 0.9, confidenceLabel: 'MODERATE',
    sampleNote: '60,000 impressions on the smaller arm.', decisionId: concludedDecisionId,
  }, [
    { label: 'A', description: 'Current hook (control)', isControl: true,
      impressions: 60000, clicks: 900, conversions: 36, spendMinor: toMinor(1500, ws.currency), revenueMinor: toMinor(3600, ws.currency) },
    { label: 'B', description: 'Sharper first-frame hook', isControl: false, isWinner: true,
      impressions: 60000, clicks: 1100, conversions: 50, spendMinor: toMinor(1500, ws.currency), revenueMinor: toMinor(5200, ws.currency) },
  ]);
  const winMemoryId = det(`memory:${ws.key}:hook-win`);
  await prisma.decisionMemoryEntry.upsert({
    where: { id: winMemoryId },
    create: {
      id: winMemoryId, workspaceId, decisionId: concludedDecisionId, entityId: adSetId,
      actionType: 'test:HOOK',
      rationale: 'Hook B beat Hook A by 22.2% CTR (1.83% vs 1.5%), moderate confidence.',
      isSustainable: true,
    },
    update: {},
  });

  // (d) CONCLUDED thin sample — memory written, NO verdict (honesty).
  await upsertTest('angle-thin', {
    dimension: 'CREATIVE_ANGLE', metric: 'CTR', priority: 0.9, status: 'CONCLUDED',
    hypothesis: 'A UGC, problem-led angle will re-engage the audience.',
    expectedSignal: 'CTR recovers as a new angle resets attention.',
    startedAt: new Date(DATE.getTime() - 4 * 86_400_000), concludedAt: DATE,
    winnerLabel: null, lift: 0, confidence: 0, confidenceLabel: 'INCONCLUSIVE',
    sampleNote: 'Only 320 impressions on the smaller arm — too thin to call (need 1000).',
  }, [
    { label: 'A', description: 'Current angle (control)',    isControl: true,  impressions: 340, clicks: 5 },
    { label: 'B', description: 'UGC, problem-led re-framing', isControl: false, impressions: 320, clicks: 7 },
  ]);
  const thinMemoryId = det(`memory:${ws.key}:angle-thin`);
  await prisma.decisionMemoryEntry.upsert({
    where: { id: thinMemoryId },
    create: {
      id: thinMemoryId, workspaceId, decisionId: null, entityId: adSetId,
      actionType: 'test:CREATIVE_ANGLE',
      rationale: 'No variant beat the control on CTR at a callable sample — inconclusive.',
      isSustainable: null,
    },
    update: {},
  });
}

/**
 * Seed the database with deterministic fixtures, metric snapshots, decision graph data, guardrails, fatigue predictions, allocation plans, and testing OS records.
 *
 * Runs workspace seeding for all fixtures, then executes Phase 1–4 pipelines (decision graph, guardrails/fatigue, portfolio reconciliation, and testing) for the apparel workspace to create idempotent upserts of entities and metric snapshots.
 */
async function seedPhase5(ws) {
  // Apparel only: the Memory Moat — what Lumi has learned about this account.
  //  • An ESTABLISHED, high-accuracy fatigue ceiling (promotable, un-promoted).
  //  • An EMERGING scaling window (thin support — not yet promotable).
  //  • An informational creative-angle learning (no executable spec).
  //  • A CONFLICTED pair on the same audience (honest "review" state).
  //  • A small PatternObservation audit trail proving "was Lumi right?".
  //  • cohortTag set, networkConsent OFF — the network stays dark (honest cold start).
  const workspaceId = det(`ws:${ws.key}`);
  const day = (n) => new Date(DATE.getTime() - n * 86_400_000);

  await prisma.workspace.update({
    where: { id: workspaceId },
    data:  { cohortTag: 'EG-apparel', networkConsent: false, consentedAt: null },
  });

  async function pattern(key, data) {
    const id = det(`p5pat:${ws.key}:${key}`);
    const row = { workspaceId, patternKey: key, firstObservedAt: day(60), lastObservedAt: day(5), ...data };
    await prisma.accountPattern.upsert({ where: { id }, create: { id, ...row }, update: row });
    return id;
  }

  // 1. ESTABLISHED + promotable fatigue ceiling.
  const fatigueId = await pattern('FATIGUE|ADSET|cold|KILL', {
    kind: 'FATIGUE_CEILING',
    statement: 'On cold adsets, KILL once frequency passes ~3.5 (5× seen, right 85%).',
    basis: 'weighted-median frequency at KILL across 5 decisions',
    support: 5, effectiveSupport: 4.5, accuracy: 0.85, confidence: 0.8, status: 'ESTABLISHED',
    metric: 'frequency', scopeLevel: 'ADSET', audienceTag: 'cold',
    comparator: 'GTE', threshold: 3.5, unit: 'RATIO', emitVerdict: 'KILL', sustainedDays: 1,
  });
  // its accuracy audit trail
  const obs = [
    { occurrenceKey: 'p5obs-1', predicted: 'KILL', actual: 'sustained', correct: true,  observedAt: day(40) },
    { occurrenceKey: 'p5obs-2', predicted: 'KILL', actual: 'sustained', correct: true,  observedAt: day(28) },
    { occurrenceKey: 'p5obs-3', predicted: 'KILL', actual: 'regressed', correct: false, observedAt: day(18) },
    { occurrenceKey: 'p5obs-4', predicted: 'KILL', actual: 'sustained', correct: true,  observedAt: day(9) },
  ];
  for (const o of obs) {
    const id = det(`p5obs:${ws.key}:${o.occurrenceKey}`);
    const row = { workspaceId, patternId: fatigueId, entityId: det(`adset:${ws.key}:Carousel · 5 SKUs`), ...o };
    await prisma.patternObservation.upsert({ where: { id }, create: { id, ...row }, update: row });
  }

  // 2. EMERGING scaling window (thin support).
  await pattern('SCALING|CAMPAIGN|null', {
    kind: 'SCALING_WINDOW',
    statement: 'Scaling campaigns held when ROAS was ≥ 3.0 (2× seen, held 100%).',
    basis: 'ROAS floor where SCALE decisions sustained across 2 decisions',
    support: 2, effectiveSupport: 2.0, accuracy: 1.0, confidence: 0.66, status: 'EMERGING',
    metric: 'roas', scopeLevel: 'CAMPAIGN', audienceTag: null,
    comparator: 'GTE', threshold: 3.0, unit: 'RATIO', emitVerdict: 'SCALE', sustainedDays: 1,
  });

  // 3. Informational creative-angle longevity.
  await pattern('ANGLE|account', {
    kind: 'CREATIVE_ANGLE_LONGEVITY',
    statement: 'Hook / creative-angle tests produced a confident winner in 2 of 3 runs — keep refreshing the angle.',
    basis: 'concluded HOOK/CREATIVE_ANGLE tests with a called winner',
    support: 3, effectiveSupport: 3.0, accuracy: 0.66, confidence: 0.66, status: 'ESTABLISHED',
    metric: null, scopeLevel: null, audienceTag: null,
  });

  // 4. CONFLICTED pair on the SAME audience — opposite actions, honest "review".
  await pattern('FATIGUE|ADSET|warm|KILL', {
    kind: 'FATIGUE_CEILING',
    statement: 'On warm adsets, KILL once frequency passes ~4.0 (3× seen, right 70%).',
    basis: 'weighted-median frequency at KILL across 3 decisions',
    support: 3, effectiveSupport: 3.0, accuracy: 0.7, confidence: 0.7, status: 'CONFLICTED',
    metric: 'frequency', scopeLevel: 'ADSET', audienceTag: 'warm',
    comparator: 'GTE', threshold: 4.0, unit: 'RATIO', emitVerdict: 'KILL', sustainedDays: 1,
  });
  await pattern('FATIGUE|ADSET|warm|REFRESH', {
    kind: 'FATIGUE_CEILING',
    statement: 'On warm adsets, REFRESH once frequency passes ~4.2 (3× seen, right 70%).',
    basis: 'weighted-median frequency at REFRESH across 3 decisions',
    support: 3, effectiveSupport: 3.0, accuracy: 0.7, confidence: 0.7, status: 'CONFLICTED',
    metric: 'frequency', scopeLevel: 'ADSET', audienceTag: 'warm',
    comparator: 'GTE', threshold: 4.2, unit: 'RATIO', emitVerdict: 'REFRESH', sustainedDays: 1,
  });
}

async function main() {
  for (const ws of WORKSPACES) {
    await seedWorkspace(ws);
  }
  await seedDecisionGraph(WORKSPACES[0]); // apparel
  await seedPhase2(WORKSPACES[0]);        // apparel guardrails + fatigue prediction
  await seedPhase3(WORKSPACES[0]);        // apparel portfolio + blended truth + allocation plan
  await seedPhase4(WORKSPACES[0]);        // apparel testing OS — agenda + closed loop
  await seedPhase5(WORKSPACES[0]);        // apparel memory moat — learnings + conflicts
  console.log('✓ Seeded entity graph + metric snapshots + decision graph + guardrails + fatigue prediction + allocation + testing + memory.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
