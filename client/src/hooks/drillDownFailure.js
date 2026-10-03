import { DRILL_DOWN_CONTRACT_ERRORS } from './drillDownContracts.js';

/** Local read policy only; HTTP semantics never come from server prose. */
export function drillDownFailure(err) {
  const status = err?.httpStatus ?? err?.response?.status;
  if (status === 403) return { kind: 'NOT_PERMITTED', retryable: false };
  if (err instanceof Error && DRILL_DOWN_CONTRACT_ERRORS.includes(err.message)) {
    return { kind: 'CONTRACT_INVALID', retryable: false };
  }
  // Preserve existing recovery for other statuses, including parent 404s.
  return { kind: 'UNAVAILABLE', retryable: true };
}
