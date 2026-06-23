/**
 * Inbox — the role+severity routed notification feed (Phase 8)
 *
 * The inbox is composed LIVE on the server (no table, no worker) from three
 * existing sources: routed alerts (radar verdicts), the latest stakeholder
 * narrative, and a strategist's pending approvals. This is the read contract
 * for GET /api/lumi/inbox. Lenient by design — a minor field drift on one
 * approval row must never blank the whole inbox.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

export const InboxAlertSchema = z.object({
  kind: z.string(),
  id: z.string().nullish(),
  verdict: z.string().nullish(),
  headline: z.string().nullish(),
  severity: z.string().nullish(),
}).passthrough();

export const InboxNarrativeSchema = z.object({
  id: z.string(),
  headline: z.string(),
  period: z.string().nullish(),
  confidenceScore: z.number().nullish(),
  createdAt: z.union([z.string(), z.date()]).nullish(),
}).passthrough();

// A projection of an ApprovalRequest — only what the inbox row needs. Lenient
// so a null requestedById (or any extra column) never fails the envelope.
export const InboxApprovalSchema = z.object({
  id: z.string(),
  planId: z.string().nullish(),
  subjectType: z.string().nullish(),
  subjectId: z.string().nullish(),
  state: z.string().nullish(),
  createdAt: z.union([z.string(), z.date()]).nullish(),
}).passthrough();

export const InboxResponseSchema = z.object({
  workspaceId: z.string().nullable(),
  role: z.string(),
  alerts: z.array(InboxAlertSchema).default([]),
  severity: z.record(z.string(), z.number()).optional(),
  latestNarrative: InboxNarrativeSchema.nullish(),
  pendingApprovals: z.array(InboxApprovalSchema).default([]),
});

export type InboxAlert = z.infer<typeof InboxAlertSchema>;
export type InboxNarrative = z.infer<typeof InboxNarrativeSchema>;
export type InboxApproval = z.infer<typeof InboxApprovalSchema>;
export type InboxResponse = z.infer<typeof InboxResponseSchema>;
