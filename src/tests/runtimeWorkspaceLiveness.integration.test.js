// Runtime refusal and deletion interleavings against migrated, isolated PostgreSQL.
// Providers, proposal organs and queue transport are synthetic; persistence is real.
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbAvailable } from '../tests/dbProbe.js';

const control = vi.hoisted(() => ({ sql: null, processor: null, beforeTx: null, afterLock: null,
  txCount: 0, auth: vi.fn(), fetch: vi.fn(), guardrails: vi.fn(), fatigue: vi.fn(), persist: vi.fn(), evaluate: vi.fn() }));
vi.mock('../utils/db.js', () => ({ getDb: () => control.sql }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../queues/connection.js', () => ({ bullConnection: {}, QUEUE_PREFIX: 'synthetic' }));
vi.mock('../queues/index.js', () => ({ SYNC_QUEUE_NAME: 'synthetic-sync' }));
vi.mock('bullmq', () => ({ Worker: class { constructor(_name, handler) { control.processor = handler; } on() {} } }));
vi.mock('../services/connectors/connectorRegistry.js', () => ({ isSyncable: () => true, resolve: () => ({
  channel: 'META', authenticate: control.auth, fetchRaw: control.fetch, normalize: ({ rows }) => rows,
}) }));
vi.mock('../services/guardrail-engine/GuardrailSweepService.js', () => ({ sweepGuardrails: control.guardrails }));
vi.mock('../services/fatigue-forecaster/FatigueSweepService.js', () => ({ sweepFatigue: control.fatigue }));
vi.mock('../services/verdict-engine/VerdictService.js', () => ({ persistConnectorVerdicts: control.persist }));
vi.mock('../services/verdict-engine/index.js', () => ({ evaluateConnectorVerdicts: control.evaluate,
  getConnectorVerdicts: vi.fn(async () => ({ verdicts: [] })), failedEvaluation: vi.fn() }));
vi.mock('../services/pattern-engine/institutionalMemory.js', () => ({ getInstitutionalMemory: vi.fn(async () => ({})) }));
vi.mock('../services/entity-graph/index.js', () => ({ getConnectorCampaigns: vi.fn(async () => []) }));
vi.mock('../services/portfolio/PortfolioService.js', () => ({ getPortfolio: vi.fn(async () => null) }));
vi.mock('../services/blended-truth/BlendedTruthService.js', async (original) => ({ ...await original(), getBlendedTruth: vi.fn(async () => null) }));
vi.mock('../services/test-generator/TestGeneratorService.js', () => ({ getWeeklyAgenda: vi.fn(async () => []) }));
vi.mock('../services/planning/PlanService.js', () => ({ trackPlan: vi.fn() }));

import { prisma } from '../lib/prisma.js';
import { ensureCredentialSchema } from '../models/credential.js';
import { runConnectorSync } from '../services/connectors/ConnectorSyncService.js';
import { landSnapshots } from '../services/connectors/snapshotSink.js';
import { runSweep } from '../services/agentic-loop/AgenticLoopService.js';
import { startSyncWorker } from '../workers/syncWorker.js';

const DB_OK = await dbAvailable();
const NOW = new Date('2026-10-12T09:00:00Z');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const within = (promise, ms = 700) => Promise.race([promise.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
const rows = () => [{ externalId: 'synthetic-account', entityLevel: 'ACCOUNT', name: 'Fixture', channel: 'META',
  source: 'META', date: NOW, measurementWindow: 'ROLLING_WINDOW', currency: 'USD',
  spendMinor: 100, revenueMinor: 200, impressions: 100, clicks: 5, conversions: 1 }];
let deleter, originalTransaction, spaces = [];
async function fixture({ missing = false, credential = false } = {}) {
  const id = randomUUID(); spaces.push(id);
  if (!missing) await prisma.workspace.create({ data: { id, name: 'Synthetic runtime fixture', objective: null } });
  if (credential) await control.sql`INSERT INTO marcom_credentials
    (project_id, user_id, workspace_id, platform, is_active) VALUES
    (${`synthetic-${id}`}, 'synthetic-owner', ${id}, 'meta_ads', true)`;
  return id;
}
async function health(id) { return (await control.sql`SELECT health FROM marcom_credentials WHERE workspace_id = ${id}`)[0]?.health; }
async function emptyWrites(id) {
  expect(await prisma.account.count({ where: { workspaceId: id } })).toBe(0);
  expect(await prisma.metricSnapshot.count({ where: { workspaceId: id } })).toBe(0);
  expect(await prisma.loopRun.count({ where: { workspaceId: id } })).toBe(0);
}
async function blockedDelete() {
  const until = Date.now() + 1000;
  while (Date.now() < until) {
    const found = await control.sql`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
      AND query LIKE '%DELETE%workspaces%' AND cardinality(pg_blocking_pids(pid)) > 0`;
    if (found[0].n > 0) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe.skipIf(!DB_OK)('workspace liveness — real PostgreSQL runtime boundaries', () => {
  beforeAll(async () => {
    control.sql = postgres(process.env.DATABASE_URL, { max: 4 });
    deleter = new PrismaClient();
    await ensureCredentialSchema();
    originalTransaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (operation, options) => {
      const boundary = ++control.txCount;
      if (control.beforeTx) await control.beforeTx(boundary);
      if (Array.isArray(operation)) return originalTransaction(operation, options);
      return originalTransaction(async (tx) => operation(new Proxy(tx, { get(target, key) {
        if (key !== '$queryRaw') return target[key];
        return async (...args) => {
          const result = await target.$queryRaw(...args);
          if (Array.isArray(args[0]) && args[0].join(' ').includes('FOR KEY SHARE') && control.afterLock) {
            await control.afterLock(boundary);
          }
          return result;
        };
      } })), options);
    });
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    control.beforeTx = null; control.afterLock = null; control.txCount = 0;
    control.auth.mockImplementation(async (workspaceId) => ({ ok: true, workspaceId }));
    control.fetch.mockResolvedValue(rows());
    control.evaluate.mockResolvedValue({ campaigns: [], gatedOut: [] });
    control.guardrails.mockResolvedValue({ hits: 0 });
    control.fatigue.mockResolvedValue({}); control.persist.mockResolvedValue({});
    vi.stubEnv('DAILY_INGESTION_ENABLED', 'false');
    vi.stubEnv('SYNC_TRIGGERS_SWEEP', 'true');
    vi.stubEnv('AI_AUTOMATIC_ENABLED', 'false');
    await control.sql`DELETE FROM marcom_credentials WHERE user_id = 'synthetic-owner'`;
  });
  afterAll(async () => {
    control.beforeTx = null; control.afterLock = null;
    await control.sql`DELETE FROM marcom_credentials WHERE user_id = 'synthetic-owner'`;
    await prisma.workspace.deleteMany({ where: { id: { in: spaces } } });
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await deleter.$disconnect(); await control.sql.end(); await prisma.$disconnect();
  });

  it('active credential with no workspace refuses before provider access or success freshness', async () => {
    const id = await fixture({ missing: true, credential: true });
    const result = await runConnectorSync(id, { now: NOW });
    expect(result).toMatchObject({ synced: 0, failed: 1, results: [{ status: 'error', code: 'NoWorkspace' }] });
    expect(control.auth).not.toHaveBeenCalled(); expect(control.fetch).not.toHaveBeenCalled();
    expect((await health(id)).lastSuccessfulSync).toBeNull();
    await emptyWrites(id);
  });

  it('deletion after provider fetch refuses the final landing boundary', async () => {
    const id = await fixture({ credential: true });
    control.fetch.mockImplementationOnce(async () => { await deleter.workspace.delete({ where: { id } }); return rows(); });
    const result = await runConnectorSync(id, { now: NOW });
    expect(result.results[0]).toMatchObject({ status: 'error', code: 'NoWorkspace' });
    expect(control.auth).toHaveBeenCalledTimes(1); expect((await health(id)).lastSuccessfulSync).toBeNull();
    await emptyWrites(id);
  });

  it('deletion between graph and metrics refuses instead of reporting partial success', async () => {
    const id = await fixture();
    control.beforeTx = async (n) => { if (n === 2) await deleter.workspace.delete({ where: { id } }); };
    await expect(landSnapshots(id, 'META', rows())).rejects.toMatchObject({ code: 'NoWorkspace' });
    await emptyWrites(id);
  });

  it.each([1, 2])('the actual parent lock blocks deletion during write transaction %s', async (phase) => {
    const id = await fixture(); const entered = deferred(), release = deferred();
    let deletion;
    control.afterLock = async (n) => { if (n === phase) { entered.resolve(); await release.promise; } };
    // For the entity race, force the queued delete to complete before metrics begin.
    control.beforeTx = async (n) => { if (phase === 1 && n === 2) await deletion; };
    const landing = landSnapshots(id, 'META', rows()).then((value) => ({ value }), (error) => ({ error }));
    let enteredLock = false, blocked = false;
    try {
      enteredLock = await within(entered.promise);
      if (enteredLock) { deletion = deleter.workspace.delete({ where: { id } }).then((value) => value); blocked = await blockedDelete(); }
    } finally { release.resolve(); }
    const outcome = await landing; if (deletion) await deletion;
    expect(enteredLock).toBe(true); expect(blocked).toBe(true);
    if (phase === 1) expect(outcome.error).toMatchObject({ code: 'NoWorkspace' });
    else expect(outcome.value).toMatchObject({ entities: 1, snapshots: 1 }); // write committed BEFORE deletion
    await emptyWrites(id);
  });

  it('missing runSweep scope invokes no evaluation or proposal organs', async () => {
    const id = await fixture({ missing: true });
    await expect(runSweep(id, { trigger: 'SCHEDULED', force: true })).rejects.toMatchObject({ code: 'NoWorkspace' });
    expect(control.evaluate).not.toHaveBeenCalled(); expect(control.guardrails).not.toHaveBeenCalled();
    expect(control.fatigue).not.toHaveBeenCalled(); expect(control.persist).not.toHaveBeenCalled();
    await emptyWrites(id);
  });

  it('deletion before audit refuses while preserving evidence that earlier organs were attempted', async () => {
    const id = await fixture();
    control.beforeTx = async () => { await deleter.workspace.deleteMany({ where: { id } }); };
    // Baseline has no transaction: the same deletion is injected at loopRun.create.
    const create = prisma.loopRun.create.bind(prisma.loopRun);
    const spy = vi.spyOn(prisma.loopRun, 'create').mockImplementation(async (args) => {
      if (!control.txCount) await deleter.workspace.delete({ where: { id } });
      return create(args);
    });
    try { await expect(runSweep(id, { trigger: 'SCHEDULED', force: true })).rejects.toMatchObject({ code: 'NoWorkspace' }); }
    finally { spy.mockRestore(); }
    expect(control.guardrails).toHaveBeenCalled(); expect(control.persist).toHaveBeenCalled(); await emptyWrites(id);
  });

  it('live workspace with null objective remains valid and persists a LoopRun', async () => {
    const id = await fixture();
    const result = await runSweep(id, { trigger: 'SCHEDULED', force: true });
    expect(result.loopRun.workspaceId).toBe(id);
    expect(await prisma.loopRun.count({ where: { workspaceId: id } })).toBe(1);
  });

  it('the LoopRun transaction holds its parent until the audit commits', async () => {
    const id = await fixture(), entered = deferred(), release = deferred();
    control.afterLock = async () => { entered.resolve(); await release.promise; };
    const sweep = runSweep(id, { trigger: 'SCHEDULED', force: true });
    expect(await within(entered.promise)).toBe(true);
    const deletion = deleter.workspace.delete({ where: { id } }).then((value) => value);
    let blocked;
    try { blocked = await blockedDelete(); } finally { release.resolve(); }
    const result = await sweep; await deletion;
    expect(blocked).toBe(true); expect(result.loopRun.workspaceId).toBe(id);
    await emptyWrites(id); // subsequent deletion legitimately cascades the committed audit
  });

  it('provider work is outside all workspace-lock transactions', async () => {
    const id = await fixture({ credential: true });
    control.fetch.mockImplementationOnce(async () => {
      const found = await control.sql`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state = 'idle in transaction'`;
      expect(found[0].n).toBe(0);
      return rows();
    });
    expect(await runConnectorSync(id, { now: NOW })).toMatchObject({ synced: 1, failed: 0 });
  });

  it('empty landing and a scoped sync without credentials still refuse a missing parent', async () => {
    const id = await fixture({ missing: true });
    await expect(landSnapshots(id, 'META', [])).rejects.toMatchObject({ code: 'NoWorkspace' });
    await expect(runConnectorSync(id)).rejects.toMatchObject({ code: 'NoWorkspace' });
    expect(control.auth).not.toHaveBeenCalled();
  });

  it('DB lookup failure is distinct from a successful missing-parent read', async () => {
    const id = await fixture({ credential: true });
    const spy = vi.spyOn(prisma.workspace, 'findUnique').mockRejectedValueOnce(new Error('synthetic DB outage'));
    try {
      const result = await runConnectorSync(id, { now: NOW });
      expect(result.results[0]).toMatchObject({ status: 'error', code: 'WorkspaceUnavailable' });
      expect(control.auth).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
    await emptyWrites(id);
  });

  it('worker preserves live failed/skipped isolation and refuses unavailable scopes before sweeps', async () => {
    const live = await fixture({ credential: true }), failed = await fixture({ credential: true });
    const skipped = await fixture({ credential: true }), absent = await fixture({ missing: true, credential: true });
    control.auth.mockImplementation(async (workspaceId) => workspaceId === skipped
      ? { ok: false, error: 'synthetic provider refusal' } : { ok: true, workspaceId });
    control.fetch.mockImplementation(async (auth) => { if (auth.workspaceId === failed) throw new Error('synthetic provider failure'); return rows(); });
    startSyncWorker(); const result = await control.processor({ id: 'synthetic-job', data: {} });
    expect(result).toMatchObject({ synced: 1, failed: 2, swept: 3 });
    expect(result.results.find((r) => r.workspaceId === absent)).toMatchObject({ status: 'error', code: 'NoWorkspace' });
    expect(control.auth.mock.calls.some(([id]) => id === absent)).toBe(false);
    expect(control.guardrails.mock.calls.some(([id]) => id === absent)).toBe(false);
    for (const id of [live, failed, skipped]) expect(await prisma.loopRun.count({ where: { workspaceId: id } })).toBe(1);
    await emptyWrites(absent);
  });

  it('worker retains a parent-read refusal even if the next lookup would recover', async () => {
    const id = await fixture({ credential: true });
    const spy = vi.spyOn(prisma.workspace, 'findUnique').mockRejectedValueOnce(new Error('synthetic parent-read outage'));
    try {
      startSyncWorker(); const result = await control.processor({ id: 'synthetic-job', data: {} });
      expect(result.results[0]).toMatchObject({ status: 'error', code: 'WorkspaceUnavailable' });
      expect(control.guardrails).not.toHaveBeenCalled(); expect(control.evaluate).not.toHaveBeenCalled();
      expect(result.swept).toBe(0);
    } finally { spy.mockRestore(); }
    await emptyWrites(id);
  });

  it('unrelated write FK failure is propagated, never relabelled as missing workspace', async () => {
    const id = await fixture();
    await control.sql`CREATE FUNCTION synthetic_other_fk() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic unrelated FK' USING ERRCODE = '23503', CONSTRAINT = 'synthetic_other_fkey'; END $$`;
    await control.sql`CREATE TRIGGER synthetic_other_fk BEFORE INSERT ON loop_runs FOR EACH ROW EXECUTE FUNCTION synthetic_other_fk()`;
    let error;
    try { await runSweep(id, { trigger: 'SCHEDULED', force: true }); } catch (err) { error = err; }
    finally { await control.sql`DROP TRIGGER synthetic_other_fk ON loop_runs`; await control.sql`DROP FUNCTION synthetic_other_fk()`; }
    expect(error).toMatchObject({ code: 'P2003' });
    expect(error.code).not.toBe('NoWorkspace');
    expect(await prisma.loopRun.count({ where: { workspaceId: id } })).toBe(0);
  });
});
