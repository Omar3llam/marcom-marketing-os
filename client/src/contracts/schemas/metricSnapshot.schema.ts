/**
 * MetricSnapshot Schema — numeric time-series contract
 *
 * Mirrors the Phase 1 Prisma `MetricSnapshot`. Money is stored as
 * integer minor units (never a pre-formatted string); ratios are
 * plain floats. `source` (metric origin) is intentionally distinct
 * from the entity's `channel`, and `granularity` carries the time
 * grain so Conversion Truth + multi-grain rollups need no rebuild.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { EntityLevelSchema } from './entity.schema';

/** Origin of a metric — may differ from the entity's channel. */
export const DataSourceSchema = z.enum([
  'META',
  'GOOGLE',
  'TIKTOK',
  'SNAP',
  'LINKEDIN',
  'GA4',
  'SHOPIFY',
  'MANUAL',
]);

/** Time grain of a snapshot row. */
export const GranularitySchema = z.enum(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']);

export const MetricSnapshotSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  entityId: z.string().min(1),
  entityLevel: EntityLevelSchema,
  date: z.coerce.date(),
  source: DataSourceSchema,
  granularity: GranularitySchema.default('DAILY'),

  // Money — integer minor units.
  spendMinor: z.number().int(),
  revenueMinor: z.number().int(),
  cpaMinor: z.number().int().nullish(),

  // Counters.
  impressions: z.number().int(),
  clicks: z.number().int(),
  conversions: z.number().int(),

  // Ratios (not money) — plain floats.
  ctr: z.number().nullish(),
  roas: z.number().nullish(),
  frequency: z.number().nullish(),

  currency: z.string().min(3).max(3),
});

export type DataSource = z.infer<typeof DataSourceSchema>;
export type Granularity = z.infer<typeof GranularitySchema>;
export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;
