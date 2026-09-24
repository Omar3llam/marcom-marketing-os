import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    stakeholderNarrative: { findFirst: vi.fn() },
    approvalRequest: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { inboxFor } from './InboxService.js';

describe('Inbox composition requires an identified seat', () => {
  it.each([null, undefined, 'FUTURE_ROLE'])('rejects %s before reading strategist content', async (role) => {
    await expect(inboxFor('ws1', role)).rejects.toThrow('resolved collaboration role required');
    expect(prisma.stakeholderNarrative.findFirst).not.toHaveBeenCalled();
    expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
  });
});
