/**
 * Attribution Schema — credit assignment per channel (Phase 7)
 *
 * Mirrors attributionEngine.attributeCredit(). Path-based models honestly
 * return INSUFFICIENT_DATA when no journey data exists; the causal model is
 * INCREMENTALITY_WEIGHTED (NOT Google path-based DDA). Every credited figure
 * is an Attributed wrapper.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { AttributedSchema } from './attributed.schema';

export const AttributionModelSchema = z.enum([
  'FIRST_TOUCH',
  'LAST_TOUCH',
  'LINEAR',
  'POSITION_BASED',
  'INCREMENTALITY_WEIGHTED',
]);
export const AttributionStatusSchema = z.enum(['OK', 'INSUFFICIENT_DATA']);

export const AttributionChannelSchema = z.object({
  channelId: z.string(),
  channel: z.string().nullish(),
  creditedConversions: AttributedSchema,
  creditedRevenueMinor: AttributedSchema,
});

export const AttributionResultSchema = z.object({
  model: AttributionModelSchema,
  status: AttributionStatusSchema,
  channels: z.array(AttributionChannelSchema).optional(), // absent when INSUFFICIENT_DATA
  totalRevenueMinor: AttributedSchema.optional(),
  caveat: z.string().nullish(),
  reason: z.string().nullish(), // why dark, when INSUFFICIENT_DATA
});

export type AttributionModel = z.infer<typeof AttributionModelSchema>;
export type AttributionStatus = z.infer<typeof AttributionStatusSchema>;
export type AttributionResult = z.infer<typeof AttributionResultSchema>;
