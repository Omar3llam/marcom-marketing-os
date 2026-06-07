/**
 * NetworkInsight Schema — Phase 5 gated cross-account layer
 *
 * Mirrors the networkEngine output. The network is honest by
 * construction: insights are k-anonymity gated, carry an accuracy BAND
 * (never a point claim), and expose only an anonymized contributor COUNT
 * (never a workspace id). Below the gate it returns INSUFFICIENT_DATA;
 * un-opted workspaces get NOT_CONSENTED.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { PatternKindSchema } from './accountPattern.schema';

export const NetworkStatusSchema = z.enum(['OK', 'INSUFFICIENT_DATA', 'NOT_CONSENTED']);

// One gated cohort insight. `accuracyBand`/`holdRate` present only when OK.
export const NetworkInsightSchema = z.object({
  status: NetworkStatusSchema,
  cohortTag: z.string().optional(),
  kind: PatternKindSchema.optional(),
  metric: z.string().optional(),
  contributingWorkspaces: z.number().int().optional(), // anonymized count only
  needed: z.number().int().optional(),
  threshold: z.number().optional(),
  holdRate: z.number().optional(),
  accuracyBand: z.tuple([z.number(), z.number()]).optional(), // [lo, hi] — never a point
  statement: z.string().optional(),
});

export const NetworkResponseSchema = z.object({
  status: NetworkStatusSchema,
  cohortTag: z.string().optional(),
  insights: z.array(NetworkInsightSchema).optional(),
});

export type NetworkStatus = z.infer<typeof NetworkStatusSchema>;
export type NetworkInsight = z.infer<typeof NetworkInsightSchema>;
export type NetworkResponse = z.infer<typeof NetworkResponseSchema>;
