// ============================================================
// MARCOM / Lumi — Axios client w/ Firebase JWT injection
// ------------------------------------------------------------
// Replaces direct `axios.get('/api/...')` calls with `api.get(...)`.
// Every request automatically attaches a fresh Firebase ID token,
// so JWT-protected backend routes (req.user.uid / req.workspaceId)
// see an authenticated caller.
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

api.interceptors.request.use(async (config) => {
  if (_getToken) {
    try {
      const token = await _getToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
    } catch {
      // Token unavailable; let the request proceed unauthenticated.
    }
  }
  return config;
});
