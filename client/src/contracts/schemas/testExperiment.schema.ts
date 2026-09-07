/**
 * TestExperiment Schema — Phase 4 Testing OS
 *
 * Mirrors the Prisma `TestExperiment` + `TestVariant`. A test is the
 * unit of the closed loop: proposed by the generator, run by the buyer,
 * and CONCLUDED by the readout — which writes the outcome to memory and
 * (when confident + governance-valid) links a REFRESH/SCALE Decision.
 * Money is integer minor units.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { EntityLevelSchema } from './entity.schema';

export const TestDimensionSchema = z.enum(['HOOK', 'OFFER', 'AUDIENCE', 'CREATIVE_ANGLE']);
export const TestStatusSchema    = z.enum(['PROPOSED', 'RUNNING', 'CONCLUDED', 'ABANDONED']);
export const TestMetricSchema    = z.enum(['CTR', 'CVR', 'ROAS', 'CPA']);
export const ConfidenceLabelSchema = z.enum(['HIGH', 'MODERATE', 'LOW', 'INCONCLUSIVE']);

// One arm of a test (control or challenger) with its raw counts.
export const TestVariantSchema = z.object({
  id: z.string().min(1),
  testId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(''),
  isControl: z.boolean().default(false),
  metaEntityId: z.string().nullish(),
  metaLevel: z.string().nullish(),
  impressions: z.number().int().default(0),
  clicks: z.number().int().default(0),
  conversions: z.number().int().default(0),
  spendMinor: z.number().int().default(0),
  revenueMinor: z.number().int().default(0),
  isWinner: z.boolean().default(false),
  createdAt: z.coerce.date().optional(),
});

// Persisted Prisma TestExperiment row (with variants when included).
export const TestExperimentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  entityId: z.string().nullish(),
  entityLevel: EntityLevelSchema.nullish(),
  dimension: TestDimensionSchema,
  hypothesis: z.string(),
  metric: z.string(),
  expectedSignal: z.string(),
  priority: z.number().default(0),
  status: TestStatusSchema,
  currency: z.string().default('USD'),
  startedAt: z.coerce.date().nullish(),
  concludedAt: z.coerce.date().nullish(),
  winnerLabel: z.string().nullish(),
  lift: z.number().nullish(),
  confidence: z.number().nullish(),
  confidenceLabel: z.string().nullish(),
  sampleNote: z.string().nullish(),
  decisionId: z.string().nullish(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  variants: z.array(TestVariantSchema).optional(),
});

export type TestDimension = z.infer<typeof TestDimensionSchema>;
export type TestStatus = z.infer<typeof TestStatusSchema>;
export type TestMetric = z.infer<typeof TestMetricSchema>;
export type ConfidenceLabel = z.infer<typeof ConfidenceLabelSchema>;
export type TestVariant = z.infer<typeof TestVariantSchema>;
export type TestExperiment = z.infer<typeof TestExperimentSchema>;

// B8-05 — the by-id read's envelope for `GET /api/lumi/tests/:id`, which
// answers `{ workspaceId, test }` with the variants included. The arms are the
// experiment's evidence (B7-04), so they are part of the contract, not an extra.
export const TestExperimentDetailResponseSchema = z.object({
  workspaceId: z.string(),
  test: TestExperimentSchema,
});
export type TestExperimentDetailResponse = z.infer<typeof TestExperimentDetailResponseSchema>;
