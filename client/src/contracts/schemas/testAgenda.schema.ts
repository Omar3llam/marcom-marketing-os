/**
 * TestAgenda Schema — Phase 4 weekly testing agenda
 *
 * Mirrors the testGeneratorEngine output: a ranked list of hypothesis-
 * backed suggestions, each carrying the dimension, the signal to watch,
 * and the variant set to launch.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { EntityLevelSchema } from './entity.schema';
import { TestDimensionSchema } from './testExperiment.schema';

// A proposed variant within a suggestion (no counts yet — not launched).
export const TestSuggestionVariantSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
  isControl: z.boolean(),
});

export const TestSuggestionSchema = z.object({
  entityId: z.string().min(1),
  entityLevel: EntityLevelSchema.nullish(),
  name: z.string(),
  currency: z.string().default('USD'),
  dimension: TestDimensionSchema,
  metric: z.string(),
  hypothesis: z.string(),
  expectedSignal: z.string(),
  variants: z.array(TestSuggestionVariantSchema),
  priority: z.number(),
  severity: z.number().optional(),
  rationale: z.string().optional(),
});

export const TestAgendaSchema = z.array(TestSuggestionSchema);

export type TestSuggestionVariant = z.infer<typeof TestSuggestionVariantSchema>;
export type TestSuggestion = z.infer<typeof TestSuggestionSchema>;
export type TestAgenda = z.infer<typeof TestAgendaSchema>;
