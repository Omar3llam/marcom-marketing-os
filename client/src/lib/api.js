// ============================================================
// MARCOM / Lumi — API Client
// ------------------------------------------------------------
// Single Axios instance used by ALL frontend API calls.
// Handles:
//   - Firebase token attachment (request interceptor)
//   - Contract version header (x-contract-version)
//   - Token expiry recovery (401 retry with force-refresh)
//   - Transport → domain error mapping (Phase 10B)
//   - withCredentials for OAuth session cookies
//
// ONE WAY ONLY: All API calls go through this client.
// Never use raw fetch() or direct axios.create().
// ============================================================
import axios from 'axios';
import { auth } from '../firebase.js';
import {
  AuthError,
  NetworkError,
  RateLimitError,
  PlatformError,
  ValidationError,
} from '../contracts/errors/index';
import { generateRequestId, getSessionId } from './correlation';

// Contract version - updated when API contracts change
// See: client/src/contracts/COMPATIBILITY.md
const CONTRACT_VERSION = '2.1.0';

export const api = axios.create({
  baseURL:          '/',
  timeout:          60_000,
  withCredentials:  true,    // Required for Meta OAuth session cookies
});

// ── REQUEST: Attach Firebase ID token + Contract Version ─────
api.interceptors.request.use(
  async (config) => {
    try {
      // getIdToken() returns cached token if valid, refreshes if near-expiry
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      } else {
        console.warn('[api] No token available - auth.currentUser is null');
      }

      // Attach contract version for backend validation + drift detection
      config.headers['x-contract-version'] = CONTRACT_VERSION;

      // Attach correlation IDs for distributed tracing (Phase 10D)
      const requestId = generateRequestId();
      const sessionId = getSessionId();
      config.headers['x-request-id'] = requestId;
      config.headers['x-session-id'] = sessionId;

      // Store correlation IDs in config for error mapping
      config.metadata = { requestId, sessionId };
    } catch (err) {
      // Auth not ready yet (e.g. page just loaded) — proceed without token.
      // Backend will return 401 which the response interceptor handles.
      console.error('[api] Could not get Firebase token:', err?.message, err);
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * Map transport error to domain error (Phase 10B + 10D)
 *
 * Converts axios/fetch errors into domain-centric errors with
 * proper classification, severity, retry intelligence, and correlation IDs.
 *
 * @param {Error} error - Axios error
 * @returns {AppError} Domain error
 */
function mapTransportError(error) {
  const status = error.response?.status;
  const endpoint = error.config?.url || 'unknown';
  const message = error.response?.data?.message || error.message;

  // Extract correlation IDs from request config (Phase 10D)
  const requestId = error.config?.metadata?.requestId;
  const sessionId = error.config?.metadata?.sessionId;

  // Auth errors (401, 403)
  if (status === 401) {
    return new AuthError({
      message: 'Session expired or invalid token',
      code: 'AUTH_SESSION_EXPIRED',
      httpStatus: 401,
      fallbackAction: 'Please log in again',
      requestId,
      sessionId,
      context: { endpoint },
    });
  }

  if (status === 403) {
    const serverError = error.response?.data?.error;
    const serverHint  = error.response?.data?.hint;
    const serverCode  = error.response?.data?.code;
    return new AuthError({
      message: serverError || 'Access denied',
      code: serverCode || 'AUTH_ACCESS_DENIED',
      httpStatus: 403,
      fallbackAction: serverHint || 'Contact workspace admin for access',
      requestId,
      sessionId,
      context: { endpoint },
    });
  }

  // Rate limiting (429)
  if (status === 429) {
    const retryAfter = error.response?.headers?.['retry-after'];
    return new RateLimitError({
      message: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      httpStatus: 429,
      requestId,
      sessionId,
      context: { endpoint, retryAfter },
      fallbackAction: retryAfter
        ? `Please wait ${retryAfter} seconds before retrying`
        : 'Please wait before retrying',
    });
  }

  // Validation errors (400, 422)
  if (status === 400 || status === 422) {
    return new ValidationError({
      message: message || 'Invalid request data',
      code: 'VALIDATION_ERROR',
      httpStatus: status,
      fallbackAction: 'Check your input and try again',
      requestId,
      sessionId,
      context: { endpoint, details: error.response?.data },
    });
  }

  // Platform errors (5xx)
  if (status >= 500) {
    return new PlatformError({
      message: message || 'Server error',
      code: 'PLATFORM_ERROR',
      httpStatus: status,
      fallbackAction: 'Try again or contact support if issue persists',
      requestId,
      sessionId,
      context: { endpoint },
    });
  }

  // Network errors (timeout, connection refused, etc.)
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new NetworkError({
      message: 'Request timeout',
      code: 'NETWORK_TIMEOUT',
      fallbackAction: 'Check your connection and try again',
      requestId,
      sessionId,
      context: { endpoint, timeout: error.config?.timeout },
    });
  }

  if (!error.response) {
    return new NetworkError({
      message: 'Network error - no response received',
      code: 'NETWORK_ERROR',
      fallbackAction: 'Check your internet connection',
      requestId,
      sessionId,
      context: { endpoint },
    });
  }

  // Fallback: Generic platform error
  return new PlatformError({
    message: message || 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR',
    httpStatus: status,
    fallbackAction: 'Please try again',
    requestId,
    sessionId,
    context: { endpoint },
  });
}

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
        // Map to domain error and reject
        return Promise.reject(mapTransportError(error));
      }
    }

    // Map transport error to domain error (Phase 10B)
    const domainError = mapTransportError(error);
    return Promise.reject(domainError);
  },
);
