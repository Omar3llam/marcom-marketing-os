// ============================================================
// IncrementalityService — memory mapping + the write→read loop
// ============================================================
// Two concerns:
//   1. incrementalityToMemory (pure) maps a readout to a memory entry.
//   2. recordCounts (the missing write organ) + concludeIncrementality:
//      observed counts make a readout meaningful; an unrun holdout is
//      REFUSED cleanly rather than read out off empty arms. The real
//      incrementalityEngine runs; only the DB + economics are mocked.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../unit-economics/EconomicsService.js', () => ({ getEconomics: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    incrementalityTest:  { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    decision:            { create: vi.fn() },
    decisionMemoryEntry: { create: vi.fn() },
    $queryRaw:           vi.fn(),
    $transaction:        vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma.js';
import { getEconomics } from '../unit-economics/EconomicsService.js';
import { incrementalityToMemory, recordCounts, concludeIncrementality } from './IncrementalityService.js';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.incrementalityTest.findFirst.mockReset().mockResolvedValue(runningHoldout());
  prisma.incrementalityTest.update.mockResolvedValue({});
  prisma.incrementalityTest.updateMany.mockResolvedValue({ count: 1 });
  prisma.decision.create.mockResolvedValue({ id: 'dec-1' });
  prisma.decisionMemoryEntry.create.mockResolvedValue({ id: 'mem-1' });
  prisma.$queryRaw.mockResolvedValue([{ id: 't1' }]);
  prisma.$transaction.mockImplementation(async (operation) => operation(prisma));
  getEconomics.mockResolvedValue({ economics: { aovMinor: 5000, currency: 'USD' } });
});

function runningHoldout(over = {}) {
  return {
    id: 't1', workspaceId: 'ws-1', channel: 'META', status: 'RUNNING',
    entityId: 'ent-1', entityLevel: 'CAMPAIGN', sourceTestId: 'source-ab',
    exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250,
    ...over,
  };
}

describe('incrementalityToMemory — closes the loop into Phase-5 memory', () => {
  const test = { workspaceId: 'ws-1', channel: 'META', entityId: 'ent-1' };

  it('writes a sustainable causal learning for a confident positive lift', () => {
    const readout = { conclusive: true, liftPct: 18.2, ci: [0.01, 0.03], confidenceLabel: 'HIGH', rationale: '...' };
    const mem = incrementalityToMemory(test, readout);
    expect(mem.actionType).toBe('incrementality:META');
    expect(mem.isSustainable).toBe(true);
    expect(mem.rationale).toMatch(/incremental/i);
    expect(mem.workspaceId).toBe('ws-1');
  });

  it('records an inconclusive holdout honestly (not sustainable)', () => {
    const readout = { conclusive: false, liftPct: 4, ci: [-0.01, 0.02], confidenceLabel: 'LOW', rationale: 'CI includes zero — INCONCLUSIVE.' };
    const mem = incrementalityToMemory(test, readout);
    expect(mem.isSustainable).toBe(false);
    expect(mem.rationale).toMatch(/INCONCLUSIVE/i);
  });

  it('throws without a workspace', () => {
    expect(() => incrementalityToMemory({}, { conclusive: false })).toThrow(/workspaceId/);
  });
});

describe('recordCounts — the operator-entered observed result (DESIGNED → RUNNING)', () => {
  it('persists the four counters atomically and transitions to RUNNING', async () => {
    prisma.incrementalityTest.findFirst
      .mockResolvedValueOnce({ id: 't1', workspaceId: 'ws-1', status: 'DESIGNED', startedAt: null }) // pre-read
      .mockResolvedValueOnce({ id: 't1', status: 'RUNNING', exposedConversions: 300 });               // final read
    prisma.incrementalityTest.updateMany.mockResolvedValue({ count: 1 });

    const out = await recordCounts('ws-1', 't1', { exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250 });
    expect(out.status).toBe('RUNNING');
    expect(out.exposedConversions).toBe(300);
    const arg = prisma.incrementalityTest.updateMany.mock.calls[0][0];
    expect(arg.where.status).toEqual({ in: ['DESIGNED', 'RUNNING'] }); // the atomic immutability guard
    expect(arg.data.status).toBe('RUNNING');
  });

  it('refuses when a concurrent conclude flips the row mid-write (count 0)', async () => {
    prisma.incrementalityTest.findFirst.mockResolvedValue({ id: 't1', workspaceId: 'ws-1', status: 'RUNNING', startedAt: new Date() });
    prisma.incrementalityTest.updateMany.mockResolvedValue({ count: 0 }); // race: row already CONCLUDED
    await expect(recordCounts('ws-1', 't1', { exposedUsers: 1, exposedConversions: 1, holdoutUsers: 1, holdoutConversions: 1 }))
      .rejects.toThrow(/no longer editable|immutable/);
  });

  it('rejects conversions greater than users (impossible measurement)', async () => {
    await expect(recordCounts('ws-1', 't1', { exposedUsers: 100, exposedConversions: 101, holdoutUsers: 100, holdoutConversions: 10 }))
      .rejects.toThrow(/exposedConversions cannot exceed exposedUsers/);
    expect(prisma.incrementalityTest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects negative / non-integer counts', async () => {
    await expect(recordCounts('ws-1', 't1', { exposedUsers: -1, exposedConversions: 0, holdoutUsers: 10, holdoutConversions: 0 }))
      .rejects.toThrow(/non-negative integer/);
  });

  it('refuses to mutate a CONCLUDED holdout (counts are immutable)', async () => {
    prisma.incrementalityTest.findFirst.mockResolvedValue({ id: 't1', workspaceId: 'ws-1', status: 'CONCLUDED' });
    await expect(recordCounts('ws-1', 't1', { exposedUsers: 1, exposedConversions: 1, holdoutUsers: 1, holdoutConversions: 1 }))
      .rejects.toThrow(/immutable/);
    expect(prisma.incrementalityTest.updateMany).not.toHaveBeenCalled();
  });
});

describe('concludeIncrementality — real readout only after counts are recorded', () => {
  it('refuses an unrun holdout (zero arms) cleanly — never a fabricated lift', async () => {
    prisma.incrementalityTest.findFirst.mockResolvedValue({
      id: 't1', workspaceId: 'ws-1', channel: 'META',
      exposedUsers: 0, exposedConversions: 0, holdoutUsers: 0, holdoutConversions: 0,
    });
    await expect(concludeIncrementality('ws-1', 't1')).rejects.toThrow(/no observed counts/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reads a real causal lift from recorded counts and writes the loop', async () => {
    // exposed 300/5000 = 6.0%, holdout 250/5000 = 5.0% → +20% lift, CI clear of zero.
    prisma.incrementalityTest.findFirst.mockResolvedValue({
      id: 't1', workspaceId: 'ws-1', channel: 'META', entityId: 'ent-1', entityLevel: 'CAMPAIGN',
      exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250,
    });
    // Drive the real $transaction callback with a tx stub.
    const tx = {
      decision:            { create: vi.fn().mockResolvedValue({ id: 'dec-1' }) },
      incrementalityTest:  { update: vi.fn().mockResolvedValue({}) },
      decisionMemoryEntry: { create: vi.fn().mockResolvedValue({ id: 'mem-1' }) },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));

    const out = await concludeIncrementality('ws-1', 't1');
    expect(out.readout.conclusive).toBe(true);
    expect(out.readout.liftPct).toBeCloseTo(20, 1);
    expect(out.readout.confidenceLabel).toBe('MEDIUM'); // z≈2.19 → MODERATE band
    // Loop closed: holdout marked CONCLUDED + a memory entry written.
    const update = tx.incrementalityTest.update.mock.calls[0][0];
    expect(update.data.status).toBe('CONCLUDED');
    expect(update.data.liftPct).toBeCloseTo(20, 1);
    expect(tx.decisionMemoryEntry.create).toHaveBeenCalledOnce();
    expect(out.memoryId).toBe('mem-1');
    expect(out.decisionId).toBe('dec-1'); // confident + entity → a PROPOSED Decision
  });
});

describe('CP-03B Holdout lifecycle integrity', () => {
  const counts = { exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250 };

  it('refuses a repeated conclusion before another economics read, Decision or Memory', async () => {
    const row = runningHoldout();
    prisma.incrementalityTest.findFirst.mockResolvedValue(row);
    prisma.incrementalityTest.update.mockImplementation(async ({ data }) => Object.assign(row, data));
    await concludeIncrementality('ws-1', 't1');
    const frozen = { ...row };
    await expect(concludeIncrementality('ws-1', 't1')).rejects.toMatchObject({ code: 'HOLDOUT_CONFLICT' });
    expect(row).toEqual(frozen);
    expect(getEconomics).toHaveBeenCalledTimes(1);
    expect(prisma.decision.create).toHaveBeenCalledTimes(1);
    expect(prisma.decisionMemoryEntry.create).toHaveBeenCalledTimes(1);
  });

  for (const status of ['DESIGNED', 'CONCLUDED', 'ABANDONED']) {
    it(`refuses conclusion of ${status} even if populated counts look conclusive`, async () => {
      prisma.incrementalityTest.findFirst.mockResolvedValue(runningHoldout({ status }));
      await expect(concludeIncrementality('ws-1', 't1')).rejects.toMatchObject({ code: 'HOLDOUT_CONFLICT' });
      expect(getEconomics).not.toHaveBeenCalled();
      expect(prisma.incrementalityTest.update).not.toHaveBeenCalled();
      expect(prisma.decisionMemoryEntry.create).not.toHaveBeenCalled();
    });
  }
  for (const status of ['CONCLUDED', 'ABANDONED']) {
    it(`refuses ${status} metrics with a conflict and no write`, async () => {
      prisma.incrementalityTest.findFirst.mockResolvedValue(runningHoldout({ status }));
      await expect(recordCounts('ws-1', 't1', counts)).rejects.toMatchObject({ code: 'HOLDOUT_CONFLICT' });
      expect(prisma.incrementalityTest.updateMany).not.toHaveBeenCalled();
    });
  }

  for (const field of Object.keys(counts)) {
    for (const value of [-1, 0.5, NaN, Infinity, 2147483648, '1', null]) {
      it(`refuses input ${field}=${String(value)} before writing`, async () => {
        await expect(recordCounts('ws-1', 't1', { ...counts, [field]: value })).rejects.toThrow();
        expect(prisma.incrementalityTest.updateMany).not.toHaveBeenCalled();
      });
      it(`refuses invalid stored ${field}=${String(value)} before conclusion writes`, async () => {
        prisma.incrementalityTest.findFirst.mockResolvedValue(runningHoldout({ [field]: value }));
        await expect(concludeIncrementality('ws-1', 't1')).rejects.toThrow();
        expect(prisma.incrementalityTest.update).not.toHaveBeenCalled();
        expect(prisma.decision.create).not.toHaveBeenCalled();
        expect(prisma.decisionMemoryEntry.create).not.toHaveBeenCalled();
      });
    }
  }

  it('accepts int4 endpoints with the existing conversions-per-user invariant', async () => {
    await recordCounts('ws-1', 't1', { exposedUsers: 2147483647, exposedConversions: 2147483647, holdoutUsers: 2147483647, holdoutConversions: 0 });
    expect(prisma.incrementalityTest.updateMany).toHaveBeenCalledTimes(1);
    await expect(recordCounts('ws-1', 't1', { ...counts, holdoutConversions: 5001 })).rejects.toThrow(/cannot exceed/);
    expect(prisma.incrementalityTest.updateMany).toHaveBeenCalledTimes(1);
  });

  for (const operation of [recordCounts, concludeIncrementality]) {
    it(`${operation.name} refuses a foreign/missing owned read without writes`, async () => {
      prisma.incrementalityTest.findFirst.mockResolvedValue(null);
      await expect(operation('ws-1', 'foreign', counts)).rejects.toThrow(/not found/i);
      expect(prisma.incrementalityTest.updateMany).not.toHaveBeenCalled();
      expect(prisma.incrementalityTest.update).not.toHaveBeenCalled();
      expect(getEconomics).not.toHaveBeenCalled();
    });
  }

  for (const exposedConversions of [100, 3]) {
    it(`preserves memory-only behavior for negative/thin evidence (${exposedConversions})`, async () => {
      prisma.incrementalityTest.findFirst.mockResolvedValue(runningHoldout({ exposedConversions }));
      const out = await concludeIncrementality('ws-1', 't1');
      expect(out.readout.conclusive).toBe(false);
      expect(out.decisionId).toBeNull();
      expect(prisma.decision.create).not.toHaveBeenCalled();
      expect(prisma.decisionMemoryEntry.create).toHaveBeenCalledTimes(1);
    });
  }

  it('labels operator-entered counts as unverified and preserves monetary evidence limits', async () => {
    const out = await concludeIncrementality('ws-1', 't1');
    const memory = prisma.decisionMemoryEntry.create.mock.calls[0][0].data;
    expect(memory.rationale).toMatch(/operator-reported/i);
    expect(memory.rationale).toMatch(/not independently verified/i);
    expect(out.readout.rationale).toMatch(/operator-reported/i);
    expect(out.readout.rationale).toMatch(/not independently verified/i);
    expect(out.readout.monetary.reason).toBe('INCREMENTALITY_MONETARY_BASIS_UNPROVEN');
    expect(out.readout.incrementalRevenueMinor.value).toBeNull();
    expect(prisma.decision.create.mock.calls[0][0].data).toMatchObject({ status: 'PROPOSED', decisionClass: 'EXPERIMENT' });
  });
});
