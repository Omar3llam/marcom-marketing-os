/**
 * Approvals & handoffs — the audited collaboration layer
 *
 * A plan/reallocation can require a strategist sign-off before a buyer
 * executes it; every request, decision, and handoff writes a
 * CollaborationEvent. These schemas validate that boundary.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { WorkspaceRoleSchema } from './role.schema';

export const ApprovalStateSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  planId: z.string().nullish(),
  subjectType: z.string(),
  subjectId: z.string(),
  requestedById: z.string(),
  state: ApprovalStateSchema,
  decidedById: z.string().nullish(),
  reason: z.string().nullish(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  decidedAt: z.union([z.string(), z.date()]).nullish(),
});

export const CollaborationEventTypeSchema = z.enum([
  'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'HANDOFF', 'NARRATIVE_GENERATED',
]);

export const HandoffSchema = z.object({
  subjectType: z.string(),
  subjectId: z.string(),
  fromRole: WorkspaceRoleSchema,
  toRole: WorkspaceRoleSchema,
  note: z.string().nullish(),
});

export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type CollaborationEventType = z.infer<typeof CollaborationEventTypeSchema>;
export type Handoff = z.infer<typeof HandoffSchema>;
