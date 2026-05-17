// ============================================================
// MARCOM / Lumi — Axios client w/ Firebase JWT injection
// ------------------------------------------------------------
// PRODUCTION-GRADE AUTHENTICATED API CLIENT
//
// Every request automatically:
//   1. Attaches fresh Firebase ID token (direct SDK, no hooks)
//   2. Injects idempotency keys for write operations
//   3. Handles 401 → redirect to /login
//   4. Clears stale cached state on auth failure
//
// Replaces manual token attachment throughout the app.
// All API calls MUST use this client:
//   import { api } from '@/lib/api';
//   await api.get('/api/...');
// ============================================================
import axios from 'axios';
import { auth } from '../firebase.js';

export const api = axios.create({
  baseURL: '/',
  // Long-running orchestration calls take 5–30s; allow 60s ceiling.
  timeout: 60_000,
  // withCredentials: true enables cookies on cross-origin requests.
  // Required for Meta OAuth session cookies after callback redirect.
  // Safe to enable — backend CORS uses an allowlist, not wildcard '*'.
  // (Cannot use withCredentials=true with origin:'*' — browser blocks it.)
  withCredentials: true,
});

// ── REQUEST INTERCEPTOR: Auto-inject Firebase JWT & Idempotency ───────────
api.interceptors.request.use(
  async (config) => {
    // 1. JWT Injection (direct Firebase SDK access)
    try {
      const currentUser = auth?.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (err) {
      console.warn('[api] Failed to fetch Firebase token:', err);
    }

    // 2. Idempotency Key Injection (For POST, PUT, PATCH, DELETE)
    const method = config.method?.toLowerCase();
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      config.headers['X-Idempotency-Key'] = crypto.randomUUID();
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ── RESPONSE INTERCEPTOR: Handle 401 globally ────────────────
// Fix A: Only redirect on auth-critical endpoints, NOT on feature endpoints
// (e.g. /api/lumi/feed or /api/memory/patterns returning 401 because the
// workspace isn't provisioned yet). Those 401s are handled per-hook.
//
// Fix B: Deduplicate simultaneous 401s — multiple parallel requests that
// all 401 at once (race condition on first render) must not each trigger
// a logout. A 3s cooldown prevents the login death loop.
const AUTH_ENDPOINTS = [
  '/api/user/profile',
  '/api/user/me',
  '/api/auth/verify',
  '/api/campaigns/me/context', // onboarding context write
];

let _isRedirectingToLogin = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      const isAuthEndpoint = AUTH_ENDPOINTS.some((ep) => url.includes(ep));

      if (isAuthEndpoint && !_isRedirectingToLogin) {
        // True auth failure on a critical endpoint → session is invalid
        console.warn(
          '[api] 401 on auth endpoint — clearing cached state and redirecting to login',
          url,
        );

        _isRedirectingToLogin = true;
        setTimeout(() => { _isRedirectingToLogin = false; }, 3_000);

        try {
          localStorage.removeItem('lumi:decisionHistory');
          localStorage.removeItem('lumi:radarAlerts');
          localStorage.removeItem('lumi:onboardingState');
        } catch {
          // localStorage may be unavailable in some environments
        }

        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login?session_expired=1';
        }
      } else if (!isAuthEndpoint) {
        // Feature endpoint 401 (workspace not provisioned, missing resource, etc.)
        // Log it so it's visible in DevTools but DO NOT log out the user.
        console.debug('[api] 401 on feature endpoint (not an auth failure):', url);
      }
    }

    // 403 Forbidden → insufficient permissions (workspace/role issue)
    if (error.response?.status === 403) {
      console.error('[api] 403 Forbidden — user lacks required permissions');
    }

    return Promise.reject(error);
  }
);
