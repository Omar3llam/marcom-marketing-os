// ============================================================
// MARCOM — Application State  (frontend/js/state.js)
// ============================================================

export const S = {
  sid: null, mode: 1, section: 0, service: 0,
  locked: false, msgs: 0, loading: false, forceMode: null,
  backend: localStorage.getItem('mc_backend') || '',
  img: null,  // { base64, mediaType, name }
};

export function updateUI() {
  const mn = { 1:'Mode 1 — Context', 2:'Mode 2 — Tools', 3:'Mode 3 — Social', 4:'Mode 4 — Content', 5:'Mode 5 — Campaign' };
  const mc = { 1:'m1', 2:'m2', 3:'m3', 4:'m4', 5:'m5' };
  const chip = document.getElementById('modeChip');
  chip.className = `mode-chip ${mc[S.mode] || 'm1'}`;
  document.getElementById('modeLbl').textContent = mn[S.mode] || `Mode ${S.mode}`;
  document.getElementById('sidTag').textContent = S.sid ? `SID …${S.sid.slice(-6)}` : '';
  const ctx = document.getElementById('ctxPill');
  if (S.locked) { ctx.className = 'ctx-pill locked';    ctx.innerHTML = '<span>🔒</span><span>Context Locked</span>'; }
  else           { ctx.className = 'ctx-pill gathering'; ctx.innerHTML = '<span>⏳</span><span>Gathering Context…</span>'; }
  if (S.mode === 1) {
    document.getElementById('pbar').classList.add('visible');
    document.getElementById('pbarFill').style.width = `${Math.min(100, (S.section / 9) * 100)}%`;
  } else { document.getElementById('pbar').classList.remove('visible'); }
  document.getElementById('stBackend').textContent = S.backend ? '✓ Set' : 'Using origin';
  document.getElementById('stBackend').className   = S.backend ? 's-ok' : 's-warn';
  document.getElementById('stCtx').textContent     = S.locked ? '🔒 Locked' : '⏳ Incomplete';
  document.getElementById('stCtx').className       = S.locked ? 's-ok' : 's-warn';
  document.getElementById('stMsgs').textContent    = S.msgs;
  _updateHints();
}

function _updateHints() {
  const hs = {
    1: [{ lbl:'🚀 Onboarding', fn:'window._app.showWizard()' }, { lbl:'⚡ Drop URL', msg:'https://yourcompany.com' }],
    2: [{ lbl:'All Tools', msg:'Show me all available tools.' }, { lbl:'Lead Gen', msg:'10' }, { lbl:'Brand', msg:'13' }, { lbl:'GTM', msg:'18' }],
    3: [{ lbl:'4-Week Calendar', msg:'social media calendar' }, { lbl:'LinkedIn Only', msg:'social media calendar for LinkedIn only' }],
    4: [{ lbl:'Submit Content', msg:'Here is the content I want evaluated:' }, { lbl:'LinkedIn Post', msg:'Platform: LinkedIn. Funnel: MOFU. Format: Static. Audience: B2B CFOs. Content:' }],
    5: [{ lbl:'Meta Metrics', msg:'Here are my Meta campaign metrics:' }, { lbl:'Google Ads', msg:'Here are my Google Ads metrics:' }],
  };
  const set = hs[S.mode] || hs[1];
  document.getElementById('hints').innerHTML = set.map(h => h.fn
    ? `<span class="hint" onclick="${h.fn}">${h.lbl}</span>`
    : `<span class="hint" onclick="window._app.qs('${h.msg.replace(/'/g, "\\'")}')"> ${h.lbl}</span>`
  ).join('');
}
