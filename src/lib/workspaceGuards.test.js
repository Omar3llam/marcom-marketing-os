// ============================================================
// workspaceGuards — the "don't strand a workspace" rules
// ------------------------------------------------------------
// A workspace with no effective strategist cannot invite, change roles, or
// execute. These tests pin the two halves that make the guard correct:
//   1. null collabRole COUNTS as a strategist (roleScope's convention)
//   2. the guard only fires when the user IS one and would STOP being one —
//      checking the target role alone blocks harmless BUYER→CLIENT changes.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma.js', () => ({ prisma: { user: { count: vi.fn() } } }));

import { prisma } from './prisma.js';
import {
  WORKSPACE_ROLES, isEffectiveStrategist, countEffectiveStrategists, canDowngradeStrategist,
} from './workspaceGuards.js';

beforeEach(() => vi.clearAllMocks());

describe('WORKSPACE_ROLES', () => {
  it('mirrors the Prisma WorkspaceRole enum, and is frozen', () => {
    expect(WORKSPACE_ROLES).toEqual(['STRATEGIST', 'BUYER', 'CLIENT']);
    expect(Object.isFrozen(WORKSPACE_ROLES)).toBe(true);
  });
});

describe('isEffectiveStrategist', () => {
  it('treats null and undefined as STRATEGIST (roleScope convention)', () => {
    expect(isEffectiveStrategist(null)).toBe(true);
    expect(isEffectiveStrategist(undefined)).toBe(true);
    expect(isEffectiveStrategist('STRATEGIST')).toBe(true);
  });

  it('is false for the other roles', () => {
    expect(isEffectiveStrategist('BUYER')).toBe(false);
    expect(isEffectiveStrategist('CLIENT')).toBe(false);
  });
});

describe('countEffectiveStrategists', () => {
  it('counts STRATEGIST OR null, excluding the target user', async () => {
    prisma.user.count.mockResolvedValue(2);
    await expect(countEffectiveStrategists('ws-1', 'u-1')).resolves.toBe(2);
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        id: { not: 'u-1' },
        OR: [{ collabRole: 'STRATEGIST' }, { collabRole: null }],
      },
    });
  });

  it('omits the exclusion when no user id is given', async () => {
    prisma.user.count.mockResolvedValue(3);
    await countEffectiveStrategists('ws-1');
    expect(prisma.user.count.mock.calls[0][0].where.id).toBeUndefined();
  });
});

describe('canDowngradeStrategist', () => {
  it('blocks the LAST strategist from being demoted', async () => {
    prisma.user.count.mockResolvedValue(0);
    await expect(canDowngradeStrategist('ws-1', 'u-1', 'STRATEGIST', 'BUYER'))
      .resolves.toEqual({ allowed: false, reason: 'LAST_STRATEGIST' });
  });

  it('allows the demotion when another strategist remains', async () => {
    prisma.user.count.mockResolvedValue(1);
    await expect(canDowngradeStrategist('ws-1', 'u-1', 'STRATEGIST', 'BUYER'))
      .resolves.toEqual({ allowed: true });
  });

  // A null-role user IS a strategist, so demoting them is the same risk.
  it('blocks demoting a NULL-role user when they are the last one', async () => {
    prisma.user.count.mockResolvedValue(0);
    await expect(canDowngradeStrategist('ws-1', 'u-1', null, 'BUYER'))
      .resolves.toEqual({ allowed: false, reason: 'LAST_STRATEGIST' });
  });

  // THE bug this signature exists to prevent: checking only the NEW role would
  // block this in a workspace with no strategists, though it removes nothing.
  it('never blocks a change that removes no strategist (BUYER → CLIENT)', async () => {
    prisma.user.count.mockResolvedValue(0); // zero strategists in the workspace
    await expect(canDowngradeStrategist('ws-1', 'u-1', 'BUYER', 'CLIENT'))
      .resolves.toEqual({ allowed: true });
    expect(prisma.user.count).not.toHaveBeenCalled(); // short-circuits, no query
  });

  it('never blocks a PROMOTION to strategist', async () => {
    prisma.user.count.mockResolvedValue(0);
    await expect(canDowngradeStrategist('ws-1', 'u-1', 'CLIENT', 'STRATEGIST'))
      .resolves.toEqual({ allowed: true });
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  // null as the NEW role means "effective strategist" — not a downgrade.
  it('treats a change TO null as staying a strategist', async () => {
    prisma.user.count.mockResolvedValue(0);
    await expect(canDowngradeStrategist('ws-1', 'u-1', 'STRATEGIST', null))
      .resolves.toEqual({ allowed: true });
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});
