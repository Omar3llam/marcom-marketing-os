// ============================================================
// MARCOM — API Client  (frontend/js/api.js)
// Handles all fetch calls: Clerk token retrieval, AbortController,
// unified error handling.
// ============================================================

const ACTIVE_CONTROLLERS = new Map();

/**
 * Get a fresh Clerk JWT. Returns null in dev / when Clerk not loaded.
 */
async function getToken() {
  try { return await window.Clerk?.session?.getToken() || null; }
  catch { return null; }
}

/**
 * Build standard headers for every request.
 */
async function buildHeaders(extra = {}) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Core fetch wrapper with AbortController management.
 * @param {string}  url
 * @param {object}  body   — JSON-serialisable payload
 * @param {string}  key    — unique key for this request type (cancels previous)
 * @param {number}  [timeout=30000]
 */
async function apiFetch(url, body, key = 'default', timeout = 30_000) {
  // Cancel any in-flight request for the same key
  if (ACTIVE_CONTROLLERS.has(key)) {
    ACTIVE_CONTROLLERS.get(key).abort();
  }
  const controller = new AbortController();
  ACTIVE_CONTROLLERS.set(key, controller);

  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = await buildHeaders();
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw Object.assign(new Error(err.message || `HTTP ${res.status}`), { status: res.status, body: err });
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request cancelled or timed out.');
    throw err;
  } finally {
    clearTimeout(timer);
    ACTIVE_CONTROLLERS.delete(key);
  }
}

/** Cancel all pending requests (e.g., on page navigation). */
export function cancelAll() {
  for (const c of ACTIVE_CONTROLLERS.values()) c.abort();
  ACTIVE_CONTROLLERS.clear();
}

// ── PUBLIC API ────────────────────────────────────────────────

/**
 * Send a chat message.
 * Routes to /api/chat (Clerk-protected, used from browser).
 */
export async function sendChat({ message, sessionId, mode, imageBase64, imageMediaType, backendUrl = '', projectId = null }) {
  // Send the active project ID so the backend can inject the right context
  // into brand-new sessions. Legacy lumi_context fallback is no longer needed
  // because the project context lives in the DB (not localStorage).
  const activeProjectId = projectId
    || (typeof window !== 'undefined' && window.__lumiActiveProject?.projectId)
    || null;

  return apiFetch(
    `${backendUrl}/api/chat`,
    {
      message,
      ...(sessionId         && { session_id: sessionId }),
      ...(mode              && { mode }),
      ...(imageBase64       && { image_base64: imageBase64, image_media_type: imageMediaType || 'image/jpeg' }),
      ...(activeProjectId   && { project_id: activeProjectId }),
    },
    'chat',
    60_000   // AI can be slow
  );
}

/**
 * Export data to CRM via /api/export.
 */
export async function exportToCRM({ sessionId, exportType, payload, label, backendUrl = '' }) {
  const token = await getToken();
  if (!token) throw new Error('Sign in required to sync to CRM.');

  return apiFetch(
    `${backendUrl}/api/export`,
    { session_id: sessionId, export_type: exportType, payload, label },
    'export'
  );
}

/**
 * Health check.
 */
export async function healthCheck(backendUrl = '') {
  const res = await fetch(`${backendUrl}/health`);
  return res.json();
}
