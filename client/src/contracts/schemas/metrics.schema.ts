/**
 * Metrics Schema — Campaign health metric contracts
 *
 * Validates metric data from backend responses.
 * Ensures type-safe metric status, trends, and values.
 *
 * @example
 * ```ts
 * import { MetricSchema } from '@/contracts/schemas';
 *
 * const result = MetricSchema.safeParse(payload);
 * if (result.success) {
 *   useMetric(result.data);
 * }
 * ```
 */

import { z } from 'zod';

/**
 * Metric trend direction
 */
export const MetricTrendSchema = z.enum(['up', 'down', 'flat']);

/**
 * Metric status classification
 */
export const MetricStatusSchema = z.enum(['danger', 'warning', 'neutral', 'positive']);

/**
 * Campaign metric schema
 *
 * Represents a single campaign health metric with:
 * - metric: Metric name (e.g., 'CPC', 'CTR', 'ROAS')
 * - trend: Direction of change (up, down, flat)
 * - value: Current value with formatting (e.g., '$2.34', '1.2%')
 * - delta: Change amount (e.g., '+15%', '-0.3$')
 * - context: Contextual explanation (e.g., 'vs. last 7 days')
 * - status: Health classification (danger, warning, neutral, positive)
 */
export const MetricSchema = z.object({
  metric: z.string().min(1, 'Metric name required'),
  trend: MetricTrendSchema,
  value: z.string(),
  delta: z.string(),
  context: z.string(),
  status: MetricStatusSchema,
});

/**
 * Type inference from schemas
 *
 * Source of truth: Schemas (runtime validation)
 * Derived: TypeScript types (compile-time checking)
 */
export type MetricTrend = z.infer<typeof MetricTrendSchema>;
export type MetricStatus = z.infer<typeof MetricStatusSchema>;
export type Metric = z.infer<typeof MetricSchema>;
