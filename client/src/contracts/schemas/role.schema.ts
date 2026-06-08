/**
 * Collaboration role + scope — the shared-surface gate
 *
 * Three roles work the same account with different stakes. The client reads
 * its FSM nav scope from RoleScope (GET /roles/me) so the gate is defined in
 * one place (the backend roleScope helper).
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

export const WorkspaceRoleSchema = z.enum(['STRATEGIST', 'BUYER', 'CLIENT']);

export const RoleScopeSchema = z.object({
  role: WorkspaceRoleSchema,
  visibleStates: z.array(z.string()),
});

export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;
export type RoleScope = z.infer<typeof RoleScopeSchema>;
