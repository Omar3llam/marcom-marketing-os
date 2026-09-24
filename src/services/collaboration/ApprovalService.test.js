import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: { collaborationEvent: { create: vi.fn() } },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { approvalToEvent, APPROVAL_STATE, decideApproval, handoff } from './ApprovalService.js';

describe('approval authority fails closed before persistence', () => {
  it.each([null, undefined, 'FUTURE_ROLE'])('refuses unresolved approver %s', async (approverRole) => {
    await expect(decideApproval('ws1', { requestId: 'r1', decision: APPROVAL_STATE.APPROVED, approverRole }))
      .rejects.toMatchObject({ code: 'RoleForbidden' });
    expect(prisma.collaborationEvent.create).not.toHaveBeenCalled();
  });
});

describe('approvalToEvent (pure)', () => {
  const request = { id: 'req1', subjectType: 'PLAN', subjectId: 'plan1', planId: 'plan1' };

  it('maps an approval decision to a CollaborationEvent shape', () => {
    const ev = approvalToEvent({ workspaceId: 'ws1', approverId: 'u1', request, decision: APPROVAL_STATE.APPROVED });
    expect(ev.type).toBe('APPROVAL_DECIDED');
    expect(ev.subjectId).toBe('plan1');
    expect(ev.actorId).toBe('u1');
    expect(ev.detail).toMatchObject({ requestId: 'req1', decision: 'APPROVED', planId: 'plan1' });
  });

  it('requires a workspaceId', () => {
    expect(() => approvalToEvent({ request, decision: 'APPROVED' })).toThrow();
  });
});

describe('handoff authority validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.collaborationEvent.create.mockImplementation(async ({ data }) => ({ id: 'event-1', ...data }));
  });

  it.each([
    ['UNKNOWN', 'BUYER'],
    [null, 'BUYER'],
    ['BUYER', 'UNKNOWN'],
    ['BUYER', null],
  ])('refuses unknown transition %s→%s without writing an event', async (fromRole, toRole) => {
    await expect(handoff('workspace-1', { subjectId: 'decision-1', fromRole, toRole, actorId: 'user-1' }))
      .rejects.toMatchObject({ code: 'RoleForbidden' });
    expect(prisma.collaborationEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    ['STRATEGIST', 'BUYER'],
    ['BUYER', 'STRATEGIST'],
  ])('persists the validated legal transition %s→%s', async (fromRole, toRole) => {
    await handoff('workspace-1', { subjectId: 'decision-1', fromRole, toRole, actorId: 'user-1' });

    expect(prisma.collaborationEvent.create).toHaveBeenCalledOnce();
    expect(prisma.collaborationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromRole, toRole }),
    });
  });
});
