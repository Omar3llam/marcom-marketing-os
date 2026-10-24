// CP-03B: real PG17 locks and rollback; economics is a deterministic test input.
import express from 'express';
import request from 'supertest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbAvailable } from '../tests/dbProbe.js';

vi.mock('../services/unit-economics/EconomicsService.js', () => ({ getEconomics: vi.fn() }));
vi.mock('../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../lib/prisma.js';
import { getEconomics } from '../services/unit-economics/EconomicsService.js';
import { concludeIncrementality, recordCounts } from '../services/incrementality-engine/IncrementalityService.js';
import { readIncrementality } from '../services/incrementality-engine/incrementalityEngine.js';
import { measurementRouter } from '../routes/lumi/measurement.js';

const DB_OK = await dbAvailable();
const economics = () => ({ economics: { aovMinor: 5000, currency: 'USD' } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

describe.skipIf(!DB_OK)('CP-03B / isolated PostgreSQL Holdout lifecycle', () => {
  let sql;
  const workspaces = [];
  const observed = { exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250 };

  async function fixture(over = {}, { lineage = false } = {}) {
    const ws = await prisma.workspace.create({ data: { name: `CP03B-${randomUUID()}`, plan: 'PRO', measurementTier: 'AGENCY' } });
    workspaces.push(ws.id);
    const source = lineage ? await prisma.testExperiment.create({ data: {
      workspaceId: ws.id, dimension: 'HOOK', hypothesis: 'Synthetic source lineage', metric: 'CTR', expectedSignal: 'higher CTR', status: 'CONCLUDED',
    } }) : null;
    const test = await prisma.incrementalityTest.create({ data: {
      workspaceId: ws.id, entityId: randomUUID(), entityLevel: 'CAMPAIGN',
      name: 'Synthetic operator-reported holdout', channel: 'META', status: 'RUNNING',
      holdoutPct: 0.1, mde: 0.1, sampleSizePerArm: 1000, durationDays: 14,
      guardrails: { assumptions: ['Synthetic design; randomization has not been independently verified.'] },
      sourceTestId: source?.id ?? null, startedAt: new Date('2026-01-01T00:00:00Z'), ...observed, ...over,
    } });
    return { ws: ws.id, test };
  }
  const current = (f) => prisma.incrementalityTest.findFirst({ where: { id: f.test.id, workspaceId: f.ws } });
  async function outputs(f) {
    return {
      decisions: await prisma.decision.count({ where: { workspaceId: f.ws, rootCause: `incrementality:${f.test.id}` } }),
      memory: await prisma.decisionMemoryEntry.count({ where: { workspaceId: f.ws, actionType: 'incrementality:META' } }),
    };
  }
  function app(f, role = 'STRATEGIST') {
    const server = express(); server.use(express.json());
    // Authenticated mount seam; real plan, measurement-tier and role gates run.
    server.use((req, _res, next) => { req.workspaceId = f.ws; req.collabRole = role; next(); });
    server.use(measurementRouter); return server;
  }
  async function blocked(count = 1, { lockingRead = false } = {}) {
    const deadline = Date.now() + 1800;
    do {
      const rows = await sql`SELECT pid, pg_blocking_pids(pid) AS blockers, query
        FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      const waiting = rows.filter((r) => r.query.includes('incrementality_tests') && r.blockers.length && (!lockingRead || /FOR UPDATE/i.test(r.query)));
      if (waiting.length >= count) {
        console.log('CP03B_LOCK', JSON.stringify({ count: waiting.length, readLocks: waiting.filter((r) => /FOR UPDATE/i.test(r.query)).length, waiters: waiting.map((r) => ({ pid: r.pid, blockers: r.blockers })) }));
        return true;
      }
      await new Promise((r) => setTimeout(r, 10));
    } while (Date.now() < deadline);
    return false;
  }

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL, { max: 3, onnotice: () => {} });
    const [row] = await sql`SELECT current_setting('server_version_num')::int AS version`;
    expect(row.version).toBeGreaterThanOrEqual(170000); expect(row.version).toBeLessThan(180000);
    console.log('CP03B_PG', JSON.stringify(row));
  });
  beforeEach(() => { vi.clearAllMocks(); getEconomics.mockReset().mockResolvedValue(economics()); });
  afterEach(async () => { vi.restoreAllMocks(); await prisma.workspace.deleteMany({ where: { id: { in: workspaces.splice(0) } } }); });
  afterAll(async () => { await sql?.end(); });

  it('a repeated HTTP conclusion returns 409 with one frozen result, Memory and PROPOSED Decision', async () => {
    const f = await fixture({}, { lineage: true });
    const first = await request(app(f)).post(`/incrementality/${f.test.id}/conclude`);
    expect(first.status).toBe(201);
    const frozen = await current(f);
    const second = await request(app(f)).post(`/incrementality/${f.test.id}/conclude`);
    const counts = await outputs(f);
    console.log('CP03B_REPEAT', JSON.stringify({ status: second.status, economicsReads: getEconomics.mock.calls.length, ...counts }));
    expect(second.status).toBe(409);
    expect(await current(f)).toEqual(frozen);
    expect(getEconomics).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({ decisions: 1, memory: 1 });
    expect(frozen.sourceTestId).toBe(f.test.sourceTestId);
    expect(frozen.guardrails).toEqual(f.test.guardrails);
    const decision = await prisma.decision.findUnique({ where: { id: frozen.decisionId } });
    expect(decision).toMatchObject({ status: 'PROPOSED', decisionClass: 'EXPERIMENT', workspaceId: f.ws });
    const memory = await prisma.decisionMemoryEntry.findFirst({ where: { workspaceId: f.ws } });
    expect(memory.rationale).toMatch(/operator-reported.*not independently verified/i);
    expect(first.body.readout.rationale).toMatch(/operator-reported.*not independently verified/i);
    expect(first.body.readout.monetary.reason).toBe('INCREMENTALITY_MONETARY_BASIS_UNPROVEN');
  });

  it('two actual concurrent HTTP conclusions return one 201 and one 409', async () => {
    const f = await fixture(); let pending;
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM incrementality_tests WHERE id = ${f.test.id}::uuid AND "workspaceId" = ${f.ws}::uuid FOR UPDATE`;
      pending = Promise.all([request(app(f)).post(`/incrementality/${f.test.id}/conclude`), request(app(f)).post(`/incrementality/${f.test.id}/conclude`)]);
      expect(await blocked(2)).toBe(true);
    });
    const responses = await pending, counts = await outputs(f);
    console.log('CP03B_CONCURRENT', JSON.stringify({ statuses: responses.map((r) => r.status), ...counts }));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(counts).toEqual({ decisions: 1, memory: 1 });
  });

  it('a counts writer queued first commits before the conclusion reads authoritative counts', async () => {
    const f = await fixture(); let metrics, conclusion;
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM incrementality_tests WHERE id = ${f.test.id}::uuid AND "workspaceId" = ${f.ws}::uuid FOR UPDATE`;
      metrics = recordCounts(f.ws, f.test.id, { ...observed, exposedConversions: 600 });
      expect(await blocked()).toBe(true);
      conclusion = concludeIncrementality(f.ws, f.test.id);
      expect(await blocked(2)).toBe(true);
    });
    await metrics; const result = await conclusion, frozen = await current(f);
    const authoritative = readIncrementality({ exposed: { users: frozen.exposedUsers, conversions: frozen.exposedConversions }, holdout: { users: frozen.holdoutUsers, conversions: frozen.holdoutConversions }, aovMinor: 5000 });
    console.log('CP03B_COUNTS_FIRST', JSON.stringify({ storedLift: frozen.liftPct, evidenceLift: authoritative.liftPct, exposedConversions: frozen.exposedConversions }));
    expect(frozen.exposedConversions).toBe(600);
    expect(frozen.liftPct).toBe(authoritative.liftPct);
    expect(frozen.ciLow).toBe(authoritative.ci[0]); expect(frozen.ciHigh).toBe(authoritative.ci[1]);
    expect(result.readout.liftPct).toBe(authoritative.liftPct);
  });

  it('a conclusion queued first freezes counts and the later writer conflicts', async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    getEconomics.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return economics(); });
    const conclusion = concludeIncrementality(f.ws, f.test.id); await entered.promise;
    const metrics = recordCounts(f.ws, f.test.id, { ...observed, exposedConversions: 100 });
    const settled = Promise.allSettled([conclusion, metrics]); let locked;
    try { locked = await blocked(1, { lockingRead: true }); } finally { release.resolve(); }
    const results = await settled, frozen = await current(f);
    console.log('CP03B_CONCLUSION_FIRST', JSON.stringify({ locked, outcomes: results.map((r) => r.status === 'fulfilled' ? 'COMMITTED' : r.reason.code), exposedConversions: frozen.exposedConversions }));
    expect(locked).toBe(true);
    expect(results[0].status).toBe('fulfilled'); expect(results[1].reason).toMatchObject({ code: 'HOLDOUT_CONFLICT' });
    expect(frozen.exposedConversions).toBe(300);
    expect(frozen.liftPct).toBeCloseTo(20);
  });

  for (const status of ['DESIGNED', 'ABANDONED']) {
    it(`refuses a ${status} holdout with populated counts before economics or writes`, async () => {
      const f = await fixture({ status }), before = await current(f);
      expect((await request(app(f)).post(`/incrementality/${f.test.id}/conclude`)).status).toBe(409);
      expect(await current(f)).toEqual(before); expect(getEconomics).not.toHaveBeenCalled();
      expect(await outputs(f)).toEqual({ decisions: 0, memory: 0 });
    });
  }

  it('terminal CONCLUDED and ABANDONED metrics return 409 and preserve frozen evidence', async () => {
    const f = await fixture(); await concludeIncrementality(f.ws, f.test.id);
    const abandoned = await fixture({ status: 'ABANDONED' });
    for (const target of [f, abandoned]) {
      const frozen = await current(target);
      const res = await request(app(target)).post(`/incrementality/${target.test.id}/metrics`).send({ ...observed, exposedConversions: 1 });
      expect(res.status).toBe(409); expect(await current(target)).toEqual(frozen);
    }
  });

  it('missing and foreign IDs return 404 and cannot acquire another tenant row lock', async () => {
    const owner = await fixture(), foreign = await fixture(), before = await current(owner);
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM incrementality_tests WHERE id = ${owner.test.id}::uuid AND "workspaceId" = ${owner.ws}::uuid FOR UPDATE`;
      for (const action of ['metrics', 'conclude']) {
        for (const id of [owner.test.id, randomUUID()]) {
          const res = await request(app(foreign)).post(`/incrementality/${id}/${action}`).send(observed);
          expect(res.status).toBe(404); expect(res.body.error).toBe('HoldoutNotFound');
        }
      }
    });
    expect(await current(owner)).toEqual(before); expect(getEconomics).not.toHaveBeenCalled();
    expect(await outputs(owner)).toEqual({ decisions: 0, memory: 0 });
  });

  it('int4-overflow HTTP input refuses as 400 without changing counts', async () => {
    const f = await fixture(), before = await current(f);
    const res = await request(app(f)).post(`/incrementality/${f.test.id}/metrics`).send({ ...observed, exposedUsers: 2147483648 });
    expect(res.status).toBe(400); expect(res.body.error).toBe('BadCounts'); expect(await current(f)).toEqual(before);
  });

  it('invalid stored counts refuse before conclusion and leave no artifacts', async () => {
    const f = await fixture({ exposedConversions: -1 }), before = await current(f);
    expect((await request(app(f)).post(`/incrementality/${f.test.id}/conclude`)).status).toBe(400);
    expect(await current(f)).toEqual(before); expect(await outputs(f)).toEqual({ decisions: 0, memory: 0 });
  });

  it('RUNNING without observed user counts retains the existing NoObservedCounts 409', async () => {
    const f = await fixture({ exposedUsers: 0, exposedConversions: 0, holdoutUsers: 0, holdoutConversions: 0 });
    const res = await request(app(f)).post(`/incrementality/${f.test.id}/conclude`);
    expect(res.status).toBe(409); expect(res.body.error).toBe('NoObservedCounts');
    expect(await outputs(f)).toEqual({ decisions: 0, memory: 0 });
  });

  it('real transaction rollback removes Decision, Memory and result after final-write failure', async () => {
    const f = await fixture(), before = await current(f);
    const transaction = prisma.$transaction.bind(prisma); let finalWriteReached = false;
    vi.spyOn(prisma, '$transaction').mockImplementationOnce((callback, options) => transaction(async (tx) => callback(new Proxy(tx, {
      get(target, key) {
        if (key === 'decisionMemoryEntry') return { create: async () => { finalWriteReached = true; throw new Error('CP03B injected Memory failure'); } };
        return target[key];
      },
    })), options));
    await expect(concludeIncrementality(f.ws, f.test.id)).rejects.toThrow('CP03B injected Memory failure');
    expect(finalWriteReached).toBe(true); expect(await current(f)).toEqual(before);
    const counts = await outputs(f); expect(counts).toEqual({ decisions: 0, memory: 0 });
    console.log('CP03B_ROLLBACK', JSON.stringify({ finalWriteReached, ...counts }));
  });

  for (const exposedConversions of [100, 3]) {
    it(`negative/thin results (${exposedConversions}) conclude once with Memory and no Decision`, async () => {
      const f = await fixture({ exposedConversions });
      const result = await concludeIncrementality(f.ws, f.test.id);
      expect(result.readout.conclusive).toBe(false); expect(result.decisionId).toBeNull();
      await expect(concludeIncrementality(f.ws, f.test.id)).rejects.toMatchObject({ code: 'HOLDOUT_CONFLICT' });
      expect(await outputs(f)).toEqual({ decisions: 0, memory: 1 });
    });
  }

  it('existing role, plan and measurement gates deny before any lifecycle mutation', async () => {
    const f = await fixture();
    for (const role of ['BUYER', 'CLIENT']) {
      for (const action of ['metrics', 'conclude']) expect((await request(app(f, role)).post(`/incrementality/${f.test.id}/${action}`).send(observed)).status).toBe(403);
    }
    await prisma.workspace.update({ where: { id: f.ws }, data: { plan: 'FREE' } });
    expect((await request(app(f)).post(`/incrementality/${f.test.id}/conclude`)).status).toBe(403);
    await prisma.workspace.update({ where: { id: f.ws }, data: { plan: 'PRO', measurementTier: 'NONE' } });
    expect((await request(app(f)).post(`/incrementality/${f.test.id}/conclude`)).status).toBe(403);
    expect(getEconomics).not.toHaveBeenCalled(); expect(await outputs(f)).toEqual({ decisions: 0, memory: 0 });
  });
});
