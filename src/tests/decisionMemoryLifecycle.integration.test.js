// T2: real isolated PG17 locks, independent SQL counts and atomic rollback.
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbAvailable } from '../tests/dbProbe.js';

vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/unit-economics/EconomicsService.js', () => ({ getEconomics: vi.fn() }));

import { prisma } from '../lib/prisma.js';
import { getEconomics } from '../services/unit-economics/EconomicsService.js';
import { resolvePrediction } from '../services/fatigue-forecaster/FatiguePredictionService.js';
import { concludeTest } from '../services/test-tracker/TestTrackerService.js';
import { concludeIncrementality } from '../services/incrementality-engine/IncrementalityService.js';
import { buildMemoryInputs } from '../services/test-generator/TestGeneratorService.js';
import { generateAgenda } from '../services/test-generator/testGeneratorEngine.js';

const DB_OK = await dbAvailable();
const PROJECTED = new Date('2026-10-20T00:00:00Z');
const evidence = (kind, data) => process.stdout.write(`T2_${kind} ${JSON.stringify(data)}\n`);

describe.skipIf(!DB_OK)('T2 / isolated PG17 Decision Memory lifecycle', () => {
  let sql;
  const workspaces = [];
  async function workspace() {
    const row = await prisma.workspace.create({ data: { name: `T2-${randomUUID()}` } });
    workspaces.push(row.id); return row.id;
  }
  async function fixture() {
    const ws = await workspace();
    const prediction = await prisma.fatiguePrediction.create({ data: {
      workspaceId: ws, entityId: randomUUID(), entityLevel: 'ADSET', metric: 'frequency',
      ceiling: 3.5, confidence: 0.95, projectedBreachDate: PROJECTED, basis: 'Synthetic rising frequency',
    } });
    return { ws, prediction };
  }
  const resolve = (f, actualBreachDate = PROJECTED) => resolvePrediction({ predictionId: f.prediction.id, workspaceId: f.ws, actualBreachDate });
  const current = (f) => prisma.fatiguePrediction.findFirst({ where: { id: f.prediction.id, workspaceId: f.ws } });
  async function count(f) {
    const [row] = await sql`SELECT count(*)::int AS memory FROM decision_memory_entries
      WHERE "workspaceId" = ${f.ws}::uuid AND "entityId" = ${f.prediction.entityId}::uuid AND "actionType" = 'FATIGUE_FORECAST'`;
    return row.memory;
  }
  async function blocked(number) {
    const deadline = Date.now() + 1800;
    do {
      const rows = await sql`SELECT pid, query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      const waiting = rows.filter((r) => r.query.includes('fatigue_predictions') && r.blockers.length);
      if (waiting.length >= number) {
        evidence('LOCK', { count: waiting.length, lockingReads: waiting.filter((r) => /FOR UPDATE/i.test(r.query)).length,
          waiters: waiting.map((r) => ({ pid: r.pid, blockers: r.blockers })) });
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
    evidence('PG', row);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.workspace.deleteMany({ where: { id: { in: workspaces.splice(0) } } });
  });
  afterAll(async () => { await sql?.end(); });

  for (const secondDate of [PROJECTED, new Date('2026-10-25T00:00:00Z')]) {
    it(`concurrent Fatigue resolutions freeze one original result and one Memory (${secondDate.toISOString()})`, async () => {
      const f = await fixture(); let pending, observed;
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM fatigue_predictions WHERE id = ${f.prediction.id}::uuid AND "workspaceId" = ${f.ws}::uuid FOR UPDATE`;
        pending = Promise.allSettled([resolve(f), resolve(f, secondDate)]);
        observed = await blocked(2);
      });
      const results = await pending, memory = await count(f);
      evidence('CONCURRENT', { observed, statuses: results.map((r) => r.status), memory });
      expect(observed).toBe(true); expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(memory).toBe(1);
      expect(results[0].value).toEqual(results[1].value);
      expect(await current(f)).toEqual(results[0].value);
      const rows = await prisma.decisionMemoryEntry.findMany({ where: { workspaceId: f.ws } });
      expect(rows[0]).toMatchObject({ isSustainable: null, impactDurationHrs: null, entityId: f.prediction.entityId });
    });
  }

  it('a sequential repeat preserves resolution, provenance and the original Memory', async () => {
    const f = await fixture(), first = await resolve(f);
    const memory = await prisma.decisionMemoryEntry.findMany({ where: { workspaceId: f.ws } });
    expect(await resolve(f, new Date('2026-10-30'))).toEqual(first);
    expect(await current(f)).toEqual(first);
    expect(await prisma.decisionMemoryEntry.findMany({ where: { workspaceId: f.ws } })).toEqual(memory);
    expect(await count(f)).toBe(1);
  });

  it('a failed Memory insert rolls back the real resolution and permits a clean retry', async () => {
    const f = await fixture(), before = await current(f), transaction = prisma.$transaction.bind(prisma);
    const failure = new Error('T2 injected Memory insertion failure'); let reached = false;
    // Also inject on the old ambient path so RED observes its partial commit.
    vi.spyOn(prisma.decisionMemoryEntry, 'create').mockImplementationOnce(async () => { reached = true; throw failure; });
    vi.spyOn(prisma, '$transaction').mockImplementationOnce((callback, options) => transaction(async (tx) => callback(new Proxy(tx, {
      get(target, key) {
        if (key === 'decisionMemoryEntry') return new Proxy(target.decisionMemoryEntry, { get(model, operation) {
          if (operation === 'create') return async () => {
            const updated = await target.fatiguePrediction.findFirst({ where: { id: f.prediction.id, workspaceId: f.ws } });
            expect(updated.resolvedAt).not.toBeNull(); reached = true; throw failure;
          };
          return model[operation];
        } });
        return target[key];
      },
    })), options));
    await expect(resolve(f)).rejects.toThrow(failure.message);
    const after = await current(f), memory = await count(f);
    evidence('ROLLBACK', { memoryWriteReached: reached, resolved: after.resolvedAt !== null, memory });
    expect(reached).toBe(true); expect(memory).toBe(0); expect(after).toEqual(before);
    vi.restoreAllMocks();
    await resolve(f); expect(await count(f)).toBe(1);
  });

  it('missing and foreign IDs refuse while another workspace holds its parent lock', async () => {
    const f = await fixture(), foreign = await workspace(), before = await current(f);
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM fatigue_predictions WHERE id = ${f.prediction.id}::uuid AND "workspaceId" = ${f.ws}::uuid FOR UPDATE`;
      for (const predictionId of [f.prediction.id, randomUUID()]) {
        await expect(resolvePrediction({ predictionId, workspaceId: foreign, actualBreachDate: PROJECTED })).rejects.toThrow('not found');
      }
    });
    expect(await current(f)).toEqual(before); expect(await count(f)).toBe(0);
    expect(await prisma.decisionMemoryEntry.count({ where: { workspaceId: foreign } })).toBe(0);
    evidence('TENANT', { ownerUnchanged: true, ownerMemory: 0, foreignMemory: 0 });
  });

  it.each([PROJECTED, new Date('2026-10-30'), null])('forecast accuracy is preserved but durability is unknown (%s)', async (date) => {
    const f = await fixture(), result = await resolve(f, date);
    const [memory] = await prisma.decisionMemoryEntry.findMany({ where: { workspaceId: f.ws } });
    evidence('FATIGUE_TRUTH', { accuracy: result.accuracy, sustainable: memory.isSustainable });
    expect(result.accuracy).toBe(date ? (date.getTime() === PROJECTED.getTime() ? 1 : 0) : null);
    expect(memory.isSustainable).toBeNull();
    expect(memory.rationale).toContain(date ? `accuracy ${result.accuracy}` : 'pre-empted by refresh');
  });

  it('A/B confidence preserves the Decision and readout while downstream durability stays neutral', async () => {
    const ws = await workspace(), entity = randomUUID();
    const test = await prisma.testExperiment.create({ data: {
      workspaceId: ws, entityId: entity, entityLevel: 'ADSET', dimension: 'HOOK', hypothesis: 'Synthetic hook',
      metric: 'CTR', expectedSignal: 'Higher CTR', status: 'RUNNING', currency: 'USD',
      variants: { create: [
        { label: 'A', description: 'Control', isControl: true, impressions: 50000, clicks: 800 },
        { label: 'B', description: 'Variant', isControl: false, impressions: 50000, clicks: 1050 },
      ] },
    } });
    const result = await concludeTest(ws, test.id, { refresh: false });
    const memory = await prisma.decisionMemoryEntry.findUnique({ where: { id: result.memoryId } });
    const decision = await prisma.decision.findUnique({ where: { id: result.decisionId } });
    expect(result.readout.confidenceLabel).toBe('HIGH'); expect(result.readout.winnerLabel).toBe('B');
    expect(decision).toMatchObject({ status: 'PROPOSED', rootCause: `test:${test.id}`, verdict: result.verdict });
    const [suggestion] = generateAgenda({ entities: [{ entityId: entity, metrics: { ctr: 0.5, spendMinor: 10000 } }], memory: buildMemoryInputs([memory]) });
    evidence('AB_TRUTH', { confidence: result.readout.confidenceLabel, decisionStatus: decision.status, sustainable: memory.isSustainable, rationale: suggestion.rationale });
    expect(memory.isSustainable).toBeNull(); expect(suggestion.rationale).toContain('memory ×1).');
  });

  it('operator-entered positive Holdout lift preserves lineage and a PROPOSED Decision without claiming durability', async () => {
    const ws = await workspace();
    getEconomics.mockResolvedValue({ economics: { aovMinor: 5000, currency: 'USD' } });
    const test = await prisma.incrementalityTest.create({ data: {
      workspaceId: ws, entityId: randomUUID(), entityLevel: 'CAMPAIGN', channel: 'META', name: 'Synthetic operator counts',
      status: 'RUNNING', holdoutPct: 0.1, mde: 0.1, sampleSizePerArm: 1000, durationDays: 14,
      exposedUsers: 5000, exposedConversions: 500, holdoutUsers: 5000, holdoutConversions: 250,
      guardrails: { assumptions: ['Synthetic counts; randomization not independently verified.'] },
    } });
    const result = await concludeIncrementality(ws, test.id);
    const [memory] = await prisma.decisionMemoryEntry.findMany({ where: { workspaceId: ws } });
    const frozen = await prisma.incrementalityTest.findUnique({ where: { id: test.id } });
    const decision = await prisma.decision.findUnique({ where: { id: frozen.decisionId } });
    evidence('HOLDOUT_TRUTH', { conclusive: result.readout.conclusive, confidence: result.readout.confidenceLabel, sustainable: memory.isSustainable, decisionStatus: decision.status });
    expect(result.readout).toMatchObject({ conclusive: true, confidenceLabel: 'HIGH' });
    expect(frozen.guardrails).toEqual(test.guardrails); expect(decision.status).toBe('PROPOSED');
    expect(memory.isSustainable).toBeNull(); expect(memory.rationale).toMatch(/operator|independent/i);
  });

  it('new resolutions never rewrite historical Memory', async () => {
    const f = await fixture();
    const historical = await prisma.decisionMemoryEntry.create({ data: {
      workspaceId: f.ws, entityId: randomUUID(), rationale: 'Historical explicit learning', isSustainable: true,
    } });
    await resolve(f);
    expect(await prisma.decisionMemoryEntry.findUnique({ where: { id: historical.id } })).toEqual(historical);
  });
});
