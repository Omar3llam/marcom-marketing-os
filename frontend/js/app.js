// ============================================================
// MARCOM — Application Entry Point  (frontend/js/app.js)
// Handles auth bootstrapping, send flow, and the window._app
// facade used by inline HTML event handlers.
// ============================================================
import { sendChat, exportToCRM } from './api.js?v=20260426-3';
import { S, updateUI } from './state.js?v=20260426-3';
import { renderResp, appendMsg, esc, hideEmpty, tryJSON, fmtTxt } from './renderers.js?v=20260426-3';
import { showWizard, renderWizStep, selTile, wNext, wizDone, wizManual, wizSetCountry, setWizUrl } from './wizard.js?v=20260426-3';
import { handleFile, clearImg } from './media.js?v=20260426-3';

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
      // Historical replay shows a compact stub instead of dumping raw JSON.
      // The LIVE Mode 4 → Modal Dashboard flow is unaffected: it runs
      // through renderResp() in the send() path, not here.
      const json = tryJSON(content);
      if (json && (json.calendar || json.scorecard || json.campaigns)) {
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
  const lastAi = [...S.history].reverse().find(m => m.role === 'assistant' && m.meta?.mode);
  if (lastAi?.meta?.mode) {
    S.mode      = lastAi.meta.mode;
    S.forceMode = lastAi.meta.mode;
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
  if (json.calendar)  { icon = '📅'; label = '4-Week Social Calendar'; }
  if (json.scorecard) { icon = '🔍'; label = 'Content Interrogation'; }
  if (json.campaigns) { icon = '📊'; label = 'Campaign Decision Engine'; }

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
};
