/**
 * Campaign Schema — Campaign health contracts
 *
 * Validates campaign data from backend responses.
 * Ensures type-safe campaign stages and alert aggregation.
 *
 * @example
 * ```ts
 * import { CampaignSchema } from '@/contracts/schemas';
 *
 * const result = CampaignSchema.safeParse(payload);
 * if (result.success) {
 *   useCampaign(result.data);
 * }
 * ```
 */

import { z } from 'zod';
import { AlertSchema } from './alert.schema';

/**
 * Campaign health stage
 *
 * - DYING: Campaign performance critically poor
 * - FATIGUED: Audience saturation detected
 * - TESTING: Initial testing phase
 * - SCALING: Performance improving, ready to scale
 * - STABLE: Healthy performance, maintenance mode
 */
export const CampaignStageSchema = z.enum([
  'DYING',
  'FATIGUED',
  'TESTING',
  'SCALING',
  'STABLE',
]);

/**
 * Campaign schema
 *
 * Represents a single campaign with health assessment:
 * - campaign_id: Meta campaign ID
 * - campaign_name: Human-readable campaign name (optional)
 * - stage: Current health stage
 * - alerts: Array of alerts/recommendations for this campaign
 */
export const CampaignSchema = z.object({
  campaign_id: z.string().min(1, 'Campaign ID required'),
  campaign_name: z.string().optional(),
  stage: CampaignStageSchema,
  alerts: z.array(AlertSchema),
});

/**
 * Type inference from schemas
 */
export type CampaignStage = z.infer<typeof CampaignStageSchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
