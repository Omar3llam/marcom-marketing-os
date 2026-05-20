// ============================================================
// MARCOM — Optimistic Concurrency Control (OCC) Helpers
// Phase 11B Task 2: OCC infrastructure
//
// Architecture Gate Decision 2: OCC Version Enforcement
// Monotonic version field + optimistic locking prevents race
// conditions in distributed execution environment.
//
// CRITICAL ENFORCEMENT RULES:
// - All transitions MUST use updateWithOCC()
// - NEVER allow force updates
// - NEVER allow bypass transitions
// - NEVER allow admin mutation shortcuts
// Those become invisible corruption tunnels later.
// ============================================================

import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';

/**
 * Concurrency Violation Error
 *
 * Thrown when optimistic concurrency check fails due to version mismatch.
 * Indicates another process modified the execution between read and write.
 */
export class ConcurrencyError extends Error {
  constructor(executionId, expectedVersion, actualVersion) {
    super(
      `Concurrency violation: execution ${executionId} expected version ` +
      `${expectedVersion}, but current version is ${actualVersion}`
    );
    this.name = 'ConcurrencyError';
    this.executionId = executionId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * Update ExecutionRequest with Optimistic Concurrency Control
 *
 * Enforces the OCC pattern: WHERE version = expectedVersion
 * If affected rows = 0, another process won the race — emit violation
 * and NEVER silent overwrite.
 *
 * Architecture Gate Decision 2 Enforcement:
 * - Updates only succeed if version matches expectedVersion
 * - Version is automatically incremented on successful update
 * - Returns updated record with new version
 * - Throws ConcurrencyError on version mismatch
 *
 * @param {string} executionId - Execution request ID
 * @param {number} expectedVersion - Version expected before update (OCC lock)
 * @param {object} data - Fields to update (status, response, etc.)
 * @returns {Promise<object>} Updated ExecutionRequest with new version
 * @throws {ConcurrencyError} If version mismatch detected
 */
export async function updateWithOCC(executionId, expectedVersion, data) {
  // Step 1: Attempt optimistic update with version check
  const result = await prisma.executionRequest.updateMany({
    where: {
      id: executionId,
      version: expectedVersion,  // ← OPTIMISTIC LOCK
    },
    data: {
      ...data,
      version: { increment: 1 },  // Monotonic version increment
      updatedAt: new Date(),       // Explicit timestamp update
    },
  });

  // Step 2: Check if update succeeded (affected rows > 0)
  if (result.count === 0) {
    // No rows affected — version mismatch detected
    // Fetch current state to provide accurate error
    const current = await prisma.executionRequest.findUnique({
      where: { id: executionId },
      select: { version: true },
    });

    if (!current) {
      throw new Error(`ExecutionRequest ${executionId} not found`);
    }

    // Throw concurrency violation with actual vs expected version
    throw new ConcurrencyError(executionId, expectedVersion, current.version);
  }

  // Step 3: Fetch and return updated record with new version
  const updated = await prisma.executionRequest.findUnique({
    where: { id: executionId },
  });

  logger.debug({
    executionId,
    oldVersion: expectedVersion,
    newVersion: updated.version,
    status: updated.status,
  }, 'OCC update successful');

  return updated;
}

/**
 * Get Current Version
 *
 * Fetches current version of ExecutionRequest for OCC operations.
 * Use before calling updateWithOCC() to get expectedVersion.
 *
 * @param {string} executionId - Execution request ID
 * @returns {Promise<number>} Current version number
 * @throws {Error} If execution not found
 */
export async function getCurrentVersion(executionId) {
  const execution = await prisma.executionRequest.findUnique({
    where: { id: executionId },
    select: { version: true },
  });

  if (!execution) {
    throw new Error(`ExecutionRequest ${executionId} not found`);
  }

  return execution.version;
}

/**
 * Retry Update with OCC
 *
 * Wrapper that retries updateWithOCC() on concurrency violations.
 * Useful for transient race conditions where retry is acceptable.
 *
 * WARNING: Only use when retry is semantically correct!
 * For state transitions, DO NOT auto-retry — let ExecutionLifecycleService
 * handle reconciliation instead.
 *
 * @param {string} executionId - Execution request ID
 * @param {object} data - Fields to update
 * @param {object} options - Retry options
 * @param {number} options.maxRetries - Max retry attempts (default: 3)
 * @param {number} options.retryDelay - Delay between retries in ms (default: 100)
 * @returns {Promise<object>} Updated ExecutionRequest
 * @throws {ConcurrencyError} If max retries exhausted
 */
export async function retryUpdateWithOCC(
  executionId,
  data,
  { maxRetries = 3, retryDelay = 100 } = {}
) {
  let attempt = 0;
  let lastError;

  while (attempt < maxRetries) {
    try {
      // Fetch current version
      const currentVersion = await getCurrentVersion(executionId);

      // Attempt update with current version
      return await updateWithOCC(executionId, currentVersion, data);

    } catch (error) {
      if (error instanceof ConcurrencyError) {
        lastError = error;
        attempt++;

        if (attempt < maxRetries) {
          logger.debug({
            executionId,
            attempt,
            maxRetries,
            retryDelay,
          }, 'OCC retry after concurrency violation');

          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }

      // Non-concurrency error or max retries exhausted
      throw error;
    }
  }

  // Max retries exhausted
  throw lastError;
}

/**
 * Validate OCC Update Data
 *
 * Ensures update data doesn't contain version field (managed internally)
 * or other protected fields that should never be directly mutated.
 *
 * @param {object} data - Update data to validate
 * @throws {Error} If data contains protected fields
 */
export function validateOCCUpdateData(data) {
  const protectedFields = ['version', 'id', 'createdAt'];

  for (const field of protectedFields) {
    if (data[field] !== undefined) {
      throw new Error(
        `OCC update data cannot contain protected field: ${field}`
      );
    }
  }

  return true;
}

/**
 * Check if Error is Concurrency Violation
 *
 * Type guard for ConcurrencyError instances.
 *
 * @param {Error} error - Error to check
 * @returns {boolean} True if error is ConcurrencyError
 */
export function isConcurrencyError(error) {
  return error instanceof ConcurrencyError;
}
