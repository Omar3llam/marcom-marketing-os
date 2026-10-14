// Deployment contract only; API/auth/worker behavior is independent of this flag.
// Unset preserves the existing production SPA default. Backend deployments opt out.
export function shouldServeFrontend(nodeEnv, value) {
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new Error('SERVE_FRONTEND must be true, false, or unset');
  }
  return nodeEnv === 'production' && value !== 'false';
}
