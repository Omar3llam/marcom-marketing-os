// ============================================================
// MARCOM / Lumi — API Client
// ------------------------------------------------------------
// Single Axios instance used by ALL frontend API calls.
// Handles:
//   - Firebase token attachment (request interceptor)
//   - Token expiry recovery (401 retry with force-refresh)
//   - withCredentials for OAuth session cookies
//
// ONE WAY ONLY: All API calls go through this client.
// Never use raw fetch() or direct axios.create().
// ============================================================
import axios from 'axios';
import { auth } from '../firebase.js';

export const api = axios.create({
  baseURL:          '/',
  timeout:          60_000,
  withCredentials:  true,    // Required for Meta OAuth session cookies
});

// ── REQUEST: Attach Firebase ID token ────────────────────────
api.interceptors.request.use(
  async (config) => {
    try {
      // DEBUG: Log auth state before getting token
      console.log('[api] Request interceptor:', {
        url: config.url,
        authDefined: !!auth,
        currentUserDefined: !!auth.currentUser,
        currentUserEmail: auth.currentUser?.email,
      });

      // getIdToken() returns cached token if valid, refreshes if near-expiry
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log('[api] Token attached:', token.slice(0, 20) + '...');
      } else {
        console.warn('[api] No token available - auth.currentUser is null');
      }
    } catch (err) {
      // Auth not ready yet (e.g. page just loaded) — proceed without token.
      // Backend will return 401 which the response interceptor handles.
      console.error('[api] Could not get Firebase token:', err?.message, err);
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── RESPONSE: Retry once on 401 with force-refreshed token ───
// Firebase tokens expire after 1 hour. When a 401 is received:
//   1. Force-refresh the Firebase token (getIdToken(true))
//   2. Retry the original request with the new token
//   3. If retry also fails → propagate the error (user must re-login)
//
// _retry flag prevents infinite retry loops.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Only retry on 401 and only once
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      auth.currentUser
    ) {
      originalRequest._retry = true;

      try {
        // Force-refresh: bypass cache, get a new token from Firebase
        const freshToken = await auth.currentUser.getIdToken(true);
        originalRequest.headers.Authorization = `Bearer ${freshToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Token refresh failed — user's session is truly expired
        console.warn('[api] Token refresh failed, session expired:', refreshError?.message);
        // Propagate original 401 — AuthContext will handle sign-out if needed
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);
