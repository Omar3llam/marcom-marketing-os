import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn() } }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {
  fatiguePrediction: { findFirst: vi.fn(), update: vi.fn() },
  decisionMemoryEntry: { create: vi.fn() },
  $queryRaw: vi.fn(), $transaction: vi.fn(),
} }));

import { prisma } from '../../lib/prisma.js';
import { resolvePrediction } from './FatiguePredictionService.js';

const projected = new Date('2026-10-20T00:00:00Z');
const row = (over = {}) => ({ id: 'prediction', workspaceId: 'owner', entityId: 'entity',
  metric: 'frequency', ceiling: 3.5, projectedBreachDate: projected, resolvedAt: null, ...over });
const resolve = (actualBreachDate = projected) => resolvePrediction({ predictionId: 'prediction', workspaceId: 'owner', actualBreachDate });

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$queryRaw.mockResolvedValue([{ id: 'prediction' }]);
  prisma.fatiguePrediction.findFirst.mockResolvedValue(row());
  prisma.fatiguePrediction.update.mockImplementation(async ({ data }) => row(data));
  prisma.decisionMemoryEntry.create.mockResolvedValue({ id: 'memory' });
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
});

describe('T2 / Fatigue resolution contract', () => {
  it('locks only the workspace-owned parent before the authoritative read', async () => {
    await resolve();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
    const [strings, id, workspace] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toMatch(/fatigue_predictions[\s\S]*"workspaceId"[\s\S]*FOR UPDATE/);
    expect([id, workspace]).toEqual(['prediction', 'owner']);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.fatiguePrediction.findFirst.mock.invocationCallOrder[0]);
    expect(prisma.fatiguePrediction.findFirst).toHaveBeenCalledWith({ where: { id: 'prediction', workspaceId: 'owner' } });
    expect(prisma.fatiguePrediction.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'prediction', workspaceId: 'owner' } }));
  });

  for (const [date, accuracy] of [[projected, 1], ['2026-10-22', 0.8], ['2026-10-30', 0], [null, null]]) {
    it(`preserves accuracy ${accuracy} and provenance without claiming durability (${date})`, async () => {
      const result = await resolve(date);
      expect(result.accuracy).toBe(accuracy);
      expect(result.actualBreachDate).toEqual(date ? new Date(date) : null);
      expect(prisma.decisionMemoryEntry.create).toHaveBeenCalledWith({ data: {
        workspaceId: 'owner', entityId: 'entity', actionType: 'FATIGUE_FORECAST',
        rationale: expect.stringContaining(date ? `accuracy ${accuracy}` : 'pre-empted by refresh'),
        isSustainable: null, impactDurationHrs: null,
      } });
    });
  }

  it('preserves the original resolution on repeat, without another Memory write', async () => {
    const original = row({ resolvedAt: projected, actualBreachDate: projected, accuracy: 1 });
    prisma.fatiguePrediction.findFirst.mockResolvedValue(original);
    expect(await resolve('2026-10-30')).toEqual(original);
    expect(prisma.fatiguePrediction.update).not.toHaveBeenCalled();
    expect(prisma.decisionMemoryEntry.create).not.toHaveBeenCalled();
  });

  it('refuses a missing or foreign parent before reading or writing its state', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(resolve()).rejects.toThrow('not found');
    expect(prisma.fatiguePrediction.findFirst).not.toHaveBeenCalled();
    expect(prisma.fatiguePrediction.update).not.toHaveBeenCalled();
    expect(prisma.decisionMemoryEntry.create).not.toHaveBeenCalled();
  });

  it('refuses an absent authoritative row and a missing workspace', async () => {
    prisma.fatiguePrediction.findFirst.mockResolvedValue(null);
    await expect(resolve()).rejects.toThrow('not found');
    await expect(resolvePrediction({ predictionId: 'prediction' })).rejects.toThrow('workspaceId required');
    expect(prisma.fatiguePrediction.update).not.toHaveBeenCalled();
  });

  it('propagates a Memory write failure to the transaction owner', async () => {
    prisma.decisionMemoryEntry.create.mockRejectedValue(new Error('Memory unavailable'));
    await expect(resolve()).rejects.toThrow('Memory unavailable');
  });
});
