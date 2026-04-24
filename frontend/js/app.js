// ============================================================
// MARCOM — Application Entry Point  (frontend/js/app.js)
// Handles auth bootstrapping, send flow, config panel, and
// the window._app facade used by inline HTML event handlers.
// ============================================================
import { sendChat, exportToCRM } from './api.js';
import { S, updateUI } from './state.js';
import { renderResp, appendMsg, esc, hideEmpty } from './renderers.js';
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

  authContainer.style.display = 'flex';

  try {
    clerk.mountSignIn(signInEl, {
      appearance: {
        variables: { colorPrimary: '#FFD300', colorBackground: '#fff', borderRadius: '20px', fontFamily: 'Poppins' },
        elements: {
          card: 'box-shadow:0 8px 40px rgba(0,0,0,0.1);border-radius:20px;',
          formButtonPrimary: 'font-weight:700;',
        },
      },
      afterSignInUrl: window.location.href,
    });
    console.log('[Clerk Init] mountSignIn() called successfully.');
  } catch (err) {
    console.error('[Clerk Init Error]:', err);
    if (signInEl) signInEl.innerHTML = '<p style="color:#e74c3c;font-size:13px;text-align:center;">Sign-in failed to load. Please refresh.</p>';
  }

  clerk.addListener(({ user }) => { if (user) boot(clerk); });
});

function boot(clerk) {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('app-container').classList.add('visible');

  if (clerk?.mountUserButton) {
    clerk.mountUserButton(document.getElementById('user-button'), {
      appearance: { elements: { userButtonAvatarBox: 'width:32px;height:32px;border-radius:50%;border:2px solid var(--border);' } },
    });
  }

  const b = localStorage.getItem('mc_backend');
  const sid = localStorage.getItem('mc_session');
  if (b)   { document.getElementById('cfgBackend').value = b; S.backend = b; }
  if (sid) { S.sid = sid; document.getElementById('cfgSession').value = sid; }

  updateUI(); setupTA(); buildDots();

  const stAuth = document.getElementById('stAuth');
  stAuth.textContent = clerk?.user?.primaryEmailAddress?.emailAddress || '✓ Signed in';
  stAuth.className = 's-ok';
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

    if (data.session_id)             S.sid     = data.session_id;
    if (data.current_mode)           S.mode    = data.current_mode;
    if (data.current_section != null) S.section = data.current_section;
    if (data.current_service != null) S.service = data.current_service;
    if (data.context_locked  != null) S.locked  = data.context_locked;

    hideLumi();
    if (data.message) renderResp(data);
    else if (data.error) { appendMsg('system', `⚠ ${data.error}`); toast(data.error); }
    if (S.sid) localStorage.setItem('mc_session', S.sid);
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

// ── MODE SWITCH ───────────────────────────────────────────────
export function setMode(m) {
  S.forceMode = m; if (m) S.mode = m;
  ['1','2','3','4','5','A'].forEach(x => {
    const b = document.getElementById(`msw${x}`); if (!b) return;
    b.className = 'msw-btn'; const n = parseInt(x);
    if (n === m) b.className = `msw-btn a${m}`;
    if (x === 'A' && m === null) b.className = 'msw-btn a1';
  });
  updateUI();
}

// ── CONFIG PANEL ──────────────────────────────────────────────
export function openCfg()  { document.getElementById('cfgPanel').classList.add('open');    document.getElementById('overlay').classList.add('vis'); }
export function closeCfg() { document.getElementById('cfgPanel').classList.remove('open'); document.getElementById('overlay').classList.remove('vis'); }

export function saveCfg() {
  const u = document.getElementById('cfgBackend').value.trim().replace(/\/$/, '');
  const sid = document.getElementById('cfgSession').value.trim();
  if (u)   { S.backend = u; localStorage.setItem('mc_backend', u); }
  if (sid) { S.sid = sid;   localStorage.setItem('mc_session', sid); }
  updateUI(); closeCfg(); toast('Settings saved ✓', 'ok');
}

export function clearSession() {
  if (!confirm('Clear session and start over?')) return;
  S.sid = null; S.mode = 1; S.section = 0; S.service = 0;
  S.locked = false; S.msgs = 0; S.forceMode = null;
  clearImg(); localStorage.removeItem('mc_session');
  document.getElementById('cfgSession').value = '';
  document.getElementById('msgs').innerHTML =
    `<div class="empty" id="emptyState"><div class="empty-lumi">✨</div><div class="empty-divider"></div><div class="empty-tagline">Session cleared. Let's go again.</div></div>`;
  updateUI(); closeCfg();
}

// ── TOAST ─────────────────────────────────────────────────────
export function toast(msg, t = 'err') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${t === 'ok' ? 'ok' : t === 'inf' ? 'inf' : 'err'} vis`;
  setTimeout(() => el.classList.remove('vis'), 3500);
}

// ── WINDOW FACADE (used by HTML inline event handlers) ────────
window._app = {
  send, qs, showWizard, selTile, wNext, wizDone, wizManual, renderWizStep, wizSetCountry,
  setWizUrl, handleFile, clearImg, syncCRMBtn, dlCSV, copyLink,
  openCfg, closeCfg, saveCfg, clearSession, setMode, updateUI, toast, esc,
};

// ESC closes config panel
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCfg(); });
