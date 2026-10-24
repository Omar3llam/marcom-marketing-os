// CP-03A: real PG17 transactions/locks; only Meta and credentials are mocked.
import express from 'express';
import request from 'supertest';
import postgres from 'postgres';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbAvailable } from '../tests/dbProbe.js';

vi.mock('../services/connectors/credentialStore.js', () => ({ resolveCredential: vi.fn() }));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../lib/prisma.js';
import { resolveCredential } from '../services/connectors/credentialStore.js';
import { concludeTest, recordVariantMetrics, startTest } from '../services/test-tracker/TestTrackerService.js';
import { readTest } from '../services/test-readout/testReadoutEngine.js';
import { testingRouter } from '../routes/lumi/testing.js';

const DB_OK = await dbAvailable();
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

describe.skipIf(!DB_OK)('CP-03A / isolated PostgreSQL experiment lifecycle', () => {
  let sql;
  const workspaces = [];

  async function fixture({ thin = false, meta = false } = {}) {
    const ws = await prisma.workspace.create({ data: { name: `CP03A-${randomUUID()}`, plan: 'PRO' } });
    workspaces.push(ws.id);
    const test = await prisma.testExperiment.create({ data: {
      workspaceId: ws.id, entityId: randomUUID(), entityLevel: 'ADSET',
      dimension: 'HOOK', hypothesis: 'B improves CTR', metric: 'CTR', expectedSignal: 'higher CTR', status: 'RUNNING',
      variants: { create: [
        { label: 'A', isControl: true, impressions: thin ? 180 : 50000, clicks: thin ? 3 : 800, metaEntityId: meta ? 'owned-a' : null },
        { label: 'B', isControl: false, impressions: thin ? 180 : 50000, clicks: thin ? 4 : 1050, metaEntityId: meta ? 'owned-b' : null },
      ] },
    }, include: { variants: { orderBy: { label: 'asc' } } } });
    return { ws: ws.id, test };
  }

  const current = (f) => prisma.testExperiment.findFirst({ where: { id: f.test.id, workspaceId: f.ws }, include: { variants: { orderBy: { label: 'asc' } } } });
  async function counts(f) {
    return {
      decisions: await prisma.decision.count({ where: { workspaceId: f.ws, rootCause: `test:${f.test.id}` } }),
      memory: await prisma.decisionMemoryEntry.count({ where: { workspaceId: f.ws } }),
    };
  }
  function app(f, role = 'BUYER') {
    const server = express();
    server.use(express.json());
    // Mount seam stands in for already-authenticated Firebase context. Actual
    // plan + role gates run; their independent auth suites remain unchanged.
    server.use((req, _res, next) => { req.workspaceId = f.ws; req.collabRole = role; next(); });
    server.use(testingRouter);
    return server;
  }
  async function blockedOn(table, { until = () => false, lockingRead = false } = {}) {
    const deadline = Date.now() + 1800;
    do {
      const waiting = await sql`SELECT pid, pg_blocking_pids(pid) AS blockers, query
        FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      const row = waiting.find((r) => r.query.includes(table) && r.blockers.length && (!lockingRead || /FOR UPDATE/i.test(r.query)));
      if (row) {
        console.log('CP03A_LOCK', JSON.stringify({ table, pid: row.pid, blockers: row.blockers, lockingRead: /FOR UPDATE/i.test(row.query) }));
        return true;
      }
      await new Promise((r) => setTimeout(r, 10));
    } while (!until() && Date.now() < deadline);
    return false;
  }

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL, { max: 3, onnotice: () => {} });
    const [row] = await sql`SELECT current_setting('server_version_num')::int AS version`;
    expect(row.version).toBeGreaterThanOrEqual(170000);
    expect(row.version).toBeLessThan(180000);
    console.log('CP03A_PG', JSON.stringify({ version: row.version }));
  });
  beforeEach(() => { vi.clearAllMocks(); resolveCredential.mockResolvedValue(null); });
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces.splice(0) } } });
  });
  afterAll(async () => { await sql?.end(); });

  it('repeated HTTP conclusion returns 409 without another refresh, Decision or Memory', async () => {
    const f = await fixture({ meta: true });
    resolveCredential.mockResolvedValue({ accessToken: 'synthetic-test-only' });
    axios.get.mockImplementation(async (url) => ({ data: { data: [{ impressions: '50000', clicks: url.includes('owned-a') ? '800' : '1050', spend: '0' }] } }));
    expect((await request(app(f)).post(`/tests/${f.test.id}/conclude`)).status).toBe(200);
    const frozen = await current(f);
    const firstCalls = axios.get.mock.calls.length;
    const second = await request(app(f)).post(`/tests/${f.test.id}/conclude`);
    const actual = await counts(f);
    console.log('CP03A_REPEAT', JSON.stringify({ status: second.status, firstCalls, finalCalls: axios.get.mock.calls.length, ...actual }));
    expect(second.status).toBe(409);
    expect(axios.get).toHaveBeenCalledTimes(firstCalls);
    expect(await current(f)).toEqual(frozen);
    expect(actual).toEqual({ decisions: 1, memory: 1 });
    const decision = await prisma.decision.findUnique({ where: { id: frozen.decisionId } });
    expect(decision).toMatchObject({ status: 'PROPOSED', decisionClass: 'EXPERIMENT', workspaceId: f.ws });
  });

  it('two conclusions contending on an actual row lock commit exactly one result', async () => {
    const f = await fixture();
    let pending;
    const owner = sql.begin(async (tx) => {
      await tx`SELECT id FROM test_experiments WHERE id = ${f.test.id}::uuid AND "workspaceId" = ${f.ws}::uuid FOR UPDATE`;
      pending = Promise.allSettled([concludeTest(f.ws, f.test.id, { refresh: false }), concludeTest(f.ws, f.test.id, { refresh: false })]);
      expect(await blockedOn('test_experiments')).toBe(true);
    });
    await owner;
    const outcomes = await pending;
    const actual = await counts(f);
    console.log('CP03A_CONCURRENT', JSON.stringify({ outcomes: outcomes.map((r) => r.status === 'fulfilled' ? 'COMMITTED' : r.reason.code), ...actual }));
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((r) => r.status === 'rejected')?.reason).toMatchObject({ code: 'TEST_CONFLICT' });
    expect(actual).toEqual({ decisions: 1, memory: 1 });
  });

  it('a competing conclusion waits before refreshing Meta', async () => {
    const f = await fixture({ meta: true });
    const entered = deferred(), release = deferred();
    resolveCredential.mockResolvedValue({ accessToken: 'synthetic-test-only' });
    axios.get.mockImplementation(async (url) => {
      if (url.includes('owned-a')) { entered.resolve(); await release.promise; }
      return { data: { data: [{ impressions: '50000', clicks: url.includes('owned-a') ? '800' : '1050', spend: '0' }] } };
    });
    const first = concludeTest(f.ws, f.test.id);
    await entered.promise;
    const second = concludeTest(f.ws, f.test.id);
    const outcomes = Promise.allSettled([first, second]);
    let locked;
    try { locked = await blockedOn('test_experiments', { lockingRead: true }); } finally { release.resolve(); }
    const result = await outcomes;
    console.log('CP03A_META_RACE', JSON.stringify({ locked, calls: axios.get.mock.calls.length, outcomes: result.map((r) => r.status) }));
    expect(locked).toBe(true);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await counts(f)).toEqual({ decisions: 1, memory: 1 });
  });

  it('a metrics update racing conclusion cannot overwrite frozen evidence', async () => {
    const f = await fixture();
    const a = f.test.variants[0];
    let metrics, conclusion;
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM test_variants WHERE id = ${a.id}::uuid FOR UPDATE`;
      metrics = recordVariantMetrics(f.ws, f.test.id, [{ variantId: a.id, clicks: 5000 }]);
      expect(await blockedOn('test_variants')).toBe(true);
      let concluded = false;
      conclusion = concludeTest(f.ws, f.test.id, { refresh: false }).finally(() => { concluded = true; });
      // GREEN waits on the parent lock. RED can finish its old readout while
      // the already-authorized metrics writer is still blocked on variant A.
      await blockedOn('test_experiments', { until: () => concluded, lockingRead: true });
    });
    await metrics;
    const out = await conclusion;
    const frozen = await current(f);
    const authoritative = readTest({ metric: frozen.metric, variants: frozen.variants.map((v) => ({ ...v, variantId: v.id })) });
    console.log('CP03A_METRICS_RACE', JSON.stringify({ storedWinner: frozen.winnerLabel, evidenceWinner: authoritative.winnerLabel, clicks: frozen.variants.map((v) => v.clicks) }));
    expect(out.readout.winnerLabel).toBe(authoritative.winnerLabel);
    expect(frozen.winnerLabel).toBe(authoritative.winnerLabel);
    expect(frozen.lift).toBe(authoritative.lift);
  });

  it('conclusion holding its row refuses a later metrics writer after commit', async () => {
    const f = await fixture({ meta: true });
    const entered = deferred(), release = deferred();
    resolveCredential.mockResolvedValue({ accessToken: 'synthetic-test-only' });
    axios.get.mockImplementation(async () => { entered.resolve(); await release.promise; return { data: { data: [] } }; });
    const conclusion = concludeTest(f.ws, f.test.id);
    await entered.promise;
    const metrics = recordVariantMetrics(f.ws, f.test.id, [{ variantId: f.test.variants[0].id, clicks: 5000 }]);
    const results = Promise.allSettled([conclusion, metrics]);
    let locked;
    try { locked = await blockedOn('test_experiments', { lockingRead: true }); } finally { release.resolve(); }
    const settled = await results;
    expect(locked).toBe(true);
    expect(settled[0].status).toBe('fulfilled');
    expect(settled[1].reason).toMatchObject({ code: 'TEST_CONFLICT' });
    expect((await current(f)).variants[0].clicks).toBe(800);
  });

  it('terminal HTTP start/metrics return 409 and preserve all frozen fields', async () => {
    const f = await fixture();
    await concludeTest(f.ws, f.test.id, { refresh: false });
    const frozen = await current(f);
    expect((await request(app(f)).post(`/tests/${f.test.id}/start`)).status).toBe(409);
    expect((await request(app(f)).post(`/tests/${f.test.id}/metrics`).send({ variants: [{ variantId: f.test.variants[0].id, clicks: 0 }] })).status).toBe(409);
    expect(await current(f)).toEqual(frozen);
  });

  it('foreign and missing IDs return identical 404s for every mutation and never refresh', async () => {
    const f = await fixture(), foreign = await fixture();
    const before = await current(f);
    for (const action of ['start', 'metrics', 'conclude']) {
      for (const id of [f.test.id, randomUUID()]) {
        const res = await request(app(foreign)).post(`/tests/${id}/${action}`).send({ variants: [{ variantId: f.test.variants[0].id, clicks: 0 }] });
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('TestNotFound');
      }
    }
    expect(await current(f)).toEqual(before);
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(await counts(f)).toEqual({ decisions: 0, memory: 0 });
  });

  it('a foreign workspace does not wait for or acquire the owned experiment lock', async () => {
    const f = await fixture(), foreign = await fixture();
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM test_experiments WHERE id = ${f.test.id}::uuid FOR UPDATE`;
      await expect(startTest(foreign.ws, f.test.id)).rejects.toThrow(/not found/i);
    });
    expect((await current(f)).status).toBe('RUNNING');
  });

  it('actual transaction rollback leaves no Decision, Memory or frozen experiment after a final write fails', async () => {
    const f = await fixture();
    const before = await current(f);
    const transaction = prisma.$transaction.bind(prisma);
    const fail = new Error('CP03A injected final Memory write failure');
    let reachedFinalWrite = false;
    vi.spyOn(prisma, '$transaction').mockImplementationOnce((callback, options) => transaction(async (tx) => callback(new Proxy(tx, {
      get(target, key) {
        if (key === 'decisionMemoryEntry') return { create: async () => { reachedFinalWrite = true; throw fail; } };
        return target[key];
      },
    })), options));
    await expect(concludeTest(f.ws, f.test.id, { refresh: false })).rejects.toThrow(fail.message);
    expect(reachedFinalWrite).toBe(true);
    expect(await current(f)).toEqual(before);
    expect(await counts(f)).toEqual({ decisions: 0, memory: 0 });
    console.log('CP03A_ROLLBACK', JSON.stringify({ finalWriteReached: true, ...await counts(f) }));
  });

  it('thin evidence still records one Memory and no Decision', async () => {
    const f = await fixture({ thin: true });
    const out = await concludeTest(f.ws, f.test.id, { refresh: false });
    expect(out.readout.confidenceLabel).toBe('INCONCLUSIVE');
    expect(out.decisionId).toBeNull();
    await expect(concludeTest(f.ws, f.test.id, { refresh: false })).rejects.toMatchObject({ code: 'TEST_CONFLICT' });
    expect(await counts(f)).toEqual({ decisions: 0, memory: 1 });
  });

  it('invalid HTTP metrics fail before any row in the batch is changed', async () => {
    const f = await fixture();
    const before = await current(f);
    const res = await request(app(f)).post(`/tests/${f.test.id}/metrics`).send({ variants: [
      { variantId: f.test.variants[0].id, clicks: 10 }, { variantId: f.test.variants[1].id, spendMinor: -1 },
    ] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('InvalidTestMetrics');
    expect(await current(f)).toEqual(before);
  });

  it('existing role gates still deny a CLIENT before any lifecycle mutation', async () => {
    const f = await fixture();
    for (const action of ['start', 'metrics', 'conclude']) {
      expect((await request(app(f, 'CLIENT')).post(`/tests/${f.test.id}/${action}`).send({ variants: [{}] })).status).toBe(403);
    }
    expect(await counts(f)).toEqual({ decisions: 0, memory: 0 });
  });
});
