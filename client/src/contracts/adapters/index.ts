/**
 * Adapter Exports — Backend → Frontend translation layer
 *
 * Adapters validate and normalize backend responses:
 * - Runtime validation (Zod schemas)
 * - Normalization (defaults, sorting, formatting)
 * - Error wrapping (Result pattern)
 *
 * USAGE:
 * ```ts
 * import { parseLumiFeed, parseExecutionResponse } from '@/contracts/adapters';
 *
 * // Parse feed
 * const feedResult = parseLumiFeed(rawPayload);
 * if (!feedResult.success) {
 *   handleError(feedResult.error);
 *   return;
 * }
 * const feed = feedResult.data;
 *
 * // Parse execution
 * const execResult = parseExecutionResponse(rawPayload);
 * if (!execResult.success) {
 *   handleError(execResult.error);
 *   return;
 * }
 * const execution = execResult.data;
 * ```
 *
 * IMPORTANT:
 * UI should NEVER consume raw backend responses directly.
 * Always use adapters to ensure contract safety.
 */

export { parseLumiFeed } from './lumiFeed.adapter';
export {
  parseExecutionResponse,
  isIdempotentReplay,
  hasAuditLog,
} from './execution.adapter';
