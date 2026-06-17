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
    incrementalityTest:  { findFirst: vi.fn(), update: vi.fn() },
    $transaction:        vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma.js';
import { getEconomics } from '../unit-economics/EconomicsService.js';
import { incrementalityToMemory, recordCounts, concludeIncrementality } from './IncrementalityService.js';

beforeEach(() => {
  vi.clearAllMocks();
  getEconomics.mockResolvedValue({ economics: { aovMinor: 5000, currency: 'USD' } });
});

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
  it('persists the four counters and transitions to RUNNING', async () => {
    prisma.incrementalityTest.findFirst.mockResolvedValue({ id: 't1', workspaceId: 'ws-1', status: 'DESIGNED', startedAt: null });
    prisma.incrementalityTest.update.mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data }));

    const out = await recordCounts('ws-1', 't1', { exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250 });
    expect(out.status).toBe('RUNNING');
    expect(out.exposedConversions).toBe(300);
    expect(out.startedAt).toBeInstanceOf(Date);
    const arg = prisma.incrementalityTest.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 't1' });
  });

  it('rejects conversions greater than users (impossible measurement)', async () => {
    await expect(recordCounts('ws-1', 't1', { exposedUsers: 100, exposedConversions: 101, holdoutUsers: 100, holdoutConversions: 10 }))
      .rejects.toThrow(/exposedConversions cannot exceed exposedUsers/);
    expect(prisma.incrementalityTest.update).not.toHaveBeenCalled();
  });

  it('rejects negative / non-integer counts', async () => {
    await expect(recordCounts('ws-1', 't1', { exposedUsers: -1, exposedConversions: 0, holdoutUsers: 10, holdoutConversions: 0 }))
      .rejects.toThrow(/non-negative integer/);
  });

  it('refuses to mutate a CONCLUDED holdout (counts are immutable)', async () => {
    prisma.incrementalityTest.findFirst.mockResolvedValue({ id: 't1', workspaceId: 'ws-1', status: 'CONCLUDED' });
    await expect(recordCounts('ws-1', 't1', { exposedUsers: 1, exposedConversions: 1, holdoutUsers: 1, holdoutConversions: 1 }))
      .rejects.toThrow(/immutable/);
    expect(prisma.incrementalityTest.update).not.toHaveBeenCalled();
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
