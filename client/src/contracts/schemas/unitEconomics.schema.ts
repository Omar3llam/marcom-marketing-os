/**
 * UnitEconomics Schema — LTV / payback / contribution margin (Phase 6)
 *
 * Mirrors unitEconomicsEngine.computeUnitEconomics() + the persisted
 * AccountEconomics row. The sustainability verdict is itself a RANGE
 * (HEALTHY at expected CAC, THIN at the pessimistic end) — never a single
 * overconfident stamp. Money is integer minor units.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { RangeSchema } from './scenario.schema';

export const SustainabilityBandSchema = z.enum(['HEALTHY', 'THIN', 'UNDERWATER']);

// The band per range-end: best/expected/worst CAC → band.
export const SustainabilityBandRangeSchema = z.object({
  low: SustainabilityBandSchema.nullable(),
  expected: SustainabilityBandSchema.nullable(),
  high: SustainabilityBandSchema.nullable(),
});

// Persisted AccountEconomics row.
export const AccountEconomicsSchema = z.object({
  workspaceId: z.string().min(1),
  currency: z.string().default('USD'),
  aovMinor: z.number().int().positive(),
  grossMarginPct: z.number().min(0).max(1),
  repeatRate: z.number().min(0),
  avgOrdersPerCustomer: z.number().min(1),
  targetLtvToCac: z.number().positive(),
});

// computeUnitEconomics() output.
export const UnitEconomicsSchema = z.object({
  contributionPerOrderMinor: z.number().int(),
  ltvMinor: z.number().int(),
  paybackOrders: z.number().int().nullable(),
  ltvToCac: RangeSchema,
  sustainabilityBand: SustainabilityBandRangeSchema,
  sustainable: z.boolean(),
  assumptions: z.array(z.string()),
  currency: z.string().default('USD'),
});

export type SustainabilityBand = z.infer<typeof SustainabilityBandSchema>;
export type AccountEconomics = z.infer<typeof AccountEconomicsSchema>;
export type UnitEconomics = z.infer<typeof UnitEconomicsSchema>;
