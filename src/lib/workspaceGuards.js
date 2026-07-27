// ============================================================
// MARCOM — workspace membership guards (shared)
// ------------------------------------------------------------
// The "don't strand a workspace" rules, in ONE place. They were previously
// inline in src/routes/team/index.js; the admin panel now enforces the same
// rules, and two copies of a guard is how the two copies drift apart.
//
// The null⇒STRATEGIST convention is the subtle part: `collabRole` is nullable
// and roleScope treats null as STRATEGIST, so a null-role user IS an effective
// strategist and must be counted as one. A guard that only counts the literal
// 'STRATEGIST' string under-counts and blocks legitimate changes.
// ============================================================
import { prisma } from './prisma.js';

/** The assignable workspace roles. Mirrors the Prisma `WorkspaceRole` enum. */
export const WORKSPACE_ROLES = Object.freeze(['STRATEGIST', 'BUYER', 'CLIENT']);

/** True when this role value leaves the user an effective strategist (null counts). */
export const isEffectiveStrategist = (collabRole) => (collabRole ?? 'STRATEGIST') === 'STRATEGIST';

/**
 * How many effective strategists the workspace would still have if
 * `excludeUserId` were not one. Counts collabRole 'STRATEGIST' OR null.
 */
export function countEffectiveStrategists(workspaceId, excludeUserId) {
  return prisma.user.count({
    where: {
      workspaceId,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      OR: [{ collabRole: 'STRATEGIST' }, { collabRole: null }],
    },
  });
}

/**
 * May this role change proceed without stranding the workspace?
 *
 * A workspace with no strategist cannot invite, change roles, or execute — it
 * is unrecoverable without a DB edit. So the LAST effective strategist may not
 * be demoted.
 *
 * BOTH sides matter: the change is only dangerous when the user IS currently an
 * effective strategist AND would stop being one. Checking the target role alone
 * would block a BUYER→CLIENT change in a workspace that happens to have no
 * strategist — a change that removes nothing.
 *
 * @returns {Promise<{allowed: true} | {allowed: false, reason: 'LAST_STRATEGIST'}>}
 */
export async function canDowngradeStrategist(workspaceId, userId, currentRole, newRole) {
  if (!isEffectiveStrategist(currentRole)) return { allowed: true }; // wasn't one
  if (isEffectiveStrategist(newRole)) return { allowed: true };      // still is one

  const remaining = await countEffectiveStrategists(workspaceId, userId);
  return remaining === 0 ? { allowed: false, reason: 'LAST_STRATEGIST' } : { allowed: true };
}
