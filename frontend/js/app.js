// ============================================================
// MARCOM — Application Entry Point  (frontend/js/app.js)
// Handles auth bootstrapping, send flow, and the window._app
// facade used by inline HTML event handlers.
// ============================================================
import { sendChat, exportToCRM } from './api.js?v=20260427-2';
import { S, updateUI } from './state.js?v=20260427-2';
import { renderResp, renderCampaign, renderScorecard, appendMsg, esc, hideEmpty, tryJSON, fmtTxt } from './renderers.js?v=20260427-2';
import { showWizard, renderWizStep, selTile, wNext, wizDone, wizManual, wizSetCountry, setWizUrl } from './wizard.js?v=20260427-2';
import { handleFile, clearImg } from './media.js?v=20260427-2';

// ── DIAGNOSTIC — remove after confirming new JS is loading ───
console.log('%c[LUMI] app.js v20260426-3 LOADED', 'background:#FFD300;color:#000;font-weight:bold;padding:2px 8px');

// ── LUMI THOUGHTS (rotating loader text) ─────────────────────
const LUMI_THOUGHTS = [
  'Scanning GCC competitors…', 'Extracting B2B search intent…',
  'Mapping funnel stage patterns…', 'Calculating confidence scores…',
  'Analyzing brand positioning signals…', 'Running PESTLE analysis…',
  'Evaluating creative fatigue…', 'Cross-referencing market data…',
  'Finalizing strategy…', 'Generating insight cards…',
];
let thinkTimer = null, thinkIdx = 0;

// ── PROJECT MANAGER ───────────────────────────────────────────
// Single source of truth for the active project on the frontend.
// Uses /api/projects/* endpoints and persists the active project ID
// in localStorage so it survives page refreshes.
const ProjectManager = (() => {
  const STORAGE_KEY = 'lumi:activeProjectId';
  let _projects     = [];    // [{ projectId, name, updatedAt }]
  let _active       = null;  // { projectId, name, context, createdAt }

  async function init() {
    const headers = await getAuthHeaders();
    const res     = await fetch('/api/projects/list', { headers });
    if (!res.ok) throw new Error(`projects/list returned ${res.status}`);
    _projects = await res.json();

    if (!Array.isArray(_projects) || _projects.length === 0) {
      window.location.replace('/onboarding.html');
      return;
    }

    const storedId = localStorage.getItem(STORAGE_KEY);
    const match    = _projects.find(p => p.projectId === storedId);
    await _setActive((match ?? _projects[0]).projectId);
  }

  async function _setActive(projectId) {
    const headers = await getAuthHeaders();
    const res     = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { headers });
    if (!res.ok) throw new Error(`projects/${projectId} returned ${res.status}`);
    _active                  = await res.json();
    window.__lumiActiveProject = _active;
    localStorage.setItem(STORAGE_KEY, projectId);
    document.dispatchEvent(new CustomEvent('lumi:projectChanged', { detail: _active }));
  }

  async function setActive(projectId) { await _setActive(projectId); }

  function getContext()   { return _active?.context   ?? ''; }
  function getProjectId() { return _active?.projectId ?? null; }
  function getList()      { return [..._projects]; }
  function getName()      { return _active?.name ?? ''; }

  return { init, setActive, getContext, getProjectId, getList, getName };
})();

// ── CLERK INIT ────────────────────────────────────────────────
window.addEventListener('load', async () => {
  const authContainer = document.getElementById('auth-container');
  const signInEl      = document.getElementById('clerk-sign-in');

  if (!window.Clerk) {
    console.error('[Clerk] Script not loaded from CDN');
    if (authContainer) authContainer.style.display = 'flex';
    if (signInEl) signInEl.innerHTML = '<p style="color:#e74c3c;font-size:13px;text-align:center;">Auth service unavailable. Please refresh.</p>';
    return;
  }

  try {
    await window.Clerk.load({
      appearance: {
        variables: { colorPrimary: '#FFD300', colorBackground: '#fff', borderRadius: '20px', fontFamily: 'Poppins' },
      },
    });
  } catch (err) {
    console.error('[Clerk] load() failed:', err);
    if (authContainer) authContainer.style.display = 'flex';
    if (signInEl) signInEl.innerHTML = '<p style="color:#e74c3c;font-size:13px;text-align:center;">Auth service unavailable. Please refresh.</p>';
    return;
  }

  const clerk = window.Clerk;

  // Step 1: Auth guard
  if (!clerk.user) {
    window.location.replace('/');
    return;
  }

  // Step 2: Project guard (replaces old context_locked / lumi_context check)
  try {
    await ProjectManager.init();
    // init() redirects to onboarding if no projects — execution stops there
  } catch (err) {
    console.error('[ProjectManager] init failed:', err?.message);
    window.location.replace('/onboarding.html');
    return;
  }

  // Step 3: Boot chat
  boot(clerk);
});

function boot(clerk) {
  const authEl = document.getElementById('auth-container');
  if (authEl) authEl.style.display = 'none';
  document.getElementById('app-container').classList.add('visible');

  if (clerk?.mountUserButton) {
    clerk.mountUserButton(document.getElementById('user-button'), {
      appearance: { elements: { userButtonAvatarBox: 'width:32px;height:32px;border-radius:50%;border:2px solid var(--border);' } },
    });
  }

  const b   = localStorage.getItem('mc_backend');
  const sid = localStorage.getItem('mc_session');
  if (b)   { S.backend = b; }
  if (sid) { S.sid = sid; }

  S.locked = true;  // context always available via project

  updateUI(); setupTA(); buildDots();
  _initProjectSwitcher();
  // Wire sidebar delegation immediately on the static container —
  // #recent-chats-list exists in the HTML from page load, so this
  // call is synchronous and guaranteed before any async fetch settles.
  _wireSidebarDelegation();
  loadRecentChats();
  // Detect redirect back from Meta OAuth and handle connected/error state
  _handleMetaOAuthReturn();

  // ── Auto-resume last session ──────────────────────────────────
  // If the user had an active session (stored in localStorage), restore
  // it automatically so S.history is populated BEFORE any new send().
  // This prevents the critical "history wipe" bug where a page reload
  // followed by a new message would overwrite the full conversation with
  // only the 2 new messages, losing all prior turns.
  if (sid) {
    // Defer slightly so the loading spinner has paint time and
    // loadRecentChats() has started its fetch (no await needed).
    setTimeout(() => resumeChat(sid), 120);
  }
}

// ── PROJECT SWITCHER UI ───────────────────────────────────────
function _initProjectSwitcher() {
  // Paint the active project name on boot
  _renderProjectSwitcher();

  // React to project changes (switching or creation)
  document.addEventListener('lumi:projectChanged', (e) => {
    _renderProjectSwitcher();
    // Clear active session since context changed
    S.sid = null; S.history = []; S.forceMode = null;
    try { localStorage.removeItem('mc_session'); } catch {}
    loadRecentChats();
  });

  // Toggle dropdown
  const trigger = document.getElementById('project-current');
  if (trigger) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('project-dropdown');
      if (!dropdown) return;
      const isOpen = !dropdown.hidden;
      dropdown.hidden = isOpen;
      trigger.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  // Dropdown item click (handles both project-switch and delete button)
  const dropdown = document.getElementById('project-dropdown');
  if (dropdown) {
    dropdown.addEventListener('click', async (e) => {
      // ── Delete button — stop propagation so the row-switch branch never fires.
      const delBtn = e.target.closest('.proj-dd-del');
      if (delBtn) {
        e.stopPropagation();
        const pid = delBtn.dataset.projectId;
        if (pid) await _deleteProject(pid);
        return;
      }

      // ── Project switch
      const li = e.target.closest('li[data-project-id]');
      if (!li) return;
      const pid = li.dataset.projectId;
      if (pid === ProjectManager.getProjectId()) {
        dropdown.hidden = true;
        document.getElementById('project-current')?.setAttribute('aria-expanded', 'false');
        return;
      }
      try {
        await ProjectManager.setActive(pid);
      } catch (err) {
        toast('Could not switch project — please refresh.', 'err');
      }
      dropdown.hidden = true;
      document.getElementById('project-current')?.setAttribute('aria-expanded', 'false');
    });
  }

  // Create new project button — set force flag so onboarding skips the
  // "already has projects → redirect to app.html" guard for this user.
  document.getElementById('create-project-btn')?.addEventListener('click', () => {
    localStorage.setItem('lumi:forceNewProject', 'true');
    window.location.href = '/onboarding.html';
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#project-switcher')) {
      const dd = document.getElementById('project-dropdown');
      if (dd) dd.hidden = true;
      document.getElementById('project-current')?.setAttribute('aria-expanded', 'false');
    }
  });
}

/**
 * Delete a project (and all its chat sessions) via the backend.
 * Guards: only shown when >1 project exists; backend also blocks last project.
 */
async function _deleteProject(projectId) {
  const projectName = ProjectManager.getList().find(p => p.projectId === projectId)?.name ?? 'this project';
  const confirmed = window.confirm(
    `Delete "${projectName}"?\n\nAll chats in this project will be permanently removed. This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error ?? `Delete failed (${res.status})`, 'err');
      return;
    }

    // If the deleted project was active, switch to the first remaining one.
    if (projectId === ProjectManager.getProjectId()) {
      const remaining = ProjectManager.getList().filter(p => p.projectId !== projectId);
      if (remaining.length > 0) {
        try { await ProjectManager.setActive(remaining[0].projectId); } catch {}
      }
    }

    // Refresh project list + sidebar.
    await ProjectManager.init();
    _renderProjectSwitcher();
    loadRecentChats();
    toast('Project deleted', 'ok');

  } catch (err) {
    console.error('[_deleteProject]', err);
    toast('Network error — project not deleted', 'err');
  }
}

function _renderProjectSwitcher() {
  const nameEl = document.getElementById('project-active-name');
  if (nameEl) nameEl.textContent = ProjectManager.getName() || 'My Project';

  const list = document.getElementById('project-dropdown');
  if (!list) return;
  const activePid  = ProjectManager.getProjectId();
  const multiProj  = ProjectManager.getList().length > 1;

  list.innerHTML = ProjectManager.getList().map(p => `
    <li role="option" data-project-id="${esc(p.projectId)}"
        class="${p.projectId === activePid ? 'is-active' : ''}">
      <span class="proj-dd-name">${esc(p.name)}</span>
      ${multiProj ? `
        <button class="proj-dd-del" data-project-id="${esc(p.projectId)}"
                title="Delete project" aria-label="Delete ${esc(p.name)}">×</button>
      ` : ''}
    </li>
  `).join('');
}

// ── CHAT HISTORY (backend, user-scoped) ──────────────────────
// Replaces the previous localStorage-based persistence so chat
// history syncs across devices for the same Clerk userId.
// Backed by /api/history/{save,list,:sessionId}.

/**
 * Build the auth headers Clerk requires for every /api call.
 * Awaits the live Clerk session token — never reads from a cache.
 */
async function getAuthHeaders() {
  const token = await window.Clerk?.session?.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

/**
 * Append one message to the in-memory history array.
 * The DB save is fired separately, in the background, after a turn
 * completes — never blocking the UI.
 */
function pushHistory(role, content, meta = {}) {
  if (content == null || content === '') return;
  S.history.push({
    role: role === 'user' ? 'user' : 'assistant',
    content,
    meta,
    ts: Date.now(),
  });
  // Hard cap to prevent runaway growth in long sessions.
  if (S.history.length > 200) S.history.splice(0, S.history.length - 200);
}

/**
 * Derive a sidebar title from the first user message in S.history.
 * Truncates to 40 chars and appends an ellipsis when the original was longer.
 */
function deriveTitle() {
  const first = S.history.find(m => m.role === 'user' && typeof m.content === 'string');
  if (!first) return 'New Chat';
  const clean = first.content.replace(/\s+/g, ' ').trim();
  return clean.length > 40 ? clean.slice(0, 40) + '...' : clean;
}

/**
 * POST the current session to the backend. Fire-and-forget — must
 * never block the UI or the next message send.
 */
async function saveSession() {
  console.log('[saveSession] called — sid:', S.sid, '| history length:', S.history.length);

  if (!S.sid) {
    console.warn('[saveSession] skipped — no session ID. Was S.sid set from data.session_id?');
    return;
  }
  if (!S.history.length) {
    console.warn('[saveSession] skipped — history is empty. Was pushHistory() called before saveSession()?');
    return;
  }

  const payload = {
    sessionId: S.sid,
    title:     deriveTitle(),
    messages:  S.history,
    projectId: ProjectManager.getProjectId(),
  };
  console.log('[saveSession] posting', payload.messages.length, 'messages for session', payload.sessionId);

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/history/save', {
      method:  'POST',
      headers,
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '(unreadable)');
      console.error(
        `[saveSession] Server returned ${res.status} — messages NOT saved.\n` +
        `  sessionId: ${S.sid}\n` +
        `  messages:  ${S.history.length} items\n` +
        `  response:  ${body.slice(0, 200)}`
      );
    } else {
      console.log(`[saveSession] OK — ${S.history.length} messages saved for session ${S.sid}`);
    }
  } catch (err) {
    console.error('[saveSession] Network/fetch error — messages NOT saved:', err?.message, err);
  }
}

/**
 * Public stub kept for the existing window._app facade signature.
 * Triggers a background save and refreshes the sidebar.
 */
export function saveChatSession(sessionId, _title, mode = 1, locked = false) {
  if (!sessionId) return;
  S.sid     = sessionId;
  S.mode    = mode   || S.mode;
  S.locked  = !!locked;
  saveSession();          // fire-and-forget
  loadRecentChats();      // refresh sidebar without blocking
}

/**
 * Populate the Recent Chats sidebar from the backend.
 * Only metadata (sessionId, title, updatedAt) — payload stays small.
 */
export async function loadRecentChats() {
  const list = document.getElementById('recent-chats-list');
  if (!list) return;

  try {
    const headers   = await getAuthHeaders();
    const projectId = ProjectManager.getProjectId();
    const url       = projectId
      ? `/api/history/list?projectId=${encodeURIComponent(projectId)}`
      : '/api/history/list';
    const res = await fetch(url, { headers });
    if (!res.ok) {
      list.innerHTML = '<div style="padding:6px 12px;font-size:11px;color:var(--ink-3);font-style:italic;">Could not load history.</div>';
      return;
    }
    const { sessions = [] } = await res.json();

    if (!sessions.length) {
      list.innerHTML = '<div style="padding:6px 12px;font-size:11px;color:var(--ink-3);font-style:italic;">No recent chats yet.</div>';
      return;
    }

    list.innerHTML = sessions.map(s => {
      const safeId = esc(s.sessionId || '');
      const label  = esc((s.title || 'New Chat').slice(0, 28));
      // Note: delete button + row use event delegation (see _wireSidebarDelegation).
      return `<div class="sb-item sb-recent" data-session-id="${safeId}" title="${safeId}">
        <span class="sb-item-icon">💬</span>
        <span class="sb-item-label">${label}</span>
        <button class="sb-recent-del" data-session-id="${safeId}"
                aria-label="Delete chat" title="Delete">✕</button>
      </div>`;
    }).join('');
    _wireSidebarDelegation();
  } catch (err) {
    console.warn('[Lumi] loadRecentChats failed:', err?.message);
    list.innerHTML = '<div style="padding:6px 12px;font-size:11px;color:var(--ink-3);font-style:italic;">Offline — history unavailable.</div>';
  }
}

// ── SIDEBAR EVENT DELEGATION ─────────────────────────────────
// One listener on the static #recent-chats-list container — handles
// both row-click (resume) and delete-button click (delete) without
// per-item listeners, so dynamically injected items are covered.
//
// Wired state is stored as a dataset attribute on the element itself
// (not a module-level flag) so the check survives any future scenario
// where the element reference is re-queried after a partial failure.
function _wireSidebarDelegation() {
  const list = document.getElementById('recent-chats-list');
  if (!list || list.dataset.delegationWired) return;

  list.addEventListener('click', (e) => {
    // Delete button — stop propagation so the row-click branch never fires.
    const delBtn = e.target.closest('.sb-recent-del');
    if (delBtn) {
      e.stopPropagation();
      const sid = delBtn.dataset.sessionId;
      if (sid) deleteSession(sid);
      return;
    }

    // Row click — load the session.
    const row = e.target.closest('.sb-recent');
    if (!row) return;

    const sid = row.dataset.sessionId;
    if (!sid) {
      console.error('[sidebar] Click handler: sessionId missing from dataset. Check that loadRecentChats() sets data-session-id on each .sb-recent row.');
      return;
    }

    resumeChat(sid);
  });

  list.dataset.delegationWired = 'true';
}

// ── DELETE SESSION ───────────────────────────────────────────
// Optimistic: pull the row out of the DOM first, then call backend.
// If the delete failed we re-fetch the list to reconcile UI ↔ DB.
async function deleteSession(sessionId) {
  if (!sessionId) return;

  // 1. Optimistic DOM removal
  const el = document.querySelector(`.sb-recent[data-session-id="${CSS.escape(sessionId)}"]`);
  if (el) el.remove();

  // 2. If the deleted session is the active one, clear it and start fresh.
  if (S.sid === sessionId) {
    S.sid = null; S.history = []; S.mode = 1; S.section = 0;
    S.service = 0; S.locked = false; S.forceMode = null; S.img = null;
    try { localStorage.removeItem('mc_session'); } catch {}
    const msgs = document.getElementById('msgs');
    if (msgs) msgs.innerHTML =
      `<div class="empty" id="emptyState"><div class="empty-lumi">✨</div><div class="empty-divider"></div><div class="empty-tagline">Session cleared. Let's go again.</div></div>`;
    updateUI();
  }

  // 3. Backend call
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/history/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok && res.status !== 404) {
      // 404 means already gone — silently OK. Other errors → reconcile.
      throw new Error(`Delete returned ${res.status}`);
    }
    toast('Chat deleted', 'ok');
  } catch (err) {
    console.warn('[Lumi] deleteSession failed:', err?.message);
    toast('Delete failed — refreshing');
    loadRecentChats();
  }
}

/**
 * Resume a saved session: GET /api/history/:sessionId,
 * render every bubble, restore S.history.
 *
 * Strict state machine:
 *   loading → (api error)  → error state
 *   loading → (empty)      → empty state
 *   loading → (messages)   → cleared container, bubbles rendered, scrolled
 *
 * Container is cleared ONCE, immediately before the render loop —
 * never after. This prevents a race where the loading indicator
 * momentarily re-appears over rendered content.
 *
 * User content: textContent only (XSS-safe — never innerHTML).
 * AI content:   fmtTxt() — the project's markdown renderer (not marked).
 * Structured payloads (calendar / scorecard / campaigns): compact stub.
 */
export async function resumeChat(sessionId) {
  // 1. Verify container
  const container = document.getElementById('msgs');
  if (!container) {
    console.error('[loadSession] Chat container #msgs not found. Check HTML ID.');
    return;
  }
  if (!sessionId) {
    console.error('[loadSession] sessionId missing — cannot load session.');
    return;
  }

  // 2. Show loading state — replaces empty-state placeholder immediately.
  container.innerHTML = `
    <div class="loading-indicator" style="padding:32px 16px;text-align:center;color:var(--ink-3);font-size:13px;">
      <span style="display:inline-block;animation:lSpin 1s linear infinite;">✨</span>
      <span style="margin-left:8px;">Loading conversation…</span>
    </div>`;

  // 3. Fetch from backend (authenticated).
  let payload;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/history/${encodeURIComponent(sessionId)}`, { headers });

    if (!res.ok) {
      console.error('[loadSession] API returned', res.status, 'for session', sessionId);
      container.innerHTML = `
        <div class="error-state" style="padding:32px 16px;text-align:center;color:var(--coral);font-size:13px;">
          Could not load this session${res.status === 404 ? ' — it may have been deleted.' : ` (${res.status}).`}
        </div>`;
      return;
    }

    payload = await res.json();

    // Debug: confirm the response shape and content.
    // Open browser DevTools → Console (filter: [loadSession]) to read these.
    console.debug('[loadSession] API response keys:', Object.keys(payload));
    console.debug('[loadSession] messages count:', Array.isArray(payload?.messages) ? payload.messages.length : 'NOT AN ARRAY — check API response shape');
    if (Array.isArray(payload?.messages) && payload.messages.length > 0) {
      console.debug('[loadSession] first message role:', payload.messages[0]?.role, '| content preview:', String(payload.messages[0]?.content ?? '').slice(0, 60));
    } else {
      console.warn('[loadSession] messages array is empty or missing — session was likely not saved correctly. Check [saveSession] logs above for save errors.');
    }

  } catch (err) {
    console.error('[loadSession] Fetch failed:', err);
    container.innerHTML = `
      <div class="error-state" style="padding:32px 16px;text-align:center;color:var(--coral);font-size:13px;">
        Network error loading conversation. Check your connection and try again.
      </div>`;
    return;
  }

  // 4. Validate messages array.
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state empty" id="emptyState">
        <div class="empty-lumi">✨</div>
        <div class="empty-divider"></div>
        <div class="empty-tagline" style="font-size:13px;color:var(--ink-3);">
          This conversation is empty — send a message to continue.
        </div>
      </div>`;
    // Still restore session state so the next message lands on the right row.
    S.sid     = sessionId;
    S.history = [];
    S.msgs    = 0;
    try { localStorage.setItem('mc_session', sessionId); } catch {}
    _highlightActiveChat(sessionId);
    updateUI();
    return;
  }

  // 5. Clear container ONCE — immediately before the render loop.
  //    This is the only place container.innerHTML is cleared; doing it here
  //    means a slow network can never leave a blank screen: the loading
  //    indicator is visible until this exact moment.
  container.innerHTML = '';

  messages.forEach((m, index) => {
    const role    = m.role === 'assistant' ? 'assistant' : 'user';
    const isUser  = role === 'user';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    const meta    = m.meta || (m.mode || m.service ? { mode: m.mode, service: m.service } : {});

    // Guard against unexpected roles (e.g., 'system' injected by older code).
    if (m.role && m.role !== 'user' && m.role !== 'assistant') {
      console.warn('[loadSession] Unknown role at index', index, ':', m.role, '— rendering as assistant bubble.');
    }

    if (!isUser) {
      // AI bubble — detect structured JSON payloads (modes 3/4/5).
      const json = tryJSON(content);
      if (json && (json.campaigns || json.overview)) {
        // Mode 5 (Campaign Analysis): render the full Brandwatch executive
        // dashboard directly — NOT a stub. The dashboard is pure DOM output
        // with no live closures, so it is safe to replay in history.
        renderCampaign(json);
      } else if (json && (json.overallScore != null || Array.isArray(json.criteria) || json.alignmentScore != null)) {
        // Mode 4 scorecard or analysis dashboard: pure DOM, no live closures — safe to replay.
        renderScorecard(json);
      } else if (json && (json.calendar || json.scorecard)) {
        // Modes 3 + 4 legacy: compact stubs because modal handlers rely on live closures.
        _renderRestoredStructuredStub(container, json, meta);
      } else {
        _renderRestoredBubble(container, 'system', content, meta);
      }
    } else {
      // User bubble — textContent path only. Never innerHTML. (XSS-safe.)
      _renderRestoredUserBubble(container, content);
    }
  });

  // 6. Sync in-memory state so the next message send continues this session.
  S.sid     = sessionId;
  S.msgs    = messages.length;   // keep counter consistent with rendered bubbles
  S.history = messages.map(m => ({
    role:    m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
    meta:    m.meta || (m.mode || m.service ? { mode: m.mode, service: m.service } : {}),
    ts:      m.ts,
  }));
  try { localStorage.setItem('mc_session', sessionId); } catch {}

  // Restore mode/forceMode from the most recent AI bubble so the next
  // turn routes to the correct mode handler on the backend.
  // CRITICAL: Never restore forceMode=1 when context is locked — doing so
  // re-triggers the onboarding flow for returning users whose project context
  // is already saved. Mode 1 is only valid when context is NOT yet locked.
  const lastAi = [...S.history].reverse().find(m => m.role === 'assistant' && m.meta?.mode);
  if (lastAi?.meta?.mode) {
    S.mode = lastAi.meta.mode;
    // Only carry forceMode forward if it isn't Mode 1 with a locked context
    if (!(lastAi.meta.mode === 1 && S.locked)) {
      S.forceMode = lastAi.meta.mode;
    } else {
      S.forceMode = null; // Let the backend's natural keyword detection take over
    }
  }

  // 7. Scroll to bottom + mark active in sidebar.
  container.scrollTop = container.scrollHeight;
  _highlightActiveChat(sessionId);

  // 8. Update sidebar session ID tag.
  updateUI();

  // 9. Update page title if the session has a known title.
  const activeItem = document.querySelector(`.sb-recent[data-session-id="${CSS.escape(sessionId)}"]`);
  const sessionTitle = activeItem?.querySelector('.sb-item-label')?.textContent?.trim();
  if (sessionTitle && sessionTitle !== 'New Chat') {
    document.title = `${sessionTitle} — Lumi`;
  }

  toast('Session resumed ✓', 'ok');
}

// User bubble path — explicit textContent for XSS safety. Single
// responsibility: never put user input through innerHTML.
function _renderRestoredUserBubble(msgsEl, content) {
  const wrap = document.createElement('div');
  wrap.className = 'msg user';

  const av = document.createElement('div');
  av.className = 'user-av';
  av.textContent = 'YOU';

  const stack = document.createElement('div');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;            // ← XSS-safe by construction
  stack.appendChild(bubble);

  wrap.appendChild(av);
  wrap.appendChild(stack);
  msgsEl.appendChild(wrap);
}

// Add or move the .is-active marker on the recent-chats sidebar.
function _highlightActiveChat(sessionId) {
  document.querySelectorAll('.sb-recent').forEach(el => {
    el.classList.toggle('is-active', el.dataset.sessionId === sessionId);
  });
}

/**
 * Render a plain text bubble (user or AI) during history restore.
 * Uses fmtTxt for safe markdown→HTML conversion — identical to the
 * live appendMsg path so formatting is perfectly preserved.
 */
function _renderRestoredBubble(msgsEl, role, content, meta = {}) {
  const isUser  = role === 'user';
  const wrap    = document.createElement('div');
  wrap.className = `msg ${isUser ? 'user' : 'system'}`;

  const av = isUser
    ? '<div class="user-av">YOU</div>'
    : '<div class="lumi-av">✨</div>';

  let metaLine = '';
  if (!isUser && meta?.mode) {
    const mn = { 1:'Context', 2:'Tools', 3:'Social', 4:'Content', 5:'Campaign' };
    let mt = `Mode ${meta.mode} — ${mn[meta.mode] || ''}`;
    if (meta.service && meta.service > 0)
      mt += ` — Tool ${String(meta.service).padStart(2, '0')}`;
    metaLine = `<div class="bubble-meta">${esc(mt)}</div>`;
  }

  wrap.innerHTML = `${av}<div>
    <div class="bubble">${fmtTxt(content)}</div>
    ${metaLine}
  </div>`;

  msgsEl.appendChild(wrap);
}

/**
 * Render a compact stub for structured AI responses (calendar,
 * scorecard, campaign) stored as JSON strings.  We don't attempt a
 * full re-render because the interactive UI elements (tabs, modals,
 * export buttons) rely on live JS closures that can't be serialised.
 * The stub makes the conversation flow readable and lets the user
 * re-run the analysis if they need the full view again.
 */
function _renderRestoredStructuredStub(msgsEl, json, meta = {}) {
  let icon = '📊', label = 'Analysis result';
  if (json.calendar)              { icon = '📅'; label = '4-Week Social Calendar'; }
  if (json.scorecard)             { icon = '🔍'; label = 'Content Interrogation'; }
  if (json.campaigns || json.overview) { icon = '📊'; label = 'Campaign Decision Engine'; }

  const wrap = document.createElement('div');
  wrap.className = 'msg system';

  let metaLine = '';
  if (meta?.mode) {
    const mn = { 1:'Context', 2:'Tools', 3:'Social', 4:'Content', 5:'Campaign' };
    metaLine = `<div class="bubble-meta">${esc(`Mode ${meta.mode} — ${mn[meta.mode] || ''}`)}</div>`;
  }

  wrap.innerHTML = `<div class="lumi-av">✨</div><div>
    <div class="bubble" style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:22px;">${icon}</span>
      <div>
        <div style="font-weight:700;color:var(--ink);margin-bottom:3px;">${label}</div>
        <div style="font-size:12px;color:var(--ink-3);">
          Previously generated — send a message to re-run this analysis.
        </div>
      </div>
    </div>
    ${metaLine}
  </div>`;

  msgsEl.appendChild(wrap);
}

// ── INPUT CONTROLLER ─────────────────────────────────────────
// State kept locally; S.img is still used for the image-to-AI pipeline.
const inputState = { files: [] };

function setupTA() {
  const ta  = document.getElementById('chat-input');
  const box = document.getElementById('lumi-input-box');

  // Auto-resize
  function autoResize() {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }
  ta.addEventListener('input', () => { autoResize(); updateSendBtn(); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // Attachment button — wire here so no onclick="" in HTML (avoids timing issues)
  document.getElementById('attachment-btn')?.addEventListener('click', () => {
    document.getElementById('file-upload')?.click();
  });

  // Send button — wire here too (belt-and-suspenders; onclick still present as fallback)
  document.getElementById('send-btn')?.addEventListener('click', () => send());

  // File picker
  const picker = document.getElementById('file-upload');
  if (picker) {
    picker.addEventListener('change', () => {
      Array.from(picker.files).forEach(f => addFile(f));
      picker.value = '';
    });
  }

  updateSendBtn();
}

export function triggerAttach() {
  document.getElementById('file-upload')?.click();
}

function addFile(file) {
  const MAX_FILES = 5;
  const MAX_MB    = 20;
  if (inputState.files.length >= MAX_FILES) {
    showInputError(`Max ${MAX_FILES} files`); return;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    showInputError(`${file.name} exceeds ${MAX_MB} MB`); return;
  }
  inputState.files.push(file);
  renderFileChip(file, inputState.files.length - 1);
}

function renderFileChip(file, idx) {
  const container = document.getElementById('file-preview-container');
  if (!container) return;
  const chip = document.createElement('div');
  chip.className = 'file-chip';
  chip.dataset.fileIdx = idx;
  chip.innerHTML = `
    <span class="file-chip-icon">${getFileIcon(file.type)}</span>
    <span class="file-chip-name">${file.name}</span>
    <button class="file-chip-rm" type="button" aria-label="Remove ${file.name}">✕</button>
  `;
  chip.querySelector('.file-chip-rm').addEventListener('click', () => removeFile(idx));
  container.appendChild(chip);
}

function removeFile(idx) {
  inputState.files.splice(idx, 1);
  // Re-render all chips
  const container = document.getElementById('file-preview-container');
  if (container) {
    container.innerHTML = '';
    inputState.files.forEach((f, i) => renderFileChip(f, i));
  }
}

function getFileIcon(mime = '') {
  if (mime.startsWith('image/'))       return '🖼️';
  if (mime === 'application/pdf')       return '📄';
  if (mime.includes('csv'))             return '📊';
  if (mime.includes('word') || mime.includes('docx')) return '📝';
  return '📎';
}

function updateSendBtn() {
  const ta  = document.getElementById('chat-input');
  const btn = document.getElementById('send-btn');
  if (!btn || !ta) return;
  const hasText  = ta.value.trim().length > 0;
  const hasFiles = inputState.files.length > 0;
  btn.disabled = S.loading || (!hasText && !hasFiles);
}

function showInputError(msg) {
  const el = document.getElementById('input-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'inline';
  setTimeout(() => { el.style.display = 'none'; el.textContent = ''; }, 3000);
}

export function resetInputArea() {
  const ta = document.getElementById('chat-input');
  if (ta) { ta.value = ''; ta.style.height = 'auto'; }
  inputState.files = [];
  const container = document.getElementById('file-preview-container');
  if (container) container.innerHTML = '';
  const errEl = document.getElementById('input-error');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  updateSendBtn();
}

function buildDots() { /* progress bar handled by updateUI */ }

// ── SEND ──────────────────────────────────────────────────────
export async function send() {
  console.log('%c[LUMI] send() FIRED', 'background:#FFD300;color:#000;font-weight:bold;padding:2px 8px');
  const ta = document.getElementById('chat-input');
  const message = ta.value.trim();
  if (!message || S.loading) return;

  hideEmpty();
  const userMsg = message;   // capture before clearing ta
  appendMsg('user', message, {}, S.img?.base64);
  resetInputArea();
  S.msgs++;

  const imgSend = S.img; clearImg();
  showLumi(); setLoading(true);

  try {
    const data = await sendChat({
      message,
      sessionId:      S.sid,
      mode:           S.forceMode,
      imageBase64:    imgSend?.base64,
      imageMediaType: imgSend?.mediaType,
      backendUrl:     S.backend,
    });

    if (data.session_id)              S.sid     = data.session_id;
    if (data.current_mode)            S.mode    = data.current_mode;
    if (data.current_section != null) S.section = data.current_section;
    if (data.current_service != null) S.service = data.current_service;
    if (data.context_locked  != null) S.locked  = data.context_locked;

    // After the first API call succeeds the backend session is live;
    // clear forceMode so subsequent messages use natural mode detection.
    S.forceMode = null;

    hideLumi();

    // ── Update in-memory history; backend save is fire-and-forget ──
    // The session_id is now confirmed by the backend response.
    //
    // GUARD: if S.history is empty here it means the user sent a message
    // after a page reload without the auto-resume completing (e.g. very fast
    // typist, or auto-resume was skipped).  Fetch the existing history from
    // the DB first so we append rather than overwrite — prevents the critical
    // "history wipe" bug where only the new turn would be persisted.
    if (S.history.length === 0 && S.sid) {
      try {
        const hdrPre = await getAuthHeaders();
        const preFetch = await fetch(`/api/history/${encodeURIComponent(S.sid)}`, { headers: hdrPre });
        if (preFetch.ok) {
          const prePay = await preFetch.json();
          if (Array.isArray(prePay?.messages) && prePay.messages.length > 0) {
            S.history = prePay.messages.map(m => ({
              role:    m.role === 'assistant' ? 'assistant' : 'user',
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
              meta:    m.meta || (m.mode || m.service ? { mode: m.mode, service: m.service } : {}),
              ts:      m.ts,
            }));
            console.debug('[send] Pre-fetched', S.history.length, 'existing messages to prevent history wipe.');
          }
        }
      } catch (preErr) {
        console.warn('[send] Pre-fetch of existing history failed (non-fatal):', preErr?.message);
      }
    }

    pushHistory('user', userMsg);

    if (data.message) {
      renderResp(data);
      pushHistory('assistant', data.message, {
        mode:    data.current_mode,
        service: data.current_service,
      });
    } else if (data.error) {
      appendMsg('system', `⚠ ${data.error}`);
      toast(data.error);
    }

    if (S.sid) {
      try { localStorage.setItem('mc_session', S.sid); } catch {}
      saveSession()
        .then(() => loadRecentChats())
        .catch(err => console.error('[send] saveSession rejected:', err));
    } else {
      console.error('[send] S.sid is null after API response — session not saved. data.session_id was:', data?.session_id);
    }
    updateUI();
  } catch (err) {
    hideLumi();
    appendMsg('system', `⚠ ${err.message}`);
    toast(err.message);
    console.error('[send] sendChat threw — saveSession was NOT called:', err?.message, err);
  } finally { setLoading(false); }
}

export function qs(m) {
  const ta = document.getElementById('chat-input');
  if (ta) { ta.value = m; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
  updateSendBtn();
  send();
}

// ── MARKETING TOOLS SUITE TRIGGER ────────────────────────────
// Displays a clean label in the chat bubble but sends a richer
// system-directive to the AI so the response is structured and
// routes the user to the right framework automatically.
export async function openMarketingTools() {
  if (S.loading) return;
  const displayLabel  = 'Open Marketing Tools Suite';
  const aiDirective   = "SYSTEM COMMAND: The user clicked the 'Marketing Tools' suite. List the core categories of your 18 specialist marketing frameworks (e.g., GTM strategy, Lead Gen, Email Sequences, etc.) in a highly structured, readable format. Ask the user to state their goal so you can auto-route them to the correct framework.";

  hideEmpty();
  appendMsg('user', displayLabel);
  S.msgs++;
  showLumi(); setLoading(true);

  try {
    const data = await sendChat({
      message:    aiDirective,
      sessionId:  S.sid,
      mode:       S.forceMode,
      backendUrl: S.backend,
    });

    if (data.session_id)              S.sid     = data.session_id;
    if (data.current_mode)            S.mode    = data.current_mode;
    if (data.current_section != null) S.section = data.current_section;
    if (data.current_service != null) S.service = data.current_service;
    if (data.context_locked  != null) S.locked  = data.context_locked;

    S.forceMode = null;
    hideLumi();

    // History: store the display label (not the directive) so the sidebar
    // title and session resume show a human-readable turn.
    pushHistory('user', displayLabel);

    if (data.message) {
      renderResp(data);
      pushHistory('assistant', data.message, {
        mode:    data.current_mode,
        service: data.current_service,
      });
    } else if (data.error) {
      appendMsg('system', `⚠ ${data.error}`);
      toast(data.error);
    }

    if (S.sid) {
      try { localStorage.setItem('mc_session', S.sid); } catch {}
      saveSession()
        .then(() => loadRecentChats())
        .catch(err => console.error('[openMarketingTools] saveSession rejected:', err));
    } else {
      console.error('[openMarketingTools] S.sid is null — session not saved. data.session_id was:', data?.session_id);
    }
    updateUI();
  } catch (err) {
    hideLumi();
    appendMsg('system', `⚠ ${err.message}`);
    toast(err.message);
    console.error('[openMarketingTools] sendChat threw — saveSession was NOT called:', err?.message, err);
  } finally { setLoading(false); }
}

// ── CAMPAIGN ANALYSIS — DUAL ENTRY ───────────────────────────
// Checks whether Meta Ads is connected for the active project.
// State A (disconnected): renders two choice cards into #msgs.
// State B (connected):    immediately fetches live Meta data and
//                         fires the executive analysis.
export async function openCampaignAnalysis() {
  if (S.loading) return;
  _startFreshSession();  // isolate tool from any active chat session

  const projectId = ProjectManager.getProjectId();
  if (!projectId) { toast('No active project — select one first.'); return; }

  // Show a transient "checking" bubble while we query the backend
  const msgs = document.getElementById('msgs');
  const loaderWrap = document.createElement('div');
  loaderWrap.className = 'msg system'; loaderWrap.id = 'campaign-gate-loader';
  loaderWrap.innerHTML = `<div class="lumi-av">✨</div><div><div class="bubble" style="color:var(--ink-3);font-size:13px;">Checking Meta Ads connection…</div></div>`;
  msgs.appendChild(loaderWrap);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const headers = await getAuthHeaders();
    const statusRes = await fetch(
      `/api/credentials/status?projectId=${encodeURIComponent(projectId)}&platform=meta_ads`,
      { headers }
    );
    const statusData = await statusRes.json();
    loaderWrap.remove();

    if (statusData.connected) {
      // ── STATE B: Connected — auto-fetch live data
      _runMetaCampaignAnalysis(projectId);
    } else {
      // ── STATE A: Disconnected — render choice cards
      _renderCampaignGate(projectId);
    }
  } catch (err) {
    loaderWrap.remove();
    appendMsg('system', `⚠ Could not check Meta connection: ${err.message}`);
  }
}

/**
 * Render the two choice cards (Connect Meta | Upload CSV).
 * This is inserted into #msgs like any other AI response.
 */
function _renderCampaignGate(projectId) {
  const msgs = document.getElementById('msgs');
  const wrap = document.createElement('div');
  wrap.className = 'msg system'; wrap.style.animation = 'msgIn 0.3s ease';
  wrap.innerHTML = `
    <div class="lumi-av">✨</div>
    <div style="flex:1;">
      <div class="bubble" style="padding:0;overflow:hidden;background:transparent;box-shadow:none;max-width:560px;">
        <div style="font-size:14px;font-weight:800;color:var(--ink);margin-bottom:14px;padding:0 4px;">
          📊 Campaign Analysis — Connect your data
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">

          <!-- Card A: Connect Meta Ads -->
          <div class="campaign-gate-card" id="gate-card-meta">
            <div class="cgc-icon">🔗</div>
            <div class="cgc-title">Connect Meta Ads API</div>
            <div class="cgc-desc">Pull live campaign data automatically. Requires Meta Business Manager access.</div>
            <button class="cgc-btn cgc-btn-primary"
                    onclick="window._app._connectMeta()">
              Connect Meta Ads
            </button>
          </div>

          <!-- Card B: Upload CSV -->
          <div class="campaign-gate-card" id="gate-card-csv">
            <div class="cgc-icon">📁</div>
            <div class="cgc-title">Upload Campaign CSV</div>
            <div class="cgc-desc">Export from Meta Ads Manager and upload here. Supports any platform export.</div>
            <label class="cgc-btn cgc-btn-secondary" style="cursor:pointer;">
              Choose CSV File
              <input type="file" accept=".csv,text/csv" style="display:none;"
                     onchange="window._app._handleCampaignCSV(this, '${esc(projectId)}')">
            </label>
          </div>
        </div>
      </div>
    </div>`;
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

/**
 * Triggered when the user picks a CSV file from the gate card.
 * Reads file → sends to /api/campaigns/data-inject → renders analysis.
 */
export async function _handleCampaignCSV(input, projectId) {
  const file = input.files?.[0];
  if (!file) return;

  // Replace the gate card with a loading state
  const gateCard = input.closest('.msg');
  if (gateCard) {
    gateCard.innerHTML = `
      <div class="lumi-av"><span style="display:inline-block;animation:lSpin 1s linear infinite;">✨</span></div>
      <div><div class="bubble" style="color:var(--ink-3);font-size:13px;">
        Reading <strong>${esc(file.name)}</strong> and running executive analysis…
      </div></div>`;
  }

  let csvData;
  try {
    csvData = await file.text();
  } catch (err) {
    if (gateCard) gateCard.remove();
    appendMsg('system', '⚠ Could not read the CSV file — please try again.');
    return;
  }

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/campaigns/data-inject', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ sessionId: S.sid, projectId, csvData }),
    });
    if (gateCard) gateCard.remove();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      appendMsg('system', `⚠ ${err.message || 'Campaign analysis failed'}`);
      return;
    }

    const data = await res.json();
    _finaliseCampaignResponse(data);
  } catch (err) {
    if (gateCard) gateCard.remove();
    appendMsg('system', `⚠ ${err.message}`);
  }
}

/**
 * Fetch live Meta Ads insights and run analysis.
 * Called when credentials ARE connected (State B).
 */
async function _runMetaCampaignAnalysis(projectId) {
  const wrap = document.createElement('div');
  wrap.className = 'msg system'; wrap.id = 'meta-fetch-loader';
  wrap.innerHTML = `
    <div class="lumi-av"><span style="display:inline-block;animation:lSpin 1s linear infinite;">✨</span></div>
    <div><div class="bubble" style="color:var(--ink-3);font-size:13px;">
      Pulling live Meta Ads data and running executive analysis…
    </div></div>`;
  document.getElementById('msgs').appendChild(wrap);
  document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight;

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/campaigns/fetch-meta', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ sessionId: S.sid, projectId }),
    });
    document.getElementById('meta-fetch-loader')?.remove();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // If token expired, downgrade to gate UI so user can reconnect
      if (res.status === 401) {
        toast('Meta token expired — please reconnect.', 'err');
        _renderCampaignGate(projectId);
        return;
      }
      appendMsg('system', `⚠ ${err.message || 'Meta fetch failed'}`);
      return;
    }

    const data = await res.json();
    _finaliseCampaignResponse(data);
  } catch (err) {
    document.getElementById('meta-fetch-loader')?.remove();
    appendMsg('system', `⚠ ${err.message}`);
  }
}

/**
 * Common finalisation for both CSV and Meta API paths.
 * Renders the AI response and persists the session.
 */
function _finaliseCampaignResponse(data) {
  if (data.session_id) S.sid  = data.session_id;
  S.mode    = 5;
  S.service = data.current_service || 0;

  // Push to in-memory history (display label, not the raw CSV prompt)
  pushHistory('user', 'Campaign Analysis — data submitted');
  if (data.message) {
    renderResp(data);   // will route to renderCampaign() for JSON
    pushHistory('assistant', data.message, { mode: 5, service: data.current_service || 0 });
  }

  if (S.sid) {
    try { localStorage.setItem('mc_session', S.sid); } catch {}
    saveSession()
      .then(() => loadRecentChats())
      .catch(err => console.error('[campaign] saveSession rejected:', err));
  }
  updateUI();
}

/** Redirect to Meta OAuth connect — used by the gate card button */
export function _connectMeta() {
  const projectId = ProjectManager.getProjectId();
  if (!projectId) { toast('No active project'); return; }
  window.location.href = `/api/auth/meta/connect?projectId=${encodeURIComponent(projectId)}`;
}

/**
 * Called on page load — detects a ?meta_connected=1 or ?meta_error=
 * query param left by the OAuth callback redirect and handles it.
 */
function _handleMetaOAuthReturn() {
  const params    = new URLSearchParams(window.location.search);
  const connected = params.get('meta_connected');
  const metaErr   = params.get('meta_error');

  if (!connected && !metaErr) return;

  // Clean the URL so the params don't persist after a refresh
  const clean = window.location.pathname;
  window.history.replaceState({}, '', clean);

  if (metaErr) {
    const msgs = {
      denied:            'Meta connection cancelled.',
      invalid_state:     'OAuth state mismatch — please try connecting again.',
      project_not_found: 'Project not found — please refresh and try again.',
      server_error:      'Server error during Meta connection. Try again.',
    };
    toast(msgs[metaErr] || `Meta connection failed: ${metaErr}`, 'err');
    return;
  }

  if (connected) {
    toast('✓ Meta Ads connected! Fetching your campaign data…', 'ok');
    // Auto-trigger campaign analysis with the freshly connected account
    const projectId = params.get('projectId') || ProjectManager.getProjectId();
    if (projectId) setTimeout(() => _runMetaCampaignAnalysis(projectId), 1200);
  }
}

// ── SESSION RESET HELPER ──────────────────────────────────────
// Clears all in-memory session state and the chat container so that
// tool results render into a clean, tool-scoped view. Called before
// opening any standalone tool (Content Calendar, Campaign Analysis)
// to prevent tool output from being appended to an unrelated chat session.
function _startFreshSession() {
  S.sid      = null;
  S.history  = [];
  S.mode     = 1;
  S.section  = 0;
  S.service  = 0;
  S.locked   = true;  // project context always available
  S.msgs     = 0;
  S.forceMode = null;
  try { localStorage.removeItem('mc_session'); } catch {}

  const msgs = document.getElementById('msgs');
  if (msgs) msgs.innerHTML = '';    // clear chat area — no empty-state, tool fills it
  updateUI();
}

// ── CONTENT CALENDAR TOOL ─────────────────────────────────────
// Opens the Content Calendar modal. All logic is self-contained
// so it does not interfere with the main chat session state (S.*).

export function openContentCalendar() {
  const modal = document.getElementById('cal-modal');
  if (!modal) return;
  _startFreshSession();  // isolate tool from any active chat session
  _calReset();           // clear any previous modal state before showing
  _wireSectorToggle();   // attach change listener (idempotent — guards against double-wire)
  modal.style.display = 'flex';
  // Focus first input for keyboard users
  setTimeout(() => document.getElementById('cal-month')?.focus(), 120);
}

export function closeContentCalendar() {
  const modal = document.getElementById('cal-modal');
  if (modal) modal.style.display = 'none';
}

export function _calClearErr() {
  const el = document.getElementById('cal-err');
  if (el) el.style.display = 'none';
}

export function _calReset() {
  const monthEl        = document.getElementById('cal-month');
  const sectorEl       = document.getElementById('cal-sector');
  const customSectorEl = document.getElementById('cal-custom-sector');
  const focusEl        = document.getElementById('cal-focus');
  const formEl         = document.getElementById('cal-form');
  const resEl          = document.getElementById('cal-result');
  const errEl          = document.getElementById('cal-err');
  const btn            = document.getElementById('cal-generate-btn');
  const btnLbl         = document.getElementById('cal-btn-label');

  if (monthEl)        monthEl.value  = '';
  if (sectorEl)       sectorEl.value = '';
  if (customSectorEl) { customSectorEl.value = ''; customSectorEl.style.display = 'none'; }
  if (focusEl)        focusEl.value  = '';
  if (errEl)          { errEl.textContent = ''; errEl.style.display = 'none'; }
  if (formEl)         formEl.style.display = 'flex';
  if (resEl)          resEl.style.display  = 'none';
  if (btn)            btn.disabled = false;
  if (btnLbl)         btnLbl.textContent = '✨ Generate Calendar';
  // Hide CSV export button — only shown after a successful JSON render
  const csvBtn = document.getElementById('btn-export-cal-csv');
  if (csvBtn) csvBtn.style.display = 'none';
}

// Toggle the custom sector input when "Other" is selected.
// Attached once on modal open via openContentCalendar().
function _wireSectorToggle() {
  const sectorEl       = document.getElementById('cal-sector');
  const customSectorEl = document.getElementById('cal-custom-sector');
  if (!sectorEl || !customSectorEl) return;
  // Guard against double-wiring if modal is reopened
  if (sectorEl.dataset.toggleWired) return;
  sectorEl.addEventListener('change', () => {
    const isOther = sectorEl.value === 'Other';
    customSectorEl.style.display = isOther ? 'block' : 'none';
    if (!isOther) customSectorEl.value = '';
    _calClearErr();
  });
  sectorEl.dataset.toggleWired = 'true';
}

export async function _generateCalendar() {
  const projectId      = ProjectManager.getProjectId();
  const targetMonth    = document.getElementById('cal-month')?.value.trim();
  const sectorRaw      = document.getElementById('cal-sector')?.value;
  const customSector   = document.getElementById('cal-custom-sector')?.value.trim();
  const keyFocus       = document.getElementById('cal-focus')?.value.trim();

  // Resolve the final sector value sent to the backend:
  // if "Other" was chosen, use whatever the user typed in the custom input.
  const targetSector = sectorRaw === 'Other' ? customSector : sectorRaw;

  // Validate
  const errEl = document.getElementById('cal-err');
  const showCalErr = (msg) => {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  };
  if (!projectId)    { showCalErr('No active project — select a project first.'); return; }
  if (!targetMonth)  { showCalErr('Please enter a target month and year (e.g. July 2025).'); return; }
  if (!sectorRaw)    { showCalErr('Please select a target sector.'); return; }
  if (sectorRaw === 'Other' && !customSector) {
    showCalErr('Please specify your sector in the text field below the dropdown.');
    document.getElementById('cal-custom-sector')?.focus();
    return;
  }
  if (!keyFocus)     { showCalErr('Please describe your key focus or campaign goal.'); return; }

  _calClearErr();

  // Set loading state
  const btn    = document.getElementById('cal-generate-btn');
  const btnLbl = document.getElementById('cal-btn-label');
  if (btn)    btn.disabled = true;
  if (btnLbl) btnLbl.innerHTML = '<span style="display:inline-block;animation:lSpin 1s linear infinite;">✨</span> Generating…';

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/tools/content-calendar', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ projectId, targetMonth, targetSector, keyFocus }),
    });

    const data = await res.json();

    if (!res.ok || data.status !== 'ok') {
      showCalErr(data.message || 'Calendar generation failed — please try again.');
      if (btn)    btn.disabled = false;
      if (btnLbl) btnLbl.textContent = '✨ Generate Calendar';
      return;
    }

    // Render result
    const formEl    = document.getElementById('cal-form');
    const resEl     = document.getElementById('cal-result');
    const bodyEl    = document.getElementById('cal-result-body');

    if (formEl) formEl.style.display = 'none';
    if (resEl)  resEl.style.display  = 'block';

    // Attempt JSON parse → visual dashboard; fallback to markdown.
    // Aggressive extraction: find the outermost { … } to strip any
    // conversational padding, markdown fences, or stray backticks the
    // AI may have injected before/after the JSON object.
    if (bodyEl) {
      const raw = data.result || '';
      let parsed = null;
      try {
        const first = raw.indexOf('{');
        const last  = raw.lastIndexOf('}');
        if (first !== -1 && last > first) {
          parsed = JSON.parse(raw.slice(first, last + 1));
        }
      } catch (_e) { parsed = null; }

      if (parsed && parsed.calendar) {
        _renderCalendarDashboard(bodyEl, parsed);
        bodyEl.dataset.raw     = _calendarToText(parsed);
        bodyEl.dataset.calJson = JSON.stringify(parsed);   // for CSV export
        // Unhide CSV export button
        const csvBtn = document.getElementById('btn-export-cal-csv');
        if (csvBtn) csvBtn.style.display = '';
      } else {
        // Fallback: plain markdown render
        bodyEl.innerHTML   = fmtTxt(raw);
        bodyEl.dataset.raw = raw;
        delete bodyEl.dataset.calJson;
        const csvBtn = document.getElementById('btn-export-cal-csv');
        if (csvBtn) csvBtn.style.display = 'none';
      }
    }

  } catch (err) {
    showCalErr(`Network error: ${err.message}`);
    if (btn)    btn.disabled = false;
    if (btnLbl) btnLbl.textContent = '✨ Generate Calendar';
  }
}

// ── Calendar dashboard renderer ───────────────────────────────
function _platformBadgeClass(platform = '') {
  const p = platform.toLowerCase();
  if (p === 'linkedin')  return 'cal-badge-linkedin';
  if (p === 'instagram') return 'cal-badge-instagram';
  if (p === 'facebook')  return 'cal-badge-facebook';
  if (p === 'x')         return 'cal-badge-x';
  if (p === 'tiktok')    return 'cal-badge-tiktok';
  return 'cal-badge-default';
}

function _platformEmoji(platform = '') {
  const p = platform.toLowerCase();
  if (p === 'linkedin')  return '💼';
  if (p === 'instagram') return '📸';
  if (p === 'facebook')  return '👥';
  if (p === 'x')         return '𝕏';
  if (p === 'tiktok')    return '🎵';
  return '📢';
}

function _renderCalendarDashboard(container, data) {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  let html = '';

  // Editorial note banner
  if (data.editorial_note) {
    html += `<div class="cal-editorial-note"><strong>📝 Strategy Note:</strong> ${esc(data.editorial_note)}</div>`;
  }

  // Group posts by week
  const byWeek = {};
  (data.calendar || []).forEach(post => {
    const w = post.week || 0;
    if (!byWeek[w]) byWeek[w] = [];
    byWeek[w].push(post);
  });

  const weeks = Object.keys(byWeek).sort((a, b) => a - b);
  weeks.forEach(w => {
    html += `<div class="cal-week-label">Week ${w}</div>`;
    html += `<div class="cal-cards-grid">`;
    byWeek[w].forEach(post => {
      const badgeClass = _platformBadgeClass(post.platform);
      const emoji      = _platformEmoji(post.platform);
      html += `
        <div class="cal-post-card">
          <div class="cal-card-header">
            <span class="cal-platform-badge ${badgeClass}">${emoji} ${esc(post.platform)}</span>
            <span class="cal-card-date">${esc(post.date)}</span>
          </div>
          <div class="cal-card-copy">${esc(post.copy)}</div>
          <div class="cal-card-visual">${esc(post.visual)}</div>
        </div>`;
    });
    html += `</div>`;
  });

  container.innerHTML = html;
}

// Convert parsed JSON calendar to plain text for clipboard
function _calendarToText(data) {
  const lines = [];
  lines.push(`CONTENT CALENDAR — ${data.month || ''} | ${data.sector || ''} | ${data.goal || ''}`);
  lines.push('');
  if (data.editorial_note) {
    lines.push('STRATEGY NOTE');
    lines.push(data.editorial_note);
    lines.push('');
  }
  const byWeek = {};
  (data.calendar || []).forEach(post => {
    const w = post.week || 0;
    if (!byWeek[w]) byWeek[w] = [];
    byWeek[w].push(post);
  });
  Object.keys(byWeek).sort((a,b) => a-b).forEach(w => {
    lines.push(`── WEEK ${w} ──`);
    byWeek[w].forEach(post => {
      lines.push(`[${post.platform}] ${post.date}`);
      lines.push(post.copy || '');
      lines.push(`Visual: ${post.visual || ''}`);
      lines.push('');
    });
  });
  return lines.join('\n');
}

// ── Calendar CSV export ───────────────────────────────────────
export function _exportCalendarCSV() {
  const bodyEl = document.getElementById('cal-result-body');
  const raw    = bodyEl?.dataset?.calJson;
  if (!raw) { toast('Generate a calendar first', 'err'); return; }

  let parsed;
  try { parsed = JSON.parse(raw); } catch { toast('Export failed — invalid data', 'err'); return; }

  const csvEsc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Week', 'Date', 'Platform', 'Copy', 'Visual Concept'].map(csvEsc).join(',');
  const rows   = (parsed.calendar || []).map(p =>
    [p.week, p.date, p.platform, p.copy, p.visual].map(csvEsc).join(',')
  );
  const csv  = [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `content-calendar-${(parsed.month || 'export').replace(/\s+/g, '-').toLowerCase()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('CSV exported ✓', 'ok');
}

export function _copyCalendar() {
  const raw = document.getElementById('cal-result-body')?.dataset.raw || '';
  if (!raw) { toast('Nothing to copy yet', 'err'); return; }
  navigator.clipboard?.writeText(raw)
    .then(() => toast('Content calendar copied ✓', 'ok'))
    .catch(() => toast('Copy failed — select the text manually', 'err'));
}

// Close cal-modal on backdrop click
document.addEventListener('click', (e) => {
  if (e.target?.id === 'cal-modal') closeContentCalendar();
});

// ── CRM SYNC ──────────────────────────────────────────────────
export async function syncCRM(type, payload) {
  toast('🚀 Sending to CRM…', 'inf');
  try {
    const data = await exportToCRM({
      sessionId: S.sid, exportType: type, payload,
      label: `${type} — ${new Date().toLocaleDateString()}`,
      backendUrl: S.backend,
    });
    toast(data.webhook_forwarded ? `✓ Synced (${data.export_id})` : '✓ Export ready — configure N8N_EXPORT_WEBHOOK', 'ok');
  } catch (e) { toast(`Sync failed: ${e.message}`); }
}

export function syncCRMBtn(btn) { const b = btn.closest('.action-bridge'); syncCRM(b._t, b._p); }

export function dlCSV(btn) {
  const b = btn.closest('.action-bridge');
  const { _t: type, _p: payload } = b;
  let headers = [], rows = [];
  if (type === 'campaign' && payload?.campaigns) {
    headers = ['campaign_name','decision','impact_score','reasoning','horizontal_scaling_advice'];
    rows = payload.campaigns.map(c => headers.map(h => `"${(c[h] || '').toString().replace(/"/g, '""')}"`));
  } else if (type === 'social' && payload?.calendar) {
    headers = ['week','day','platform','pillar','format','hook','funnel_stage','cta'];
    rows = payload.calendar.map(c => headers.map(h => `"${(c[h] || '').toString().replace(/"/g, '""')}"`));
  } else { toast('No CSV for this type.'); return; }
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `marcom-${type}-${Date.now()}.csv`;
  a.click();
  toast('CSV downloaded ✓', 'ok');
}

export function copyLink() {
  navigator.clipboard?.writeText(`${window.location.origin}?session=${S.sid || ''}`).catch(() => {});
  toast('Client link copied 🔗', 'ok');
}

// ── LUMI LOADER ───────────────────────────────────────────────
function showLumi() {
  const msgs = document.getElementById('msgs');
  const el = document.createElement('div'); el.className = 'lumi-loader'; el.id = 'lumiLoader';
  el.innerHTML = `<div class="lumi-av"><span style="display:inline-block;animation:lSpin 1s linear infinite;">✨</span></div>
    <div class="lumi-loader-body"><div class="ll-head">Lumi is thinking…</div>
      <div class="ll-thought" id="llThought">Initializing…</div>
      <div class="skel-lines"><div class="skel w90"></div><div class="skel w70"></div><div class="skel w55"></div></div>
    </div>`;
  msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
  thinkIdx = Math.floor(Math.random() * LUMI_THOUGHTS.length);
  const t = document.getElementById('llThought'); if (t) t.textContent = LUMI_THOUGHTS[thinkIdx];
  thinkTimer = setInterval(() => {
    thinkIdx = (thinkIdx + 1) % LUMI_THOUGHTS.length;
    const t2 = document.getElementById('llThought'); if (t2) t2.textContent = LUMI_THOUGHTS[thinkIdx];
  }, 2000);
}

function hideLumi() {
  clearInterval(thinkTimer); thinkTimer = null;
  document.getElementById('lumiLoader')?.remove();
}

function setLoading(l) {
  S.loading = l;
  const btn = document.getElementById('send-btn');
  const ta  = document.getElementById('chat-input');
  if (ta) ta.disabled = l;
  if (btn) {
    if (l) {
      btn.classList.add('loading');
      btn.disabled = true;
      // Replace icon with a simple spinner SVG
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" style="animation:spinSend 0.8s linear infinite;transform-origin:center"/></svg>`;
    } else {
      btn.classList.remove('loading');
      btn.innerHTML = `<svg id="send-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg><span id="send-label" style="display:none">Send</span>`;
      updateSendBtn();
    }
  }
}

// ── MODE SWITCH (kept for programmatic use; no UI panel) ──────
export function setMode(m) {
  S.forceMode = m; if (m) S.mode = m;
  updateUI();
}

// ── SESSION RESET ─────────────────────────────────────────────
export function clearSession() {
  if (!confirm('Clear session and start over?')) return;
  S.sid = null; S.mode = 1; S.section = 0; S.service = 0;
  S.locked = false; S.msgs = 0; S.forceMode = null; S.img = null;
  S.history = [];
  clearImg();
  try { localStorage.removeItem('mc_session'); } catch {}
  document.getElementById('msgs').innerHTML =
    `<div class="empty" id="emptyState"><div class="empty-lumi">✨</div><div class="empty-divider"></div><div class="empty-tagline">Session cleared. Let's go again.</div></div>`;
  updateUI();
}

// ── TOAST ─────────────────────────────────────────────────────
export function toast(msg, t = 'err') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${t === 'ok' ? 'ok' : t === 'inf' ? 'inf' : 'err'} vis`;
  setTimeout(() => el.classList.remove('vis'), 3500);
}

// ── WINDOW FACADE (used by HTML inline event handlers) ────────
// ── MOBILE SIDEBAR TOGGLE ─────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('sidebar-open');
  document.getElementById('mobile-overlay').classList.add('overlay-open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('sidebar-open');
  document.getElementById('mobile-overlay').classList.remove('overlay-open');
}

window._app = {
  send, qs, showWizard, selTile, wNext, wizDone, wizManual, renderWizStep, wizSetCountry,
  setWizUrl, handleFile, clearImg, syncCRMBtn, dlCSV, copyLink,
  clearSession, setMode, updateUI, toast, esc,
  saveChatSession, loadRecentChats, resumeChat, deleteSession,
  openSidebar, closeSidebar,
  triggerAttach, resetInputArea,
  ProjectManager,
  openMarketingTools,
  // Campaign Analysis (Meta Ads + CSV dual-entry)
  openCampaignAnalysis,
  _connectMeta,
  _handleCampaignCSV,
  // Content Calendar Tool
  openContentCalendar,
  closeContentCalendar,
  _calReset,
  _calClearErr,
  _generateCalendar,
  _copyCalendar,
  _exportCalendarCSV,
};
