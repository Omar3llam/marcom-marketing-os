/**
 * Lumi Feed Adapter — Validate and normalize feed responses
 *
 * Transforms raw backend responses into clean domain data:
 * - Runtime validation via Zod schemas
 * - Normalization (defaults, formatting, snake_case → camelCase if needed)
 * - Error wrapping with ParsingError
 * - Result pattern for controlled error handling
 *
 * @example
 * ```ts
 * import { parseLumiFeed } from '@/contracts/adapters';
 *
 * const result = parseLumiFeed(rawPayload);
 * if (!result.success) {
 *   track('contract_drift', { error: result.error });
 *   return <ErrorView error={result.error} />;
 * }
 *
 * // Guaranteed valid data
 * const feed: LumiFeedResponse = result.data;
 * ```
 */

import { LumiFeedResponseSchema, type LumiFeedResponse } from '../schemas';
import { ParsingError } from '../errors';
import { success, failure, type Result } from '../result/Result';
import { checkVersionCompatibility, CURRENT_VERSION } from '../registry';

/**
 * Parse and validate Lumi feed response
 *
 * @param payload - Raw response from /api/lumi/feed
 * @returns Result with validated data or parsing error
 */
export function parseLumiFeed(payload: unknown): Result<LumiFeedResponse> {
  // Check schema version compatibility BEFORE validation
  const payloadWithVersion = payload as { schemaVersion?: string };
  const versionCheck = checkVersionCompatibility(payloadWithVersion.schemaVersion);

  // Track version compatibility issues
  if (versionCheck.warning) {
    // Import telemetry dynamically to avoid circular dependencies
    import('../telemetry/contractDrift')
      .then(({ trackVersionMismatch }) => {
        trackVersionMismatch({
          expected: CURRENT_VERSION,
          received: payloadWithVersion.schemaVersion || 'missing',
          endpoint: '/api/lumi/feed',
          isSupported: versionCheck.isSupported,
          isDeprecated: versionCheck.isDeprecated,
          warning: versionCheck.warning,
        });
      })
      .catch(() => {
        // Telemetry failure should not block parsing
      });
  }

  // Fail fast if version is unsupported
  if (!versionCheck.isSupported) {
    return failure(
      new ParsingError({
        message: `Unsupported contract version: ${versionCheck.warning}`,
        issues: [],
        endpoint: '/api/lumi/feed',
        schema: 'LumiFeedResponseSchema',
        fallbackAction: 'Check for client updates or contact support',
      })
    );
  }

  // Validate against schema
  const result = LumiFeedResponseSchema.safeParse(payload);

  if (!result.success) {
    return failure(
      new ParsingError({
        message: 'Invalid Lumi feed response format',
        issues: result.error.issues,
        endpoint: '/api/lumi/feed',
        schema: 'LumiFeedResponseSchema',
        fallbackAction: 'Retry feed sync or contact support if issue persists',
      })
    );
  }

  // Normalize data (apply defaults, transformations)
  const normalized = normalizeLumiFeed(result.data);

  return success(normalized);
}

/**
 * Normalize feed data
 *
 * Apply transformations and defaults to ensure clean UI data:
 * - Ensure generatedAt is valid ISO string
 * - Sort campaigns by stage priority (DYING > FATIGUED > ...)
 * - Sort alerts by priority (HIGH > MEDIUM > LOW)
 * - Filter out empty alerts arrays
 *
 * @param data - Validated feed data
 * @returns Normalized feed data
 */
function normalizeLumiFeed(data: LumiFeedResponse): LumiFeedResponse {
  // Ensure generatedAt is valid (fallback to now if missing)
  const generatedAt = data.generatedAt || new Date().toISOString();

  // Sort campaigns by stage priority
  const stagePriority = {
    DYING: 1,
    FATIGUED: 2,
    TESTING: 3,
    SCALING: 4,
    STABLE: 5,
  };

  const sortedCampaigns = [...data.campaigns]
    .sort((a, b) => stagePriority[a.stage] - stagePriority[b.stage])
    .filter((c) => c.alerts.length > 0) // Only campaigns with alerts
    .map((campaign) => ({
      ...campaign,
      // Sort alerts by priority within each campaign
      alerts: [...campaign.alerts].sort((a, b) => {
        const priorityOrder = { HIGH: 1, MEDIUM: 2, LOW: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }),
    }));

  return {
    ...data,
    generatedAt,
    campaigns: sortedCampaigns,
  };
}
