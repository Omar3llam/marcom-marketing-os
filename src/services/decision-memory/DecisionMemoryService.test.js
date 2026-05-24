// ============================================================
// DecisionMemoryService — unit tests
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    decisionMemory: {
      create:   vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma }                from '../../lib/prisma.js';
import { decisionMemoryService } from './index.js';

const VALID_PAYLOAD = {
  workspaceId:  'ws-uuid-1',
  executionId:  'exec-cuid-1',
  correlationId: 'corr-abc',
  decisionType: 'PAUSE_CAMPAIGN',
  signalType:   'LOW_CTR',
  diagnosis:    'weak creative hook causing below-threshold CTR',
  actionTaken:  'paused campaign camp-7',
  outcome:      'improved_ctr',
  confidence:   0.87,
};

describe('recordDecisionMemory', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a DB row with serialized payload', async () => {
    prisma.decisionMemory.create.mockResolvedValueOnce({ id: 'mem-1', ...VALID_PAYLOAD });

    const result = await decisionMemoryService.recordDecisionMemory(VALID_PAYLOAD);

    expect(prisma.decisionMemory.create).toHaveBeenCalledOnce();
    const { data } = prisma.decisionMemory.create.mock.calls[0][0];
    expect(data.workspaceId).toBe('ws-uuid-1');
    expect(data.executionId).toBe('exec-cuid-1');
    expect(data.signalType).toBe('LOW_CTR');
    expect(data.confidence).toBe(0.87);
    expect(result.id).toBe('mem-1');
  });

  it('correlationId is null when omitted', async () => {
    const { correlationId: _, ...noCorr } = VALID_PAYLOAD;
    prisma.decisionMemory.create.mockResolvedValueOnce({ id: 'mem-2', ...noCorr, correlationId: null });

    await decisionMemoryService.recordDecisionMemory(noCorr);

    const { data } = prisma.decisionMemory.create.mock.calls[0][0];
    expect(data.correlationId).toBeNull();
  });

  it('throws when executionId is missing', async () => {
    const { executionId: _, ...bad } = VALID_PAYLOAD;
    await expect(decisionMemoryService.recordDecisionMemory(bad))
      .rejects.toThrow('executionId is required');
  });

  it('throws when signalType is missing', async () => {
    const { signalType: _, ...bad } = VALID_PAYLOAD;
    await expect(decisionMemoryService.recordDecisionMemory(bad))
      .rejects.toThrow('signalType is required');
  });

  it('throws when confidence is out of range', async () => {
    await expect(decisionMemoryService.recordDecisionMemory({ ...VALID_PAYLOAD, confidence: 1.5 }))
      .rejects.toThrow('confidence must be a number between 0 and 1');
  });

  it('throws when confidence is negative', async () => {
    await expect(decisionMemoryService.recordDecisionMemory({ ...VALID_PAYLOAD, confidence: -0.1 }))
      .rejects.toThrow('confidence must be a number between 0 and 1');
  });

  it('accepts boundary confidence values 0 and 1', async () => {
    prisma.decisionMemory.create.mockResolvedValue({ id: 'mem-x', ...VALID_PAYLOAD });
    await expect(decisionMemoryService.recordDecisionMemory({ ...VALID_PAYLOAD, confidence: 0 })).resolves.toBeDefined();
    await expect(decisionMemoryService.recordDecisionMemory({ ...VALID_PAYLOAD, confidence: 1 })).resolves.toBeDefined();
  });

  it('throws on DB failure', async () => {
    prisma.decisionMemory.create.mockRejectedValueOnce(new Error('DB down'));
    await expect(decisionMemoryService.recordDecisionMemory(VALID_PAYLOAD))
      .rejects.toThrow('DB down');
  });
});

describe('getRecentMemories', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('queries workspace-scoped rows in reverse-chronological order', async () => {
    prisma.decisionMemory.findMany.mockResolvedValueOnce([]);

    await decisionMemoryService.getRecentMemories('ws-uuid-1');

    expect(prisma.decisionMemory.findMany).toHaveBeenCalledWith({
      where:   { workspaceId: 'ws-uuid-1' },
      orderBy: { createdAt: 'desc' },
      take:    20,
    });
  });

  it('respects a custom limit', async () => {
    prisma.decisionMemory.findMany.mockResolvedValueOnce([]);

    await decisionMemoryService.getRecentMemories('ws-uuid-2', 5);

    expect(prisma.decisionMemory.findMany.mock.calls[0][0].take).toBe(5);
  });

  it('returns the rows returned by prisma', async () => {
    const rows = [
      { id: 'a', workspaceId: 'ws-uuid-1', outcome: 'improved_ctr' },
      { id: 'b', workspaceId: 'ws-uuid-1', outcome: 'no_change' },
    ];
    prisma.decisionMemory.findMany.mockResolvedValueOnce(rows);

    const result = await decisionMemoryService.getRecentMemories('ws-uuid-1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
  });
});
