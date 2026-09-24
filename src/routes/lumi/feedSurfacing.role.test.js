import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    stakeholderNarrative: { findFirst: vi.fn() },
    approvalRequest: { count: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { surfaceCollaboration } from './feedSurfacing.js';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.stakeholderNarrative.findFirst.mockResolvedValue(null);
  prisma.approvalRequest.count.mockResolvedValue(2);
});

describe('feed collaboration enrichment has no inferred role', () => {
  it.each([null, undefined, 'FUTURE_ROLE'])('omits enrichment for unresolved %s without a scoped read', async (role) => {
    expect(await surfaceCollaboration('ws1', role)).toBeNull();
    expect(prisma.stakeholderNarrative.findFirst).not.toHaveBeenCalled();
    expect(prisma.approvalRequest.count).not.toHaveBeenCalled();
  });

  it.each([
    ['STRATEGIST', 'STRATEGIST', 2],
    ['BUYER', 'BUYER', 0],
    ['CLIENT', 'LEADERSHIP', 0],
  ])('preserves %s audience and approval scope', async (role, audience, pendingApprovals) => {
    const surface = await surfaceCollaboration('ws1', role);
    expect(surface).toMatchObject({ role, pendingApprovals });
    expect(prisma.stakeholderNarrative.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: 'ws1', audience },
    }));
  });
});
