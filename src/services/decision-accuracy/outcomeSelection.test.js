// ============================================================
// R6 — "the current outcome" has ONE definition
// ============================================================
// Supersession only helps if every reader agrees on which row still stands. The
// predicate is a shared constant rather than four `supersededAt: null` literals
// for the reason decisionAccuracyHelpers gives about "actioned": the definition
// is the thing most likely to get stricter, and the copy that got missed would
// silently keep scoring retired results.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: { outcomeSnapshot: { findFirst: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import {
  CURRENT_OUTCOME_WHERE, CURRENT_OUTCOME_ORDER_BY, getCurrentOutcome,
} from './outcomeSelection.js';

const SELECT = { id: true, roasDelta: true };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.outcomeSnapshot.findFirst.mockResolvedValue({ id: 'out-2', roasDelta: 1.8 });
});

describe('R6 — the current-outcome predicate', () => {
  it('is "not superseded", and is frozen against mutation by a caller', () => {
    expect(CURRENT_OUTCOME_WHERE).toEqual({ supersededAt: null });
    expect(Object.isFrozen(CURRENT_OUTCOME_WHERE)).toBe(true);
    expect(CURRENT_OUTCOME_ORDER_BY).toEqual({ createdAt: 'desc' });
  });

  it('keeps the predicate AND the ordering — the second is a tie-break, not the definition', () => {
    // Ordering alone would be correct for every chain the writer produces, but
    // correct by accident: a repair script or a restored row could promote a
    // retired result. The predicate says what is true; the ordering settles what
    // a partial write could leave behind.
    expect(CURRENT_OUTCOME_WHERE.supersededAt).toBeNull();
    expect(CURRENT_OUTCOME_ORDER_BY.createdAt).toBe('desc');
  });
});

describe('getCurrentOutcome', () => {
  it('asks for the newest non-superseded row of one decision, in this workspace', async () => {
    const out = await getCurrentOutcome('ws-1', 'dec-1', { select: SELECT });
    expect(prisma.outcomeSnapshot.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', decisionId: 'dec-1', supersededAt: null },
      orderBy: { createdAt: 'desc' },
      select: SELECT,
    });
    expect(out).toEqual({ id: 'out-2', roasDelta: 1.8 });
  });

  it('cannot be asked across workspaces — the scope is a required argument', async () => {
    await expect(getCurrentOutcome('', 'dec-1', { select: SELECT })).rejects.toThrow(/workspaceId/);
    await expect(getCurrentOutcome('ws-1', '', { select: SELECT })).rejects.toThrow(/decisionId/);
    expect(prisma.outcomeSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an unprojected read — a new column would widen it silently', async () => {
    await expect(getCurrentOutcome('ws-1', 'dec-1')).rejects.toThrow(/select required/);
  });

  it('returns null when a decision has no outcome yet, and invents nothing', async () => {
    // Never `{}`, never a zeroed row. "Nobody has said what happened" is a state
    // the Proof Engine reads as PENDING_MATURATION or UNSCORABLE — both of which
    // it can only do if it receives the absence.
    prisma.outcomeSnapshot.findFirst.mockResolvedValue(null);
    expect(await getCurrentOutcome('ws-1', 'dec-1', { select: SELECT })).toBeNull();
  });
});
