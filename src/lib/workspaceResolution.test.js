import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./prisma.js', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../utils/logger.js', () => ({ logger: { error: vi.fn() } }));
import { prisma } from './prisma.js';
import { resolveWorkspaceId, WorkspaceUnavailableError } from './workspaceResolution.js';

beforeEach(() => vi.clearAllMocks());
describe('strict workspace resolution', () => {
  it('uses established context without a new read', async () => {
    expect(await resolveWorkspaceId({ workspaceId: 'ws' })).toBe('ws');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it.each([null, { workspaceId: null }])('a successful miss remains absence: %j', async (row) => {
    prisma.user.findUnique.mockResolvedValue(row);
    expect(await resolveWorkspaceId({ userId: 'uid' })).toBeNull();
  });
  it('retains the cause and source of a failed read instead of returning null', async () => {
    const cause = Object.assign(new Error('private DB error'), { code: 'P1001' });
    prisma.user.findUnique.mockRejectedValue(cause);
    await expect(resolveWorkspaceId({ userId: 'uid' })).rejects.toMatchObject({
      name: 'WorkspaceUnavailableError', source: 'USER_WORKSPACE', cause,
    });
    await expect(resolveWorkspaceId({ userId: 'uid' })).rejects.toBeInstanceOf(WorkspaceUnavailableError);
  });
});
