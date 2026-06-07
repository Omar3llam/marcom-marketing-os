/**
 * Briefing Schema — Phase 5 "what Lumi has learned about this account"
 *
 * The GET /api/lumi/briefing response: the workspace's learned patterns
 * (truth-weighted), the count promotable to rules in one tap, any
 * conflicts needing review, and the gated network panel.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { AccountPatternSchema } from './accountPattern.schema';
import { NetworkResponseSchema } from './networkInsight.schema';

export const BriefingSchema = z.object({
  workspaceId: z.string().nullable(),
  generatedAt: z.string().optional(),
  patterns: z.array(AccountPatternSchema),
  promotableCount: z.number().int(),
  conflicts: z.array(AccountPatternSchema).default([]),
  network: NetworkResponseSchema,
});

export type Briefing = z.infer<typeof BriefingSchema>;
