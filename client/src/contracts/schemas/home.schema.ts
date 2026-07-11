/**
 * Agent home — the unified two-band home payload (Phase 9)
 *
 * One fetch serves both altitudes: the buyer band ("what needs a decision
 * today") and the strategist band ("how the portfolio tracks to goal"), plus
 * the closed-loop status. A CLIENT role gets no buyer band (null).
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { AgendaItemSchema } from './agenda.schema';
import { LoopStatusSchema } from './loop.schema';
import { WorkspaceRoleSchema } from './role.schema';

export const AgendaBandViewSchema = z.object({
  title: z.string(),
  items: z.array(AgendaItemSchema),
  count: z.number(),
  empty: z.boolean(),
});

export const AgentHomeSchema = z.object({
  role: WorkspaceRoleSchema,
  summary: z.string(),
  buyerBand: AgendaBandViewSchema.nullable(), // null for a CLIENT
  strategistBand: AgendaBandViewSchema,
  loop: LoopStatusSchema,
  aiInsight: z.string().nullable().optional(), // pre-generated briefing paragraph
});

export type AgendaBandView = z.infer<typeof AgendaBandViewSchema>;
export type AgentHome = z.infer<typeof AgentHomeSchema>;
