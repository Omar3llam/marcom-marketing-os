// ============================================================
// MARCOM / Lumi — Axios client w/ Firebase JWT injection
// ------------------------------------------------------------
// PRODUCTION-GRADE AUTHENTICATED API CLIENT
//
// Every request automatically:
//   1. Attaches fresh Firebase ID token
//   2. Handles 401 → redirect to /login
//   3. Clears stale cached state on auth failure
//
// Replaces manual token attachment throughout the app.
// All API calls MUST use this client:
//   import { api } from '@/lib/api';
//   await api.get('/api/...');
// ============================================================
import axios from 'axios';

let _getToken = null;

/**
 * Wire the Firebase ID token getter (called once from main.jsx
 * after Firebase auth has loaded). Until this is set, requests
 * still go out — but unauthenticated.
 */
export function bindFirebaseTokenGetter(fn) {
  _getToken = fn;
}

export const api = axios.create({
  baseURL: '/',
  // Long-running orchestration calls take 5–30s; allow 60s ceiling.
  timeout: 60_000,
});

// ── REQUEST INTERCEPTOR: Auto-inject Firebase JWT ───────────
api.interceptors.request.use(
  async (config) => {
    if (_getToken) {
      try {
        const token = await _getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        } else {
          console.warn('[api] Firebase token unavailable — request will be unauthenticated');
        }
      } catch (err) {
        console.error('[api] Failed to fetch Firebase token:', err);
        // Let request proceed unauthenticated; backend will reject if auth required.
      }
    }
    return config;
  },
  (error) => {
    console.error('[api] Request interceptor error:', error);
    return Promise.reject(error);
  }
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
