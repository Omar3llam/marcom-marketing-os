// ============================================================
// C-02 — guardrail hit identity, against a real database
// ============================================================
// The unit tests prove the sweep INTENDS to deduplicate. They cannot prove that
// anything stops it when the intent is wrong, because a mocked `createMany`
// accepts whatever it is handed.
//
// What is being verified here is the half that lives in PostgreSQL:
//
//   · a second OPEN episode on the same (rule, entity) is REJECTED, by the
//     database, not by a query someone can later widen;
//   · closing an episode releases the key, so any number of CLOSED episodes on
//     that same pair coexist — which is what makes a returning breach a new
//     episode rather than a revival;
//   · legacy rows, which carry no identity at all, never participate in either.
//
// The last one is the reason this file exists rather than a comment. Deciding
// NOT to back-fill is only safe if the un-backfilled rows are genuinely inert,
// and "NULL is exempt from a unique index" is a claim about PostgreSQL that
// ought to be demonstrated on PostgreSQL.
//
// Skips when no migrated database is reachable (src/tests/dbProbe.js).
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import { openHitKey, legacyGuardrailScope, identifiedGuardrailScope } from './guardrailHitIdentity.js';
import { sweepGuardrails } from './GuardrailSweepService.js';

const DB_OK = await dbAvailable();

describe.skipIf(!DB_OK)('C-02 · guardrail hit identity on real rows', () => {
  const ws = randomUUID();
  const ruleId = randomUUID();
  const entityId = randomUUID();
  const otherEntity = randomUUID();

  /** A guardrail Decision as the sweep now writes one. */
  const hit = (over = {}) => prisma.decision.create({
    data: {
      workspaceId: ws,
      entityId,
      entityLevel: 'ADSET',
      verdict: 'WATCH',
      confidence: 0.9,
      diagnosis: 'Frequency ceiling: frequency > 3 for 2 day(s)',
      rootCause: 'guardrail:Frequency ceiling',
      status: 'PROPOSED',
      guardrailRuleId: ruleId,
      decisionClass: 'GUARDRAIL', // C-10 — what GuardrailSweepService declares
      openHitKey: openHitKey({ ruleId, entityId, entityLevel: 'ADSET' }),
      ...over,
    },
  });

  beforeAll(async () => {
    await prisma.workspace.create({ data: { id: ws, name: `c02-${ws.slice(0, 8)}` } });
  });

  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: ws } });
    await prisma.workspace.delete({ where: { id: ws } }).catch(() => {});
  });

  it('the key the module builds is the key the row carries', () => {
    expect(openHitKey({ ruleId: 'r', entityId: 'e', entityLevel: 'ADSET' })).toBe('r:e:ADSET');
    // Never a partial key. A pair that cannot be identified must not collapse
    // onto a shared value the unique index would then treat as one episode.
    expect(openHitKey({ ruleId: null, entityId: 'e', entityLevel: 'ADSET' })).toBeNull();
    expect(openHitKey({ ruleId: 'r', entityId: 'e' })).toBeNull();
  });

  it('REJECTS a second open episode on the same (rule, entity)', async () => {
    const first = await hit();
    expect(first.openHitKey).toBe(`${ruleId}:${entityId}:ADSET`);

    // This is the write the old sweep performed roughly 96 times a day.
    await expect(hit()).rejects.toMatchObject({ code: 'P2002' });

    const open = await prisma.decision.count({
      where: { workspaceId: ws, openHitKey: { not: null } },
    });
    expect(open).toBe(1);
  });

  it('closing releases the key, so the same breach can return as a NEW episode', async () => {
    await prisma.decision.updateMany({
      where: { workspaceId: ws, openHitKey: { not: null } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), openHitKey: null },
    });

    // A second episode on the identical pair now inserts, because the first no
    // longer holds the key. It is a new row: the closed one is untouched.
    const reopened = await hit();
    expect(reopened.status).toBe('PROPOSED');

    const rows = await prisma.decision.findMany({
      where: { workspaceId: ws, guardrailRuleId: ruleId },
      select: { id: true, status: true, openHitKey: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('RESOLVED');
    expect(rows[0].openHitKey).toBeNull();
    expect(rows[1].id).toBe(reopened.id);
  });

  it('any number of CLOSED episodes on one pair coexist', async () => {
    // The point of NULLing the key rather than deleting the row: history
    // accumulates while only one episode may be live.
    await prisma.decision.updateMany({
      where: { workspaceId: ws, openHitKey: { not: null } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), openHitKey: null },
    });
    await hit();
    await prisma.decision.updateMany({
      where: { workspaceId: ws, openHitKey: { not: null } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), openHitKey: null },
    });

    const closed = await prisma.decision.count({
      where: { workspaceId: ws, guardrailRuleId: ruleId, status: 'RESOLVED' },
    });
    expect(closed).toBe(3);
  });

  it('a different entity under the same rule is a separate episode', async () => {
    const a = await hit();
    const b = await hit({
      entityId: otherEntity,
      openHitKey: openHitKey({ ruleId, entityId: otherEntity, entityLevel: 'ADSET' }),
    });
    expect(a.openHitKey).not.toBe(b.openHitKey);

    const open = await prisma.decision.count({
      where: { workspaceId: ws, openHitKey: { not: null } },
    });
    expect(open).toBe(2);
  });

  it('legacy rows carry no identity, never collide, and are never counted open', async () => {
    // Exactly what the pre-C-02 sweep wrote: a mutable display name and nothing
    // else. Two of them, on the same rule and entity as the live episodes.
    //
    // C-10 — with the CLASS the migration's backfill gives them, and no
    // `guardrailRuleId`. That combination is what "legacy" now means, and it is
    // the whole point of the two conditions in `legacyGuardrailScope`: these
    // rows ARE guardrail rows (the backfill can say so from the prefix, with no
    // invention), and they have no stable rule identity (which cannot be
    // recovered, because resolving a mutable name to a rule today would
    // attribute a hit to a rule that may since have been renamed).
    const legacy = () => prisma.decision.create({
      data: {
        workspaceId: ws, entityId, entityLevel: 'ADSET', verdict: 'WATCH', confidence: 0.9,
        diagnosis: 'Frequency ceiling: frequency > 3 for 2 day(s)',
        rootCause: 'guardrail:Frequency ceiling', status: 'PROPOSED',
        decisionClass: 'GUARDRAIL',
      },
    });
    await legacy();
    await legacy();

    // They insert freely — NULL is exempt from the unique index, which is the
    // property the decision NOT to back-fill rests on.
    const legacyRows = await prisma.decision.findMany({
      where: { workspaceId: ws, ...legacyGuardrailScope() },
      select: { id: true, openHitKey: true, guardrailRuleId: true },
    });
    expect(legacyRows).toHaveLength(2);
    expect(legacyRows.every((r) => r.openHitKey === null && r.guardrailRuleId === null)).toBe(true);

    // And they are invisible to every identity-scoped read, so a rule that fired
    // before this migration opens a genuinely new episode on its next breach
    // rather than being deduplicated against a row nothing can identify.
    const identified = await prisma.decision.findMany({
      where: { workspaceId: ws, ...identifiedGuardrailScope() },
      select: { id: true },
    });
    expect(identified.every((r) => !legacyRows.some((l) => l.id === r.id))).toBe(true);
  });

  it('RESOLVED is a real value of DecisionStatus, not a string the code hopes for', async () => {
    const resolved = await prisma.decision.findFirst({
      where: { workspaceId: ws, status: 'RESOLVED' },
      select: { status: true },
    });
    expect(resolved?.status).toBe('RESOLVED');
  });
});

// ============================================================
// C-02 — the three-outcome law, driven through the real sweep
// ============================================================
// The suite above proves the CONSTRAINT. It writes rows with
// `prisma.decision.create`, which is not how production reaches this table.
//
// This one drives `sweepGuardrails` itself over real MetricSnapshot rows, so the
// thing under test is the law rather than the index:
//
//   1. BREACH        → one open episode, carrying its key
//   2. BREACH again  → no second open row; the database is what guarantees it
//   3. CLEAR         → the episode closes, releases its key, and a later breach
//                      opens a NEW one
//   4. ABSENT        → the pair is not judged, and the open episode is UNTOUCHED
//
// Case 4 is the reason this file is not optional. It is the only one that proves
// "we did not look" never becomes "the problem went away", and it cannot be
// demonstrated by a mock: a mocked findMany returns whatever the test hands it,
// so the assertion would be about the fixture rather than about the sweep.
describe.skipIf(!DB_OK)('C-02 · the three-outcome law on real rows', () => {
  const ws = randomUUID();
  const accountId = randomUUID();
  const campaignId = randomUUID();
  const adSetId = randomUUID();
  let ruleId;

  // Two days above the ceiling sustains the rule; two days below declines it.
  const observe = (frequency, dayOffsets = [2, 1]) => Promise.all(dayOffsets.map((d) =>
    prisma.metricSnapshot.create({
      data: {
        workspaceId: ws, entityId: adSetId, entityLevel: 'ADSET',
        date: new Date(Date.now() - d * 86_400_000),
        source: 'META', granularity: 'DAILY',
        // The operational population — the only one this sweep may read.
        measurementWindow: 'ROLLING_WINDOW',
        currency: 'EGP', frequency,
      },
    })));

  const clearSnapshots = () => prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
  const openEpisodes = () => prisma.decision.findMany({
    where: { workspaceId: ws, openHitKey: { not: null } },
    select: { id: true, status: true, openHitKey: true },
  });

  beforeAll(async () => {
    await prisma.workspace.create({ data: { id: ws, name: `c02-law-${ws.slice(0, 8)}` } });
    await prisma.account.create({
      data: { id: accountId, workspaceId: ws, channel: 'META', name: 'c02', externalId: `act_${ws.slice(0, 8)}` },
    });
    await prisma.campaign.create({
      data: { id: campaignId, workspaceId: ws, accountId, channel: 'META', name: 'c02 campaign', externalId: `c_${ws.slice(0, 8)}` },
    });
    await prisma.adSet.create({
      data: { id: adSetId, workspaceId: ws, campaignId, channel: 'META', name: 'c02 ad set', externalId: `as_${ws.slice(0, 8)}` },
    });
    const rule = await prisma.guardrailRule.create({
      data: {
        workspaceId: ws, name: 'Frequency ceiling', enabled: true, scopeLevel: 'ADSET',
        metric: 'frequency', comparator: 'GT', threshold: 3.0, unit: 'RATIO',
        sustainedDays: 2, emitVerdict: 'WATCH',
      },
    });
    ruleId = rule.id;
  });

  afterAll(async () => {
    await prisma.decision.deleteMany({ where: { workspaceId: ws } });
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
    await prisma.guardrailRule.deleteMany({ where: { workspaceId: ws } });
    await prisma.adSet.deleteMany({ where: { workspaceId: ws } });
    await prisma.campaign.deleteMany({ where: { workspaceId: ws } });
    await prisma.account.deleteMany({ where: { workspaceId: ws } });
    await prisma.workspace.delete({ where: { id: ws } }).catch(() => {});
  });

  it('1 · BREACH opens exactly one episode, carrying its key', async () => {
    await observe(4.5);
    const out = await sweepGuardrails(ws);

    expect(out.hits).toBe(1);
    expect(out.decisionsCreated).toBe(1);

    const open = await openEpisodes();
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe('PROPOSED');
    expect(open[0].openHitKey).toBe(openHitKey({ ruleId, entityId: adSetId, entityLevel: 'ADSET' }));
  });

  it('2 · the same breach on a second sweep opens nothing', async () => {
    // Identical evidence, identical pair. Before C-02 this produced a second
    // indistinguishable row, and roughly 96 a day on the 15-minute cron.
    const out = await sweepGuardrails(ws);

    expect(out.hits).toBe(1);          // the breach is real and still there
    expect(out.decisionsCreated).toBe(0);
    expect(out.episodesClosed).toBe(0);
    expect(await openEpisodes()).toHaveLength(1);
  });

  it('3 · CLEAR closes the episode, releases the key, and a later breach opens a NEW one', async () => {
    await clearSnapshots();
    await observe(1.0);                // in scope, judged, and declining

    const closing = await sweepGuardrails(ws);
    expect(closing.hits).toBe(0);
    expect(closing.episodesClosed).toBe(1);
    expect(await openEpisodes()).toHaveLength(0);

    const [closed] = await prisma.decision.findMany({
      where: { workspaceId: ws, guardrailRuleId: ruleId },
      select: { status: true, openHitKey: true, resolution: true, resolvedAt: true },
    });
    expect(closed.status).toBe('RESOLVED');
    expect(closed.openHitKey).toBeNull();
    // On the real row, not just in the write payload: closure left `resolution`
    // NULL, so this decision stays outside decisionLearning's population.
    expect(closed.resolution).toBeNull();
    expect(closed.resolvedAt).toBeInstanceOf(Date);

    // The breach returns. This must be a new episode, not a revived one.
    await clearSnapshots();
    await observe(5.0);
    const reopening = await sweepGuardrails(ws);
    expect(reopening.decisionsCreated).toBe(1);

    const all = await prisma.decision.count({ where: { workspaceId: ws, guardrailRuleId: ruleId } });
    expect(all).toBe(2);
    expect(await openEpisodes()).toHaveLength(1);
  });

  it('4 · a pair the sweep did not judge is left ALONE — disabling a rule closes nothing', async () => {
    // The breach is still in the data; only the rule is switched off. Every pair
    // vanishes from `evaluated`, so there is nothing to close.
    const before = await openEpisodes();
    expect(before).toHaveLength(1);

    await prisma.guardrailRule.update({ where: { id: ruleId }, data: { enabled: false } });
    const out = await sweepGuardrails(ws);

    expect(out).toEqual({ rules: 0, hits: 0, decisionsCreated: 0, episodesClosed: 0 });
    expect(await openEpisodes()).toEqual(before);

    await prisma.guardrailRule.update({ where: { id: ruleId }, data: { enabled: true } });
  });

  it('4b · an entity that fell out of the sync window is left ALONE', async () => {
    // The rule is live and the episode is open; the evidence simply stopped
    // arriving. Closing here would end an episode because ingestion lapsed.
    const before = await openEpisodes();
    expect(before).toHaveLength(1);

    await clearSnapshots();
    const out = await sweepGuardrails(ws);

    expect(out.hits).toBe(0);
    expect(out.episodesClosed).toBe(0);
    expect(await openEpisodes()).toEqual(before);
  });

  it('4c · too little history to sustain is left ALONE', async () => {
    // One day against sustainedDays: 2 — in scope, but not enough to say either
    // way. Insufficient data is not an all-clear.
    const before = await openEpisodes();
    await clearSnapshots();
    await observe(1.0, [1]);           // a single calm day

    const out = await sweepGuardrails(ws);

    expect(out.episodesClosed).toBe(0);
    expect(await openEpisodes()).toEqual(before);
  });
});
