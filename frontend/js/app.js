// ============================================================
// MARCOM — Application Entry Point  (frontend/js/app.js)
// Handles auth bootstrapping, send flow, and the window._app
// facade used by inline HTML event handlers.
// ============================================================
import { sendChat, exportToCRM } from './api.js';
import { S, updateUI } from './state.js';
import { renderResp, appendMsg, esc, hideEmpty, tryJSON, fmtTxt } from './renderers.js';
import { showWizard, renderWizStep, selTile, wNext, wizDone, wizManual, wizSetCountry, setWizUrl } from './wizard.js';
import { handleFile, clearImg } from './media.js';

// ── LUMI THOUGHTS (rotating loader text) ─────────────────────
const LUMI_THOUGHTS = [
  'Scanning GCC competitors…', 'Extracting B2B search intent…',
  'Mapping funnel stage patterns…', 'Calculating confidence scores…',
  'Analyzing brand positioning signals…', 'Running PESTLE analysis…',
  'Evaluating creative fatigue…', 'Cross-referencing market data…',
  'Finalizing strategy…', 'Generating insight cards…',
];
let thinkTimer = null, thinkIdx = 0;

// ── CLERK INIT ────────────────────────────────────────────────
// Using @clerk/clerk-js@4 CDN which bundles UI components.
// window.Clerk is set as an instance by the data-clerk-publishable-key auto-init.
window.addEventListener('load', async () => {
  const authContainer = document.getElementById('auth-container');
  const signInEl      = document.getElementById('clerk-sign-in');

  console.log('[Clerk Init] window.Clerk:', typeof window.Clerk, window.Clerk);

  if (!window.Clerk) {
    console.error('[Clerk Init Error]: Clerk script failed to load completely from the CDN.');
    authContainer.style.display = 'flex';
    if (signInEl) signInEl.innerHTML = '<p style="color:#e74c3c;font-size:13px;text-align:center;">Auth service unavailable. Please refresh.</p>';
    return;
  }

  try {
    await window.Clerk.load({
      appearance: {
        variables: { colorPrimary: '#FFD300', colorBackground: '#fff', borderRadius: '20px', fontFamily: 'Poppins' },
      },
    });
    console.log('[Clerk Init] load() succeeded. user:', window.Clerk.user);
  } catch (err) {
    console.error('[Clerk Init Error]:', err);
    authContainer.style.display = 'flex';
    if (signInEl) signInEl.innerHTML = '<p style="color:#e74c3c;font-size:13px;text-align:center;">Auth service unavailable. Please refresh.</p>';
    return;
  }

  const clerk = window.Clerk;

  if (clerk.user) { boot(clerk); return; }

  // app.html is a protected route. Unauthenticated visitors are sent
  // back to the landing page where Clerk handles sign-in.
  console.log('[Clerk] No active session — redirecting to /');
  window.location.replace('/');
  return;
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

  const b = localStorage.getItem('mc_backend');
  const sid = localStorage.getItem('mc_session');
  if (b)   { S.backend = b; }
  if (sid) { S.sid = sid; }

  updateUI(); setupTA(); buildDots();
  loadRecentChats();
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
 */
function deriveTitle() {
  const first = S.history.find(m => m.role === 'user' && typeof m.content === 'string');
  return first ? first.content.replace(/\s+/g, ' ').trim().slice(0, 40) : 'New Chat';
}

/**
 * POST the current session to the backend. Fire-and-forget — must
 * never block the UI or the next message send.
 */
async function saveSession() {
  if (!S.sid || !S.history.length) return;
  try {
    const headers = await getAuthHeaders();
    await fetch('/api/history/save', {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        sessionId: S.sid,
        title:     deriveTitle(),
        messages:  S.history,
      }),
    });
  } catch (err) {
    console.warn('[Lumi] saveSession failed:', err?.message);
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
    const headers = await getAuthHeaders();
    const res = await fetch('/api/history/list', { headers });
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
      const safeId = (s.sessionId || '').replace(/'/g, "\\'");
      const label  = (s.title || 'New Chat').slice(0, 28);
      return `<div class="sb-item sb-recent" onclick="window._app.resumeChat('${safeId}')" title="${s.sessionId}">
        <span class="sb-item-icon">💬</span>
        <span class="sb-item-label">${esc(label)}</span>
      </div>`;
    }).join('');
  } catch (err) {
    console.warn('[Lumi] loadRecentChats failed:', err?.message);
    list.innerHTML = '<div style="padding:6px 12px;font-size:11px;color:var(--ink-3);font-style:italic;">Offline — history unavailable.</div>';
  }
}

/**
 * Resume a saved session: GET /api/history/:sessionId,
 * render every bubble, restore S.history.
 */
export async function resumeChat(sessionId) {
  if (!sessionId) return;

  S.sid = sessionId;
  // Pointer to "last active session id" — small UX nicety, not chat data.
  try { localStorage.setItem('mc_session', sessionId); } catch {}

  const msgs = document.getElementById('msgs');
  if (msgs) msgs.innerHTML = '';

  let payload = null;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/history/${encodeURIComponent(sessionId)}`, { headers });
    if (!res.ok) {
      toast(res.status === 404 ? 'Session not found' : 'Failed to load session');
      return;
    }
    payload = await res.json();
  } catch (err) {
    console.warn('[Lumi] resumeChat fetch failed:', err?.message);
    toast('Could not load session — please try again');
    return;
  }

  const history = Array.isArray(payload?.messages) ? payload.messages : [];
  S.history = history.map(m => ({
    role:    m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
    meta:    m.meta || (m.mode || m.service ? { mode: m.mode, service: m.service } : {}),
    ts:      m.ts,
  }));

  // Restore mode/lock from message metadata so the chips render correctly
  // and the next backend call routes to the right mode.
  const lastAi = [...S.history].reverse().find(m => m.role === 'assistant' && m.meta?.mode);
  if (lastAi?.meta?.mode) {
    S.mode      = lastAi.meta.mode;
    S.forceMode = lastAi.meta.mode;
  }

  if (!S.history.length) {
    if (msgs) msgs.innerHTML = `
      <div class="empty" id="emptyState">
        <div class="empty-lumi">✨</div>
        <div class="empty-divider"></div>
        <div class="empty-tagline" style="font-size:13px;color:var(--ink-3);">
          Session restored — continue the conversation below.
        </div>
      </div>`;
  } else {
    S.history.forEach(({ role, content, meta }) => {
      if (role === 'user') {
        _renderRestoredBubble(msgs, 'user', content, meta);
      } else {
        // AI bubble — detect structured JSON (modes 3/4/5) vs plain text.
        // Mode 4 dashboard modal flow is unaffected: structured stubs are
        // only used for HISTORICAL replay; the live response still goes
        // through renderResp() in the send() path.
        const json = tryJSON(content);
        if (json && (json.calendar || json.scorecard || json.campaigns)) {
          _renderRestoredStructuredStub(msgs, json, meta);
        } else {
          _renderRestoredBubble(msgs, 'system', content, meta);
        }
      }
    });
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  updateUI();
  toast('Session resumed ✓', 'ok');
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

// ── TEXTAREA AUTO-RESIZE ──────────────────────────────────────
function setupTA() {
  const ta = document.getElementById('msgInput');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}
function buildDots() { /* progress bar handled by updateUI */ }

// ── SEND ──────────────────────────────────────────────────────
export async function send() {
  const ta = document.getElementById('msgInput');
  const message = ta.value.trim();
  if (!message || S.loading) return;

  hideEmpty();
  const userMsg = message;   // capture before clearing ta
  appendMsg('user', message, {}, S.img?.base64);
  ta.value = ''; ta.style.height = 'auto';
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
      // "Last active session" pointer — kept in localStorage for reload restore;
      // not chat data.
      try { localStorage.setItem('mc_session', S.sid); } catch {}
      // Background save — never await, must not block UI.
      saveSession();
      // Refresh sidebar so the title bumps to the top.
      loadRecentChats();
    }
    updateUI();
  } catch (err) {
    hideLumi();
    appendMsg('system', `⚠ ${err.message}`);
    toast(err.message);
  } finally { setLoading(false); }
}

export function qs(m) { document.getElementById('msgInput').value = m; send(); }

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
  const btn = document.getElementById('sendBtn'), ta = document.getElementById('msgInput');
  btn.disabled = l; ta.disabled = l;
  btn.innerHTML = l ? '<span style="animation:lSpin 1s linear infinite;display:inline-block;">✨</span> Analyzing'
                    : '<span>✨</span> Send';
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
  saveChatSession, loadRecentChats, resumeChat,
  openSidebar, closeSidebar,
};
