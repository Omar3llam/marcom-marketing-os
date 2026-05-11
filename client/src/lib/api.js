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
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 Unauthorized → session expired or invalid
    if (error.response?.status === 401) {
      console.warn('[api] 401 Unauthorized — clearing cached state and redirecting to login');

      // Clear localStorage cached state (onboarding, history, etc.)
      try {
        localStorage.removeItem('lumi:decisionHistory');
        localStorage.removeItem('lumi:radarAlerts');
        localStorage.removeItem('lumi:onboardingState');
      } catch {
        // localStorage may be unavailable in some environments
      }

      // Redirect to login (avoid infinite loop if already on /login)
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?session_expired=1';
      }
    }

    // 403 Forbidden → insufficient permissions (workspace/role issue)
    if (error.response?.status === 403) {
      console.error('[api] 403 Forbidden — user lacks required permissions');
    }

    return Promise.reject(error);
  }
);
