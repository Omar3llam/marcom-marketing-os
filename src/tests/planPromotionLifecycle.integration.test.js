// T1: actual PG17 parent locks, independent artifact counts and rollback.
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROMOTION_OUTCOME } from '@marcom/runtime-contracts';
import { dbAvailable } from '../tests/dbProbe.js';

vi.mock('../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../lib/prisma.js';
import { promotePlanMix } from '../services/planning/PlanService.js';
import { captureMixSnapshot } from '../services/planning/planPromotionSnapshot.js';

const DB_OK = await dbAvailable();
const NOW = new Date('2026-10-25T10:00:00Z');
const ACTOR = randomUUID();
const SECOND_ACTOR = randomUUID();
const evidence = (kind, data) => process.stdout.write(`${kind} ${JSON.stringify(data)}\n`);

describe.skipIf(!DB_OK)('T1 / isolated PG17 atomic Plan promotion', () => {
  let sql;
  const workspaces = [];

  async function fixture({ deltas = [200000, -200000], ...over } = {}) {
    const ws = await prisma.workspace.create({ data: { name: `T1-${randomUUID()}` } });
    workspaces.push(ws.id);
    const mix = {
      goal: { type: 'GROWTH_CEILING', value: null },
      spendPeriod: { status: 'MEASURABLE', reason: null, currency: 'USD', period: { start: '2026-10-01', end: '2026-10-31' } },
      totalBudgetMinor: 1000000, currency: 'USD', monetaryStatus: 'MONETARY_VALID', monetaryReason: null,
      efficiencyStatus: 'VALID', efficiencyReason: null,
      allocations: deltas.map((deltaMinor) => ({
        channelId: randomUUID(), channel: 'META', verdict: 'SCALE', currentSpendMinor: 500000,
        recommendedSpendMinor: 500000 + deltaMinor, deltaMinor, blendedRoas: 2, rationale: `Approved move ${deltaMinor}`,
      })),
      projected: { blendedRevenueMinor: 2000000, projectedCpaMinor: 3000, blendedRevenueEfficiencyBefore: 1.7, blendedRevenueEfficiencyAfter: 2 },
      reasoningTrail: ['Original approved October snapshot'],
    };
    const plan = await prisma.plan.create({ data: {
      workspaceId: ws.id, name: 'Approved mix', periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-31'),
      totalBudgetMinor: mix.totalBudgetMinor, currency: mix.currency, channelMix: mix.allocations,
      testingAgenda: [], memoryBasis: [], projections: { mix: captureMixSnapshot(mix) },
      requiresApproval: true, approvalState: 'APPROVED', ...over,
    } });
    return { ws: ws.id, plan, mix };
  }

  const current = (f) => prisma.plan.findFirst({ where: { id: f.plan.id, workspaceId: f.ws } });
  async function counts(f) {
    const [row] = await sql`SELECT
      (SELECT count(*)::int FROM allocation_plans WHERE "workspaceId" = ${f.ws}::uuid) AS allocations,
      (SELECT count(*)::int FROM decisions WHERE "workspaceId" = ${f.ws}::uuid) AS decisions`;
    return { allocations: row.allocations, decisions: row.decisions };
  }
  async function blocked(count = 1) {
    const deadline = Date.now() + 1800;
    do {
      const rows = await sql`SELECT pid, query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      const waiting = rows.filter((r) => /\bplans\b/.test(r.query) && r.blockers.length);
      if (waiting.length >= count) {
        evidence('T1_LOCK', { count: waiting.length, lockingReads: waiting.filter((r) => /FOR UPDATE/i.test(r.query)).length,
          waiters: waiting.map((r) => ({ pid: r.pid, blockers: r.blockers })) });
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    return false;
  }
  const promote = (f, options = {}) => promotePlanMix(f.ws, f.plan.id, { promotedById: ACTOR, now: NOW, ...options });

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL, { max: 3, onnotice: () => {} });
    const [row] = await sql`SELECT current_setting('server_version_num')::int AS version`;
    expect(row.version).toBeGreaterThanOrEqual(170000); expect(row.version).toBeLessThan(180000);
    evidence('T1_PG', row);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces.splice(0) } } });
  });
  afterAll(async () => { await sql?.end(); });

  for (const deltas of [[200000, -200000], [0, 0]]) {
    it(`two simultaneous promotions serialize (${deltas.join(',')}) without overwriting the winner`, async () => {
      const f = await fixture({ deltas });
      const secondTime = new Date(NOW.getTime() + 1000);
      let pending;
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM plans WHERE id = ${f.plan.id}::uuid AND "workspaceId" = ${f.ws}::uuid FOR UPDATE`;
        pending = Promise.allSettled([promote(f), promote(f, { promotedById: SECOND_ACTOR, now: secondTime })]);
        expect(await blocked(2)).toBe(true);
      });
      const settled = await pending;
      expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);
      const results = settled.map((r) => r.value);
      const expected = deltas.some(Boolean) ? PROMOTION_OUTCOME.PROMOTED : PROMOTION_OUTCOME.PROMOTED_WITH_NO_MOVES;
      const actualCounts = await counts(f);
      evidence('T1_CONCURRENT', { deltas, outcomes: results.map((r) => r.outcome), ...actualCounts });
      expect(results.map((r) => r.outcome).sort()).toEqual([expected, PROMOTION_OUTCOME.ALREADY_PROMOTED].sort());
      expect(actualCounts).toEqual(deltas.some(Boolean) ? { allocations: 1, decisions: 2 } : { allocations: 0, decisions: 0 });
      const winner = results.findIndex((r) => r.outcome === expected), frozen = await current(f);
      expect(frozen).toMatchObject({ status: 'ACTIVE', promotedBy: winner === 0 ? ACTOR : SECOND_ACTOR,
        promotedAt: winner === 0 ? NOW : secondTime, allocationPlanId: results[winner].allocationPlanId });
      expect(results[1 - winner]).toMatchObject({ decisionsCreated: 0, promotedAt: frozen.promotedAt, allocationPlanId: frozen.allocationPlanId });
    });
  }

  it('a sequential repeat preserves the original promotion and approved snapshot', async () => {
    const f = await fixture(), first = await promote(f), frozen = await current(f);
    // Repeat recognition precedes actor and snapshot eligibility, as before.
    const second = await promote(f, { promotedById: null, now: new Date(NOW.getTime() + 5000) });
    expect(second).toMatchObject({ outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, allocationPlanId: first.allocationPlanId, promotedAt: NOW, decisionsCreated: 0 });
    expect(await current(f)).toEqual(frozen);
    expect(frozen.channelMix).toEqual(f.plan.channelMix); expect(frozen.projections).toEqual(f.plan.projections);
    expect(await counts(f)).toEqual({ allocations: 1, decisions: 2 });
  });

  it('reads changed approval after acquiring the parent lock', async () => {
    const f = await fixture(); let pending;
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM plans WHERE id = ${f.plan.id}::uuid AND "workspaceId" = ${f.ws}::uuid FOR UPDATE`;
      pending = Promise.allSettled([promote(f)]);
      expect(await blocked()).toBe(true);
      await tx`UPDATE plans SET "approvalState" = 'PENDING' WHERE id = ${f.plan.id}::uuid AND "workspaceId" = ${f.ws}::uuid`;
    });
    const [result] = await pending, actualCounts = await counts(f);
    evidence('T1_APPROVAL_CHANGED', { outcome: result.status === 'fulfilled' ? result.value.outcome : result.reason.code, ...actualCounts });
    expect(result.status).toBe('rejected'); expect(result.reason).toMatchObject({ code: 'ApprovalRequired', approvalState: 'PENDING' });
    expect(await current(f)).toMatchObject({ approvalState: 'PENDING', status: 'DRAFT', promotedAt: null, allocationPlanId: null });
    expect(actualCounts).toEqual({ allocations: 0, decisions: 0 });
  });

  it('missing and foreign workspace requests cannot acquire the owned parent lock', async () => {
    const owner = await fixture(), foreign = await fixture(), before = await current(owner);
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM plans WHERE id = ${owner.plan.id}::uuid AND "workspaceId" = ${owner.ws}::uuid FOR UPDATE`;
      for (const id of [owner.plan.id, randomUUID()]) {
        await expect(promotePlanMix(foreign.ws, id, { promotedById: ACTOR })).rejects.toThrow('promotePlanMix: plan not found');
      }
    });
    expect(await current(owner)).toEqual(before);
    expect(await counts(owner)).toEqual({ allocations: 0, decisions: 0 });
    expect(await counts(foreign)).toEqual({ allocations: 0, decisions: 0 });
  });

  it('a final Plan write failure rolls back real AllocationPlan and Decision writes and permits retry', async () => {
    const f = await fixture(), before = await current(f), transaction = prisma.$transaction.bind(prisma);
    let reached = false;
    vi.spyOn(prisma, '$transaction').mockImplementationOnce((callback, options) => transaction(async (tx) => callback(new Proxy(tx, {
      get(target, key) {
        if (key === 'plan') return new Proxy(target.plan, { get(model, operation) {
          if (operation === 'update') return async () => {
            expect(await target.allocationPlan.count({ where: { workspaceId: f.ws } })).toBe(1);
            expect(await target.decision.count({ where: { workspaceId: f.ws } })).toBe(2);
            reached = true; throw new Error('T1 injected final Plan write failure');
          };
          return model[operation];
        } });
        return target[key];
      },
    })), options));
    await expect(promote(f)).rejects.toThrow('T1 injected final Plan write failure');
    expect(reached).toBe(true); expect(await current(f)).toEqual(before);
    const actualCounts = await counts(f);
    evidence('T1_ROLLBACK', { finalWriteReached: reached, ...actualCounts });
    expect(actualCounts).toEqual({ allocations: 0, decisions: 0 });
    vi.restoreAllMocks();
    expect((await promote(f)).outcome).toBe(PROMOTION_OUTCOME.PROMOTED);
    expect(await counts(f)).toEqual({ allocations: 1, decisions: 2 });
  });

  it('persists the approved monetary snapshot rather than computing a new mix', async () => {
    const f = await fixture(), result = await promote(f);
    const allocation = await prisma.allocationPlan.findUnique({ where: { id: result.allocationPlanId } });
    expect(allocation).toMatchObject({ workspaceId: f.ws, status: 'PROPOSED', totalBudgetMinor: f.mix.totalBudgetMinor,
      currency: f.mix.currency, projectedCpaMinor: f.mix.projected.projectedCpaMinor,
      blendedRevenueEfficiencyBefore: f.mix.projected.blendedRevenueEfficiencyBefore,
      blendedRevenueEfficiencyAfter: f.mix.projected.blendedRevenueEfficiencyAfter });
    expect(JSON.stringify(allocation.reasoning)).toContain(f.mix.reasoningTrail[0]);
    const decisions = await prisma.decision.findMany({ where: { workspaceId: f.ws } });
    expect(decisions.map((d) => d.entityId).sort()).toEqual(f.mix.allocations.map((a) => a.channelId).sort());
    for (const d of decisions) expect(d).toMatchObject({ status: 'PROPOSED', verdict: 'REALLOCATE', decisionClass: 'ALLOCATION', rootCause: `allocation:${allocation.id}` });
    expect((await current(f)).projections).toEqual(f.plan.projections);
  });

  it('preserves legacy allocationPlanId-based repeat recognition', async () => {
    const id = randomUUID(), f = await fixture({ allocationPlanId: id, promotedAt: null });
    const before = await current(f);
    expect(await promote(f, { promotedById: null })).toMatchObject({ outcome: PROMOTION_OUTCOME.ALREADY_PROMOTED, allocationPlanId: id, promotedAt: null, decisionsCreated: 0 });
    expect(await current(f)).toEqual(before); expect(await counts(f)).toEqual({ allocations: 0, decisions: 0 });
  });
});
