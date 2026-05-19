/**
 * Contract Registry — Version management for API contracts
 *
 * Central registry for all contract versions, compatibility rules,
 * and deprecation lifecycle management.
 *
 * @example
 * ```ts
 * import { CURRENT_VERSION, isVersionSupported } from '@/contracts/registry';
 *
 * if (!isVersionSupported(payload.schemaVersion)) {
 *   trackVersionMismatch({ expected: CURRENT_VERSION, received: payload.schemaVersion });
 * }
 * ```
 */

import { LumiFeedResponseSchema } from './schemas/api.schema';

/**
 * Current client contract version
 *
 * This is the version the frontend expects.
 * Backend should send this version in responses.
 */
export const CURRENT_VERSION = '2.1.0';

/**
 * Minimum supported backend version
 *
 * Client will reject responses below this version.
 */
export const MIN_SUPPORTED_VERSION = '2.0.0';

/**
 * Maximum supported backend version
 *
 * Client will warn on responses above this version (may be forward-compatible).
 */
export const MAX_SUPPORTED_VERSION = '2.9.9';

/**
 * Contract registry mapping versions to schemas
 *
 * When adding new versions:
 * 1. Create new schema file (e.g., api.schema.v3.ts)
 * 2. Add version mapping here
 * 3. Update CURRENT_VERSION
 * 4. Update compatibility matrix in COMPATIBILITY.md
 */
export const CONTRACTS = {
  '2.0.0': LumiFeedResponseSchema, // Initial contract (Phase 3)
  '2.1.0': LumiFeedResponseSchema, // Current (Phase 9 - added schemaVersion)
} as const;

/**
 * Deprecated versions with removal timeline
 *
 * Format: { version: removalDate }
 */
export const DEPRECATED_VERSIONS: Record<string, string> = {
  // Example: '1.0.0': '2026-08-01',
};

/**
 * Check if a schema version is supported
 *
 * @param version - Schema version from backend payload
 * @returns true if version is within supported range
 */
export function isVersionSupported(version: string | undefined): boolean {
  if (!version) return false; // Missing version is unsupported

  // Parse semver (simple version for now, can use semver library later)
  const [major, minor] = version.split('.').map(Number);
  const [minMajor, minMinor] = MIN_SUPPORTED_VERSION.split('.').map(Number);
  const [maxMajor, maxMinor] = MAX_SUPPORTED_VERSION.split('.').map(Number);

  // Check if version is within range
  if (major < minMajor || major > maxMajor) return false;
  if (major === minMajor && minor < minMinor) return false;
  if (major === maxMajor && minor > maxMinor) return false;

  return true;
}

/**
 * Check if a version is deprecated
 *
 * @param version - Schema version to check
 * @returns true if version is marked for deprecation
 */
export function isVersionDeprecated(version: string): boolean {
  return version in DEPRECATED_VERSIONS;
}

/**
 * Get deprecation warning for a version
 *
 * @param version - Deprecated version
 * @returns Warning message with removal date
 */
export function getDeprecationWarning(version: string): string | null {
  const removalDate = DEPRECATED_VERSIONS[version];
  if (!removalDate) return null;

  return `Contract version ${version} is deprecated and will be removed on ${removalDate}. Please upgrade.`;
}

/**
 * Version compatibility check result
 */
export type VersionCompatibility = {
  isSupported: boolean;
  isDeprecated: boolean;
  isCurrent: boolean;
  warning?: string;
};

/**
 * Comprehensive version compatibility check
 *
 * @param version - Schema version to validate
 * @returns Compatibility status with warnings
 */
export function checkVersionCompatibility(
  version: string | undefined
): VersionCompatibility {
  if (!version) {
    return {
      isSupported: false,
      isDeprecated: false,
      isCurrent: false,
      warning: 'Missing schemaVersion field. Backend may be outdated.',
    };
  }

  const isSupported = isVersionSupported(version);
  const isDeprecated = isVersionDeprecated(version);
  const isCurrent = version === CURRENT_VERSION;

  let warning: string | undefined;

  if (!isSupported) {
    warning = `Unsupported schema version ${version}. Expected ${MIN_SUPPORTED_VERSION} - ${MAX_SUPPORTED_VERSION}.`;
  } else if (isDeprecated) {
    warning = getDeprecationWarning(version) || undefined;
  } else if (!isCurrent) {
    const [receivedMajor] = version.split('.').map(Number);
    const [currentMajor] = CURRENT_VERSION.split('.').map(Number);

    if (receivedMajor > currentMajor) {
      warning = `Backend is ahead (${version} > ${CURRENT_VERSION}). Client may be outdated.`;
    } else {
      warning = `Backend is behind (${version} < ${CURRENT_VERSION}). May lack recent features.`;
    }
  }

  return {
    isSupported,
    isDeprecated,
    isCurrent,
    warning,
  };
}
