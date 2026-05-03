// ============================================================
// MARCOM / Lumi — Axios client w/ Clerk JWT injection
// ------------------------------------------------------------
// Replaces direct `axios.get('/api/...')` calls with `api.get(...)`.
// Every request automatically attaches a fresh Clerk session token,
// so JWT-protected backend routes (req.userId / req.workspaceId)
// see an authenticated caller.
// ============================================================
import axios from 'axios';

let _getToken = null;

/**
 * Wire the Clerk session token getter (called once from main.jsx
 * after Clerk has loaded). Until this is set, requests still go
 * out — but unauthenticated.
 */
export function bindClerkTokenGetter(fn) {
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
