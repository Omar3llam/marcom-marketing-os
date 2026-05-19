/**
 * Contract Drift Telemetry — Monitor backend contract violations
 *
 * Tracks parsing failures to detect backend contract drift.
 * Provides early warning system for API breaking changes.
 *
 * @example
 * ```ts
 * import { trackContractDrift } from '@/contracts/telemetry';
 *
 * const result = parseLumiFeed(payload);
 * if (!result.success && result.error instanceof ParsingError) {
 *   trackContractDrift(result.error);
 * }
 * ```
 */

import { track } from '@/lib/telemetry';
import { ParsingError } from '../errors';
import type { ZodIssue } from 'zod';

/**
 * Track contract drift event
 *
 * Logs parsing failures for monitoring and alerting.
 * Critical for detecting backend breaking changes.
 *
 * @param error - Parsing error with validation issues
 */
export function trackContractDrift(error: ParsingError): void {
  track('contract_drift_detected', {
    endpoint: error.endpoint,
    schema: error.schema,
    message: error.message,
    issueCount: error.issues?.length || 0,
    issues: formatIssues(error.issues),
    timestamp: error.timestamp.toISOString(),
    // TODO: Add backend version when header is implemented
    // backendVersion: error.context?.backendVersion,
  });
}

/**
 * Format Zod issues for telemetry
 *
 * Converts Zod validation issues into structured format
 * for easier analysis and debugging.
 *
 * @param issues - Zod validation issues
 * @returns Formatted issue summary
 */
function formatIssues(issues?: ZodIssue[]): Array<{
  path: string;
  message: string;
  code: string;
}> {
  if (!issues) return [];

  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Track contract health metrics
 *
 * Aggregate contract validation success/failure rates
 * for dashboard monitoring.
 *
 * @param endpoint - API endpoint
 * @param success - Whether validation succeeded
 */
export function trackContractHealth(endpoint: string, success: boolean): void {
  track('contract_health', {
    endpoint,
    success,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get contract health summary
 *
 * Calculate contract validation success rate.
 * Useful for monitoring dashboard.
 *
 * NOTE: This requires access to telemetry logs.
 * For now, it's a placeholder for future implementation.
 *
 * @returns Success rate (0-1) or null if insufficient data
 */
export function getContractHealthSummary(): {
  successRate: number;
  totalCalls: number;
  failures: number;
} | null {
  // TODO: Implement telemetry aggregation
  // This would query window.__telemetry.getLogs() and calculate rates
  return null;
}

/**
 * Track schema version mismatch
 *
 * Logs when backend sends unexpected schema version.
 * Critical for detecting version drift in multi-client/staged deployments.
 *
 * @param params - Version mismatch details
 */
export function trackVersionMismatch(params: {
  expected: string;
  received: string;
  endpoint: string;
  isSupported: boolean;
  isDeprecated: boolean;
  warning?: string;
}): void {
  track('contract_version_mismatch', {
    expectedVersion: params.expected,
    receivedVersion: params.received,
    endpoint: params.endpoint,
    isSupported: params.isSupported,
    isDeprecated: params.isDeprecated,
    warning: params.warning,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Track unknown fields in payload
 *
 * Detects when backend sends fields not in schema.
 * Useful for discovering undocumented API changes.
 *
 * @param params - Unknown fields details
 */
export function trackUnknownFields(params: {
  endpoint: string;
  schema: string;
  unknownFields: string[];
  payload?: unknown;
}): void {
  track('contract_unknown_fields', {
    endpoint: params.endpoint,
    schema: params.schema,
    unknownFields: params.unknownFields,
    fieldCount: params.unknownFields.length,
    timestamp: new Date().toISOString(),
    // Don't log full payload by default (may contain sensitive data)
    // payloadPreview: params.payload ? JSON.stringify(params.payload).slice(0, 200) : undefined,
  });
}

/**
 * Track deprecated contract usage
 *
 * Logs when client receives response using deprecated contract version.
 * Helps plan migration timeline before removal.
 *
 * @param params - Deprecation details
 */
export function trackDeprecatedContract(params: {
  version: string;
  endpoint: string;
  removalDate?: string;
}): void {
  track('contract_deprecated_usage', {
    version: params.version,
    endpoint: params.endpoint,
    removalDate: params.removalDate,
    timestamp: new Date().toISOString(),
  });
}
