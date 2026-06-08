import { describe, it, expect } from 'vitest';
import { approvalToEvent, APPROVAL_STATE } from './ApprovalService.js';

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
