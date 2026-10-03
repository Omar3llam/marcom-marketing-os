/** Classify an established 403 using explicit evidence, never status alone. */
export function incrementalityGateReason(err) {
  const token = err?.response?.data?.error ?? err?.code;
  if (token === 'PLAN_REQUIRED') return 'PLAN_REQUIRED';
  // api.js maps the backend error token directly into message for this gate.
  if (token === 'MeasurementGated' || err?.message === 'MeasurementGated') return 'NOT_ENTITLED';
  return 'NOT_PERMITTED';
}
