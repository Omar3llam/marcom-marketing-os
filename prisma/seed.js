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

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { toMinor } from '../src/lib/money.js';
import { getBlendedTruth } from '../src/services/blended-truth/BlendedTruthService.js';
import { buildNarrativeInputs } from '../src/services/narrative-engine/NarrativeService.js';
import { composeNarrative } from '../src/services/narrative-engine/narrativeEngine.js';

// Re-use the shared Prisma singleton (NOT a fresh PrismaClient) so this file is
// safely importable by the admin demo route without opening a second pool. The
// `main()` block at the bottom only runs when executed directly.

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

async function seedPhase6(ws) {
  // Apparel only: the Planning OS — a built next-quarter plan.
  //  • An AccountEconomics row (AOV / margin / repeat) so scenarios can speak
  //    revenue + gross profit, and economics can judge sustainability.
  //  • A NorthStarGoal ("blended CAC ≤ X at Y spend") — lagging trend on
  //    track, but ACTIVE plan flags a leading fatigue risk.
  //  • One DRAFT Plan carrying a channel-mix snapshot, BOTH a reallocation
  //    and a budget-expansion scenario projection-as-range, and a
  //    memoryBasis referencing the seeded Phase-5 patterns.
  const workspaceId = det(`ws:${ws.key}`);
  const minor = (major) => Math.round(major * 100); // EGP, 2 minor digits

  // 1. AccountEconomics (strategist-set, editable).
  const econId = det(`p6econ:${ws.key}`);
  const econ = {
    workspaceId, currency: ws.currency,
    aovMinor: minor(1_800), grossMarginPct: 0.55, repeatRate: 0.4,
    avgOrdersPerCustomer: 1.8, targetLtvToCac: 3,
  };
  await prisma.accountEconomics.upsert({ where: { id: econId }, create: { id: econId, ...econ }, update: econ });

  // 2. The DRAFT Plan — projections-as-ranges + memoryBasis ("Powered by Memory").
  const periodStart = new Date('2026-07-01T00:00:00.000Z');
  const periodEnd   = new Date('2026-09-30T00:00:00.000Z');
  const planId = det(`p6plan:${ws.key}`);
  const memoryBasis = [
    { patternId: det(`p5pat:${ws.key}:FATIGUE|ADSET|cold|KILL`), kind: 'FATIGUE_CEILING', statement: 'KILL cold adsets past frequency ~3.5.', accuracy: 0.85 },
    { patternId: det(`p5pat:${ws.key}:SCALING|CAMPAIGN|null`),    kind: 'SCALING_WINDOW',   statement: 'Scaling held when ROAS ≥ 3.0.',          accuracy: 1.0 },
  ];
  const projections = {
    scenario: {
      scenarioType: 'CHANNEL_REALLOCATION',
      projections: {
        blendedCacMinor:  { low: minor(385), expected: minor(420), high: minor(475) },
        volume:           { low: 1_980, expected: 2_180, high: 2_360 },
        revenueMinor:     { low: minor(356_000), expected: minor(392_000), high: minor(425_000) },
        grossProfitMinor: { low: minor(195_800), expected: minor(215_600), high: minor(233_750) },
        merAfter:         { low: 3.56, expected: 3.92, high: 4.25 },
      },
      assumptions: [
        'pessimistic: moved budget retains 70% of marginal efficiency',
        'expected: moved budget retains 85% of marginal efficiency',
        'optimistic: moved budget retains 100% of marginal efficiency',
        'memory accuracy 82% widened the band by ±9%',
      ],
      confidence: 0.74,
      basis: 'CHANNEL_REALLOCATION: projected as a range under 3 retention assumptions',
    },
    economics: {
      ltvToCac: { low: 3.07, expected: 4.24, high: 4.63 },
      sustainabilityBand: { low: 'HEALTHY', expected: 'HEALTHY', high: 'HEALTHY' },
      paybackOrders: 1, ltvMinor: minor(1_782), isDefault: false,
      assumptions: ['contribution margin = AOV × 55% gross margin', 'LTV = contribution × 1.8 lifetime orders/customer'],
    },
    goalLanding: {
      metric: 'blendedCac',
      trendBasedLandingEstimate: { low: minor(390), expected: minor(425), high: minor(460) },
      status: 'AT_RISK', laggingStatus: 'ON_TRACK', leadingRisk: true,
    },
  };
  const planRow = {
    workspaceId, name: 'Q3 — Scale within payback',
    periodStart, periodEnd, totalBudgetMinor: minor(100_000), currency: ws.currency, status: 'DRAFT',
    channelMix: [
      { channelId: 'meta',   channel: 'META',   currentSpendMinor: minor(60_000), recommendedSpendMinor: minor(48_000), deltaMinor: minor(-12_000), verdict: 'REALLOCATE' },
      { channelId: 'tiktok', channel: 'TIKTOK', currentSpendMinor: minor(10_000), recommendedSpendMinor: minor(22_000), deltaMinor: minor(12_000),  verdict: 'SCALE' },
      { channelId: 'google', channel: 'GOOGLE', currentSpendMinor: minor(30_000), recommendedSpendMinor: minor(30_000), deltaMinor: 0,              verdict: 'HOLD' },
    ],
    testingAgenda: [
      { entityId: det(`adset:${ws.key}:Carousel · 5 SKUs`), dimension: 'HOOK', name: 'UGC problem-led hook vs studio hero', hypothesis: 'Problem-led opener lifts 3-sec view-rate on cold TikTok.' },
    ],
    projections, memoryBasis,
  };
  await prisma.plan.upsert({ where: { id: planId }, create: { id: planId, ...planRow }, update: planRow });

  // 3. The NorthStarGoal linked to the plan.
  const goalId = det(`p6goal:${ws.key}`);
  const goal = {
    workspaceId, planId,
    name: 'Blended CAC ≤ EGP 450 at EGP 100k spend',
    metric: 'blendedCac', comparator: 'LTE', targetValue: minor(450), spendCeilingMinor: minor(100_000),
    currency: ws.currency, periodStart, periodEnd, status: 'AT_RISK',
  };
  await prisma.northStarGoal.upsert({ where: { id: goalId }, create: { id: goalId, ...goal }, update: goal });
}

async function seedPhase7(ws) {
  // Apparel only: the Measurement OS — Agency/Enterprise depth.
  //  • measurementTier ENTERPRISE (unlocks the gated surface).
  //  • ONE CONCLUDED IncrementalityTest on Meta with a real positive lift +
  //    a CI that excludes zero (so the causal column + DATA model light up).
  //  • PathTouch stays EMPTY — path attribution models honestly report
  //    INSUFFICIENT_DATA (no journey data, no invented credit).
  //  • Other workspaces stay NONE → honest gated/locked state.
  const workspaceId = det(`ws:${ws.key}`);
  const minor = (major) => Math.round(major * 100); // EGP

  // measurementTier unlocks the attribution surface; plan PRO unlocks the
  // feature-gated nav (Intelligence/Testing/Measurement) so the demo shows the
  // whole product, not a wall of locked items.
  await prisma.workspace.update({ where: { id: workspaceId }, data: { measurementTier: 'ENTERPRISE', plan: 'PRO' } });

  const testId = det(`p7inc:${ws.key}:META`);
  const row = {
    workspaceId,
    name: 'Meta conversion holdout — Q2',
    channel: 'META',
    entityId: det(`account:${ws.key}`),
    entityLevel: 'ACCOUNT',
    holdoutPct: 0.1,
    mde: 0.15,
    sampleSizePerArm: 8_400,
    durationDays: 21,
    guardrails: { minDurationDays: 7, maxDurationDays: 56, maxHoldoutShare: 0.25, stopIfSpendBreachPct: 0.2 },
    status: 'CONCLUDED',
    // exposed 2.4% vs holdout 2.0% → ~+18% incremental, CI excludes zero.
    exposedUsers: 84_000, exposedConversions: 2_016,
    holdoutUsers: 9_000,  holdoutConversions: 180,
    liftPct: 18.2, ciLow: 0.012, ciHigh: 0.024, confidenceLabel: 'HIGH',
    incrementalRevenueMinor: minor(61_500),
    startedAt: new Date(DATE.getTime() - 35 * 86_400_000),
    concludedAt: new Date(DATE.getTime() - 7 * 86_400_000),
  };
  await prisma.incrementalityTest.upsert({ where: { id: testId }, create: { id: testId, ...row }, update: row });
}

async function seedPhase8(ws) {
  // Apparel only: the Collaboration & Reporting OS.
  //  • Three role-bearing seats: STRATEGIST / BUYER / CLIENT (demo users).
  //  • ONE persisted WEEKLY LEADERSHIP StakeholderNarrative — composed from
  //    the REAL seeded rows (decisions+outcomes, blended truth, the concluded
  //    holdout, the north-star goal, the memory patterns). Every figure is
  //    evidence-bound, so the narrative carries zero hallucinated numbers.
  //  • The Phase-6 Plan gated behind a PENDING ApprovalRequest, with the
  //    CollaborationEvent audit trail (request).
  //  • Other workspaces seed no roles → null collabRole → STRATEGIST default.
  const workspaceId = det(`ws:${ws.key}`);
  const planId = det(`p6plan:${ws.key}`);

  // 1. Three demo seats with collaboration roles.
  const seats = [
    { role: 'STRATEGIST', email: `strategist@demo.${ws.key}.local` },
    { role: 'BUYER',      email: `buyer@demo.${ws.key}.local` },
    { role: 'CLIENT',     email: `client@demo.${ws.key}.local` },
  ];
  for (const s of seats) {
    const id = det(`p8user:${ws.key}:${s.role}`);
    const data = { workspaceId, email: s.email, role: 'VIEWER', collabRole: s.role };
    await prisma.user.upsert({ where: { id }, create: { id, ...data }, update: { collabRole: s.role } });
  }

  // 2. Compose a grounded LEADERSHIP narrative from the real seeded rows.
  const [decisions, blended, concludedTests, goals, patterns, accounts, campaigns, adSets] = await Promise.all([
    prisma.decision.findMany({ where: { workspaceId }, include: { outcomes: { orderBy: { createdAt: 'desc' }, take: 1 } }, take: 50 }),
    getBlendedTruth(workspaceId).catch(() => null),
    prisma.incrementalityTest.findMany({ where: { workspaceId, status: 'CONCLUDED' } }),
    prisma.northStarGoal.findMany({ where: { workspaceId } }),
    prisma.accountPattern.findMany({ where: { workspaceId }, select: { status: true } }),
    prisma.account.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.campaign.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.adSet.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ]);
  const labelsById = new Map([...accounts, ...campaigns, ...adSets].map((r) => [r.id, r.name]));

  const inputs = buildNarrativeInputs({
    decisions,
    allocationPlanIds: new Set(),
    blended, concludedTests, goals, patterns, labelsById,
    currency: ws.currency, measurementTier: 'ENTERPRISE',
  });
  const periodEnd = new Date(DATE);
  const periodStart = new Date(DATE.getTime() - 7 * 86_400_000);
  const narrative = composeNarrative({ period: 'WEEKLY', audience: 'LEADERSHIP', periodStart, periodEnd, ...inputs, now: DATE });

  const narrId = det(`p8narr:${ws.key}:WEEKLY:LEADERSHIP`);
  const narrRow = {
    workspaceId, period: 'WEEKLY', audience: 'LEADERSHIP', periodStart, periodEnd,
    headline: narrative.headline,
    body: { sections: narrative.sections },
    evidenceRefs: narrative.evidenceRefs,
    confidenceScore: narrative.reportConfidence.score,
    confidenceBasis: narrative.reportConfidence.components,
  };
  await prisma.stakeholderNarrative.upsert({ where: { id: narrId }, create: { id: narrId, ...narrRow }, update: narrRow });

  // 3. Gate the Phase-6 plan behind a PENDING approval (+ audit trail).
  const plan = await prisma.plan.findUnique({ where: { id: planId } }).catch(() => null);
  if (plan) {
    await prisma.plan.update({ where: { id: planId }, data: { requiresApproval: true, approvalState: 'PENDING' } });
    const reqId = det(`p8appr:${ws.key}:${planId}`);
    const reqRow = {
      workspaceId, planId, subjectType: 'PLAN', subjectId: planId,
      requestedById: det(`p8user:${ws.key}:STRATEGIST`), state: 'PENDING',
    };
    await prisma.approvalRequest.upsert({ where: { id: reqId }, create: { id: reqId, ...reqRow }, update: { state: 'PENDING' } });

    const evId = det(`p8evt:${ws.key}:APPROVAL_REQUESTED:${planId}`);
    const evRow = {
      workspaceId, actorId: det(`p8user:${ws.key}:STRATEGIST`), type: 'APPROVAL_REQUESTED',
      subjectType: 'PLAN', subjectId: planId, detail: { requestId: reqId, planId },
    };
    await prisma.collaborationEvent.upsert({ where: { id: evId }, create: { id: evId, ...evRow }, update: evRow });
  }
}

async function seedPhase9(ws) {
  // Apparel only: the Agentic OS — one recent SCHEDULED loop sweep showing a
  // visibly-CLOSED loop (every stage fresh, HEALTHY, nothing stale), so the
  // unified home + demo light up on "the loop is turning."
  const workspaceId = det(`ws:${ws.key}`);
  const runId = det(`p9loop:${ws.key}`);
  const stageStatus = [
    { stage: 'PLAN',     state: 'ACTIVE', lastAt: new Date(DATE.getTime() - 2 * 86_400_000).toISOString(), count: 1 },
    { stage: 'ALLOCATE', state: 'ACTIVE', lastAt: new Date(DATE.getTime() - 3 * 86_400_000).toISOString(), count: 1 },
    { stage: 'EXECUTE',  state: 'ACTIVE', lastAt: new Date(DATE.getTime() - 1 * 86_400_000).toISOString(), count: 2 },
    { stage: 'TEST',     state: 'ACTIVE', lastAt: new Date(DATE.getTime() - 2 * 86_400_000).toISOString(), count: 1 },
    { stage: 'MEASURE',  state: 'ACTIVE', lastAt: new Date(DATE.getTime() - 1 * 86_400_000).toISOString(), count: 1 },
    { stage: 'LEARN',    state: 'ACTIVE', lastAt: new Date(DATE.getTime() - 1 * 86_400_000).toISOString(), count: 1 },
  ];
  const row = {
    workspaceId,
    trigger: 'SCHEDULED',
    startedAt: new Date(DATE.getTime() - 30 * 60 * 1000),
    finishedAt: new Date(DATE.getTime() - 30 * 60 * 1000 + 4000),
    proposalsByType: { VERDICT: 2, TEST: 1, PLAN_ADJUSTMENT: 1 },
    stageStatus,
    summary: '4 to decide, 1 to steer.',
    closed: true,
    loopHealth: 'HEALTHY',
    staleStages: [],
  };
  await prisma.loopRun.upsert({ where: { id: runId }, create: { id: runId, ...row }, update: row });
}

// ── Reusable demo-workspace seeder ───────────────────────────
// Builds ONE fully-populated demo workspace: the apparel "Maison Salam" graph
// (entity tree + metric snapshots + the full Phase 2–9 fixtures). Two callers:
//   • `npm run seed` (main, below) → default deterministic key 'apparel', so
//     re-runs upsert in place and stay idempotent.
//   • the admin "spin up a demo" route → a UNIQUE key (e.g. `demo-<ts>`) so
//     every call mints a fresh, independent workspace, plus an explicit `name`
//     beginning "Demo —" (the delete-safety sentinel the admin route enforces).
// `client` is the shared Prisma singleton; the helper fns below reference that
// same module instance, so passing it is explicit, not vestigial.
export async function seedDemoWorkspace(client = prisma, options = {}) {
  const base = WORKSPACES[0]; // apparel — the only fully-built graph
  const key  = options.key  || base.key;
  const name = options.name || `${base.name}${options.nameSuffix || ''}`;
  const ws   = { ...base, key, name };

  await seedWorkspace(ws);
  await seedDecisionGraph(ws); // the Eid KILL verdict + outcome + memory
  await seedPhase2(ws);        // guardrails + fatigue prediction
  await seedPhase3(ws);        // portfolio + blended truth + allocation plan
  await seedPhase4(ws);        // testing OS — agenda + closed loop
  await seedPhase5(ws);        // memory moat — learnings + conflicts
  await seedPhase6(ws);        // planning OS — plan + scenario + north-star + economics
  await seedPhase7(ws);        // measurement OS — tier + concluded holdout (causal lift)
  await seedPhase8(ws);        // collaboration OS — roles + leadership narrative + pending approval
  await seedPhase9(ws);        // agentic OS — one recent CLOSED loop sweep

  return { workspaceId: det(`ws:${ws.key}`), name: ws.name };
}

async function main() {
  await seedDemoWorkspace(prisma);   // apparel "Maison Salam" — full 9-phase graph
  await seedWorkspace(WORKSPACES[1]); // riyadh — Layla & Co.   (entity graph only)
  await seedWorkspace(WORKSPACES[2]); // dubai  — Forge Studio  (entity graph only)
  console.log('✓ Seeded entity graph + metric snapshots + decision graph + guardrails + fatigue prediction + allocation + testing + memory + planning + measurement + collaboration + agentic loop.');
}

// Only auto-run when executed directly (`npm run seed`). When IMPORTED by the
// admin demo route, main() must NOT fire — and must NOT $disconnect the shared
// singleton out from under the running server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
