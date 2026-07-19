/**
 * Scenario Schema — forward-looking what-if projections (Phase 6)
 *
 * Mirrors scenarioEngine.projectScenario(). THE HONESTY RULE is encoded
 * here: every projection is a RANGE { low, expected, high }, never a bare
 * number, plus a named `assumptions[]` list. CAC/Volume/MER answer the
 * media-buyer question; revenue + grossProfit are first-class (the CEO
 * lens). Money is integer minor units.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

export const ScenarioTypeSchema = z.enum([
  'CHANNEL_REALLOCATION',
  'BUDGET_EXPANSION',
  'BUDGET_CONTRACTION',
]);

// The honesty primitive — a projection is ALWAYS a range, never a point.
export const RangeSchema = z.object({
  low: z.number().nullable(),
  expected: z.number().nullable(),
  high: z.number().nullable(),
});

export const ScenarioProjectionsSchema = z.object({
  blendedCacMinor: RangeSchema,
  volume: RangeSchema,
  revenueMinor: RangeSchema,
  grossProfitMinor: RangeSchema,
  merAfter: RangeSchema,
});

export const ScenarioSchema = z.object({
  scenarioType: ScenarioTypeSchema,
  change: z.record(z.string(), z.unknown()),
  currency: z.string().default('USD'),
  projections: ScenarioProjectionsSchema,
  assumptions: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  basis: z.string(),
  // Whether the workspace has ASSERTED its unit economics. When 'NOT_CONFIGURED'
  // the AOV/margin-dependent projections (volume, blendedCacMinor, grossProfitMinor)
  // are honestly blanked to null ranges — never computed off the seeded default AOV.
  // Optional so older/cached payloads still parse; a missing value reads as CONFIGURED.
  economicsStatus: z.enum(['CONFIGURED', 'NOT_CONFIGURED']).optional(),
  // ScenarioService decorates the engine output with the patterns leaned on.
  memoryBasis: z
    .array(
      z.object({
        patternId: z.string(),
        kind: z.string(),
        statement: z.string(),
        accuracy: z.number().nullable(),
      }),
    )
    .optional(),
});

// API response envelope: POST /api/lumi/scenario → { workspaceId, scenario|null }.
// scenario is null (with a message) when there's no channel data to project.
export const ScenarioResponseSchema = z.object({
  workspaceId: z.string().nullable(),
  generatedAt: z.string().nullish(),
  scenario: ScenarioSchema.nullable(),
  message: z.string().nullish(),
});

export type ScenarioType = z.infer<typeof ScenarioTypeSchema>;
export type Range = z.infer<typeof RangeSchema>;
export type ScenarioProjections = z.infer<typeof ScenarioProjectionsSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioResponse = z.infer<typeof ScenarioResponseSchema>;
