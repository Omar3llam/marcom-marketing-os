/** Classify an established 403 from explicit tokens, never human-readable copy. */
export function scenarioGateReason(err) {
  const token = err?.response?.data?.error ?? err?.code;
  return token === 'PLAN_REQUIRED' ? 'PLAN_REQUIRED' : 'NOT_PERMITTED';
}
