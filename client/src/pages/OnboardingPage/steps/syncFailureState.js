/** Request status establishes refusal/retryability; message text is not evidence. */
export function syncFailureState(err) {
  const status = err?.httpStatus ?? err?.response?.status;
  if (status === 403) return { kind: 'NOT_PERMITTED', retryable: false };
  if (status === 401) return { kind: 'AUTH_REQUIRED', retryable: false };
  if (status === 400) return { kind: 'INVALID_CONTEXT', retryable: false };
  if (status === 408 || status === 429 || status >= 500 || status == null) {
    return { kind: 'RETRYABLE', retryable: true };
  }
  return { kind: 'FAILED', retryable: false };
}
