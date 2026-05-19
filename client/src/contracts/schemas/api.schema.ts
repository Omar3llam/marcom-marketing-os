/**
 * API Schema — Top-level API response contracts
 *
 * Validates API endpoint responses.
 * Ensures type-safe feed data and workspace context.
 *
 * @example
 * ```ts
 * import { LumiFeedResponseSchema } from '@/contracts/schemas';
 *
 * const result = LumiFeedResponseSchema.safeParse(payload);
 * if (result.success) {
 *   console.log(result.data.campaigns.length);
 *   console.log(result.data.generatedAt);
 * }
 * ```
 */

import { z } from 'zod';
import { CampaignSchema } from './campaign.schema';

/**
 * Lumi Feed Response schema
 *
 * GET /api/lumi/feed
 *
 * Contains:
 * - schemaVersion: Contract version (semver) for drift detection
 * - workspaceId: Current workspace ID
 * - generatedAt: ISO timestamp when feed was generated
 * - campaigns: Array of campaigns with alerts
 */
export const LumiFeedResponseSchema = z.object({
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Invalid semver format').optional().default('2.1.0'),
  workspaceId: z.string().min(1, 'Workspace ID required'),
  generatedAt: z.string().datetime('Invalid ISO timestamp'),
  campaigns: z.array(CampaignSchema),
});

/**
 * Generic error response schema
 *
 * Standard error response shape for API endpoints
 */
export const ErrorResponseSchema = z.object({
  status: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});

/**
 * Type inference from schemas
 */
export type LumiFeedResponse = z.infer<typeof LumiFeedResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
