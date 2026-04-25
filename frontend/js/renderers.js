// ============================================================
// MARCOM — Response Renderers  (frontend/js/renderers.js)
// All AI response data must pass through esc() before DOM insertion.
// ============================================================

export function esc(t = '') {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function fmtTxt(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{2,3} (.+)$/gm, '<div class="shdr">$1</div>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/((<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>')
    .split('\n\n').map(p => p.trim() ? (p.startsWith('<') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`) : '').filter(Boolean).join('');
}

export function tryJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }
  return null;
}

export function hideEmpty() {
  const e = document.getElementById('emptyState');
  if (e) e.style.display = 'none';
}

export function appendMsg(role, content, meta = {}, imgB64 = null) {
  const msgs = document.getElementById('msgs');
  const wrap = document.createElement('div');
  wrap.className = `msg ${role === 'user' ? 'user' : 'system'}`;
  const avHtml = role === 'user' ? '<div class="user-av">YOU</div>' : '<div class="lumi-av">✨</div>';
  const fmt = fmtTxt(content);
  let mt = '';
  if (role === 'system' && meta.mode) {
    const mn = { 1:'Context', 2:'Tools', 3:'Social', 4:'Content', 5:'Campaign' };
    mt = `Mode ${meta.mode} — ${mn[meta.mode] || ''}`;
    if (meta.service && meta.service > 0) mt += ` — Tool ${String(meta.service).padStart(2, '0')}`;
  }
  const imgHtml = (role === 'user' && imgB64)
    ? `<img src="data:image/jpeg;base64,${imgB64}" style="max-width:120px;border-radius:10px;margin-top:8px;display:block;border:2px solid var(--border);">`
    : '';
  wrap.innerHTML = `${avHtml}<div><div class="bubble">${fmt}${imgHtml}</div>${mt ? `<div class="bubble-meta">${esc(mt)} · ${new Date().toLocaleTimeString()}</div>` : ''}</div>`;
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── RESPONSE ROUTING ──────────────────────────────────────────
export function renderResp(data) {
  const json = tryJSON(data.message);
  if (data.current_mode === 5 && json?.campaigns) { renderCampaign(json); return; }
  if (data.current_mode === 4 && json?.scorecard)  { renderScorecard(json); return; }
  if (data.current_mode === 3 && json?.calendar)   { renderCalendar(json); return; }
  if (data.current_mode === 2 && (data.message?.length || 0) > 200) { renderInsightText(data); }
  else appendMsg('system', data.message, { mode: data.current_mode, service: data.current_service });
}

function mkBridge(type, payload) {
  const d = document.createElement('div');
  d.className = 'action-bridge'; d._t = type; d._p = payload;
  d.innerHTML = `
    <button class="abtn crm"  onclick="window._app.syncCRMBtn(this)">🚀 Send to CRM!</button>
    <button class="abtn csv"  onclick="window._app.dlCSV(this)">⬇ CSV</button>
    <button class="abtn link" onclick="window._app.copyLink()">🔗 Client Link</button>`;
  return d;
}

export function renderCampaign(payload) {
  const msgs = document.getElementById('msgs');
  const wrap = document.createElement('div');
  wrap.className = 'msg system'; wrap.style.animation = 'msgIn 0.3s ease';
  const dmap = { SCALE:'db-scale', HOLD:'db-hold', OPTIMIZE:'db-optimize', PAUSE:'db-pause', KILL:'db-kill' };
  const campaigns = [...(payload.campaigns || [])].sort((a, b) => (b.impact_score || 0) - (a.impact_score || 0));
  const rows = campaigns.map(c => {
    const imp = Math.max(1, Math.min(10, parseInt(c.impact_score) || 5));
    const lvl = imp >= 8 ? 'imp-h' : imp >= 5 ? 'imp-m' : 'imp-l';
    const dc = dmap[(c.decision || '').toUpperCase()] || 'db-hold';
    return `<tr>
      <td style="font-weight:700;">${esc(c.campaign_name || 'Unnamed')}</td>
      <td><span class="dbadge ${dc}">${esc(c.decision || '—')}</span></td>
      <td><div class="imp-wrap"><div class="imp-track"><div class="imp-fill ${lvl}" style="width:${imp * 10}%"></div></div><span class="imp-num">${imp}</span></div></td>
      <td style="font-size:12px;color:var(--ink-3);">${esc(c.reasoning || '')}</td>
      <td class="scale-cell">${esc(c.horizontal_scaling_advice || '—')}</td>
    </tr>`;
  }).join('');
  const ascF = (payload.asc_grace_period_flags || []).map(f => `<span class="fbadge fbadge-asc">⏸ ${esc(f)}</span>`).join('');
  const cacF = (payload.mer_cac_flags || []).map(f => `<span class="fbadge fbadge-cac">⚠ ${esc(f)}</span>`).join('');
  const flagHtml = (ascF || cacF) ? `<div class="flag-row">${ascF}${cacF}</div>` : '';
  const container = document.createElement('div'); container.style.maxWidth = '100%';
  container.innerHTML = `
    <div style="font-size:14px;font-weight:800;color:var(--ink);margin-bottom:12px;display:flex;align-items:center;gap:8px;">
      <span>📊</span> Campaign Decision Engine
      <span style="font-size:11px;font-weight:500;color:var(--ink-3);">Sorted by Impact ↓</span>
    </div>
    ${flagHtml}
    <div class="ctable-wrap" style="${flagHtml ? 'margin-top:10px;' : ''}">
      <table class="ctable">
        <thead><tr><th>Campaign</th><th>Decision</th><th>Impact (1–10)</th><th>Reasoning</th><th>Horizontal Scaling</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${payload.summary ? `<div class="tbl-summary">${fmtTxt(payload.summary)}</div>` : ''}`;
  container.appendChild(mkBridge('campaign', payload));
  wrap.appendChild(container); msgs.appendChild(wrap); msgs.scrollTop = msgs.scrollHeight;
}

function buildAudienceTabs(sims) {
  if (!Array.isArray(sims) || !sims.length) return '';
  const tabs = sims.map((p, i) =>
    `<button class="aud-tab${i === 0 ? ' active' : ''}" onclick="
      this.closest('.aud-wrap').querySelectorAll('.aud-tab').forEach(b=>b.classList.remove('active'));
      this.closest('.aud-wrap').querySelectorAll('.aud-panel').forEach(p=>p.classList.remove('active'));
      this.classList.add('active');
      this.closest('.aud-wrap').querySelector('.aud-panel[data-idx=\\'${i}\\']').classList.add('active');
    ">${esc(p.persona_name || `Persona ${i + 1}`)}</button>`
  ).join('');
  const panels = sims.map((p, i) => `
    <div class="aud-panel${i === 0 ? ' active' : ''}" data-idx="${i}">
      <div class="aud-row"><span class="aud-lbl">💬 Reaction</span><span class="aud-val">${fmtTxt(p.reaction || '')}</span></div>
      <div class="aud-row"><span class="aud-lbl">⚠ Credibility Gap</span><span class="aud-val aud-gap">${fmtTxt(p.credibility_gap || '')}</span></div>
    </div>`).join('');
  return `<div class="aud-wrap"><div class="aud-hdr"><span class="aud-title">👥 Audience Simulation</span><div class="aud-tabs">${tabs}</div></div>${panels}</div>`;
}

export function renderScorecard(payload) {
  const msgs = document.getElementById('msgs');
  const wrap = document.createElement('div');
  wrap.className = 'msg system'; wrap.style.animation = 'msgIn 0.3s ease';
  const sc = payload.scorecard || {};
  const rwLvl = (payload.rewrite_required || 'none').toLowerCase();
  const rwMap = { none:'rw-none', minor:'rw-minor', moderate:'rw-moderate', major:'rw-major' };
  const metrics = [
    { k:'ai_probability',    lbl:'AI Probability',       gate:'≤30%', inv:true, pct:v=>100-v },
    { k:'hook_score',        lbl:'Hook Score',            gate:'≥7',   pct:v=>v/10*100 },
    { k:'audience_conviction',lbl:'Audience Conviction',  gate:'≥7',   pct:v=>v/10*100 },
    { k:'authority_signal',  lbl:'Authority Signal',      gate:'≥7',   pct:v=>v/10*100 },
    { k:'differentiation',   lbl:'Differentiation',       gate:'≥6',   pct:v=>v/10*100 },
    { k:'cultural_resonance',lbl:'Cultural Resonance',    gate:'≥7',   pct:v=>v/10*100 },
    { k:'closing_line',      lbl:'Closing Line',          gate:'≥7',   pct:v=>v/10*100 },
    { k:'commercial_impact', lbl:'Commercial Impact',     gate:'≥Mod', isTxt:true, pct:v=>v==='High'?100:v==='Moderate'?60:20 },
    { k:'visual_impact_score',lbl:'Visual Impact',        gate:'≥7',   pct:v=>v/10*100, opt:true },
    { k:'text_design_harmony',lbl:'Text/Design Harmony',  gate:'≥7',   pct:v=>v/10*100, opt:true },
  ];
  function mst(m, v) {
    if (m.isTxt) return v === 'High' ? 'p' : v === 'Moderate' ? 'w' : 'f';
    const n = parseFloat(v); if (isNaN(n)) return 'w';
    if (m.inv) return n <= 30 ? 'p' : n <= 45 ? 'w' : 'f';
    const thr = parseFloat(m.gate.replace(/[≥<]/g, ''));
    return n >= thr ? 'p' : n >= thr - 1.5 ? 'w' : 'f';
  }
  const rows = metrics.map(m => {
    const v = sc[m.k]; if (v == null) return '';
    const disp = m.isTxt ? esc(v) : (m.gate.startsWith('≤') ? `${esc(String(v))}%` : `${esc(String(v))}/10`);
    const st = mst(m, v);
    const pct = Math.min(100, Math.max(0, m.pct(parseFloat(v) || 0)));
    const sm = { p:{score:'ms-p',fill:'mf-p',verd:'mv-p',txt:'✓'}, w:{score:'ms-w',fill:'mf-w',verd:'mv-w',txt:'~'}, f:{score:'ms-f',fill:'mf-f',verd:'mv-f',txt:'✗'} }[st];
    return `<div class="mrow"><span class="mlbl">${esc(m.lbl)}</span>
      <div class="mbar-g"><div class="mtrack"><div class="mfill ${sm.fill}" style="width:${pct}%"></div></div>
      <span class="mscore ${sm.score}">${disp}</span><span class="mgate">${esc(m.gate)}</span></div>
      <span class="mverd ${sm.verd}">${sm.txt}</span></div>`;
  }).join('');
  const ov = sc['overall'];
  const ovSt = ov ? mst({ pct:v=>v/10*100 }, ov) : 'w';
  const container = document.createElement('div'); container.style.maxWidth = '100%';
  container.innerHTML = `
    <div class="sc-hdr"><span class="sc-title">🔍 Content Interrogation Engine</span>
      <span class="rw-pill ${rwMap[rwLvl] || 'rw-minor'}">Rewrite: ${esc(rwLvl)}</span></div>
    ${rows}
    ${ov != null ? `<div class="ov-row"><span class="ov-lbl">Overall Score</span><span class="ov-num ${{ p:'ms-p', w:'ms-w', f:'ms-f' }[ovSt]}">${esc(String(ov))}/10</span></div>` : ''}
    ${buildAudienceTabs(payload.audience_simulation)}
    ${payload.brutal_insight    ? `<div class="brutal-box"><div class="bi-lbl">⚡ Brutal Insight</div><div class="bi-txt">${fmtTxt(payload.brutal_insight)}</div></div>` : ''}
    ${payload.rewritten_content ? `<div class="rw-box"><div class="rw-top"><span class="rw-top-lbl">✦ Rewritten Version</span></div><div class="rw-body">${fmtTxt(payload.rewritten_content)}</div></div>` : ''}
    ${payload.verdict           ? `<div class="verdict-txt">${fmtTxt(payload.verdict)}</div>` : ''}`;
  container.appendChild(mkBridge('content', payload));
  wrap.appendChild(container); msgs.appendChild(wrap); msgs.scrollTop = msgs.scrollHeight;
}

export function renderCalendar(payload) {
  const msgs = document.getElementById('msgs');
  const wrap = document.createElement('div');
  wrap.className = 'msg system'; wrap.style.animation = 'msgIn 0.3s ease';
  const pillars = (payload.pillars || []).map(p => `<span class="pillar-chip">${esc(p.name)}</span>`).join('');
  const stCls = s => { const m = (s || '').toLowerCase(); return m==='tofu'?'st-tofu':m==='mofu'?'st-mofu':m==='bofu'?'st-bofu':'st-ret'; };
  const cal = payload.calendar || [];
  const weekBlocks = [1,2,3,4].map(w => {
    const posts = cal.filter(p => parseInt(p.week) === w);
    if (!posts.length) return '';
    return `<div class="wk-lbl">Week ${w}</div><div class="cal-grid">${posts.map(p => `
      <div class="cal-card ${p.repurpose ? 'rp' : ''}">
        <div style="display:flex;justify-content:space-between;"><span class="cal-day">${esc(p.day || '')}</span>${p.repurpose ? '<span class="rp-tag">↗</span>' : ''}</div>
        <span class="cal-plat">${esc(p.platform || '')}</span>
        <span class="cal-fmt">${esc(p.format || '')}</span>
        <div class="cal-hook">${esc(p.hook || '')}</div>
        <span class="cal-stage ${stCls(p.funnel_stage)}">${esc(p.funnel_stage || '')}</span>
        <span class="cal-cta">${esc(p.cta || '')}</span>
      </div>`).join('')}</div>`;
  }).join('');
  const moments = (payload.cultural_moments || []).filter(Boolean);
  const container = document.createElement('div'); container.style.maxWidth = '100%';
  container.innerHTML = `
    <div style="font-size:14px;font-weight:800;color:var(--ink);margin-bottom:12px;display:flex;align-items:center;gap:8px;">
      <span>📅</span> 4-Week Social Calendar <span style="font-size:11px;font-weight:500;color:var(--ink-3);">${cal.length} posts</span>
    </div>
    <div class="pillars-row">${pillars}</div>
    ${weekBlocks}
    ${payload.summary ? `<div class="cal-summary">${fmtTxt(payload.summary)}</div>` : ''}
    ${moments.length ? `<div style="font-size:12px;font-weight:600;color:var(--yellow-dk);margin-top:10px;">📅 ${moments.map(esc).join(' · ')}</div>` : ''}`;
  container.appendChild(mkBridge('social', payload));
  wrap.appendChild(container); msgs.appendChild(wrap); msgs.scrollTop = msgs.scrollHeight;
}

export function renderInsightText(data) {
  const msgs = document.getElementById('msgs');
  const wrap = document.createElement('div');
  wrap.className = 'msg system'; wrap.style.animation = 'msgIn 0.3s ease';
  const lines = data.message.split('\n').filter(l => l.trim());
  const cards = []; let cur = null;
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) { if (cur) cards.push(cur); cur = { label: line.replace(/^#+\s/, ''), value: '', mood: pickMood(line) }; }
    else if (/^[•\-\*]\s/.test(line) || /^\d+\.\s/.test(line)) { if (cur) cur.value += (cur.value ? '\n' : '') + line.replace(/^[•\-\*\d\.]+\s*/, ''); else cur = { label: '', value: line.replace(/^[•\-\*\d\.]+\s*/, ''), mood: '😎' }; }
    else if (cur) { cur.value += (cur.value ? ' ' : '') + line; }
    else { cur = { label: '', value: line, mood: '😎' }; }
  }
  if (cur) cards.push(cur);
  if (cards.length > 1) {
    const section = document.createElement('div'); section.className = 'insight-section'; section.style.maxWidth = '100%';
    const hdr = document.createElement('div'); hdr.className = 'insight-hdr'; hdr.innerHTML = '<span>✨</span><span>Lumi\'s Top Insights</span>';
    section.appendChild(hdr);
    const grid = document.createElement('div'); grid.className = 'insight-grid';
    cards.slice(0, 8).forEach(c => {
      const cls = c.mood === '🛑' ? 'warn' : c.mood === '😉' ? 'good' : 'opp';
      const card = document.createElement('div'); card.className = `insight-card ${cls}`;
      card.innerHTML = `<div class="ic-mood">${c.mood}</div>${c.label ? `<div class="ic-label">${fmtTxt(c.label)}</div>` : ''}<div class="ic-value">${fmtTxt(c.value)}</div>`;
      grid.appendChild(card);
    });
    section.appendChild(grid); wrap.appendChild(section);
  } else {
    appendMsg('system', data.message, { mode: data.current_mode }); return;
  }
  msgs.appendChild(wrap); msgs.scrollTop = msgs.scrollHeight;
}

function pickMood(t) {
  const l = t.toLowerCase();
  if (/warn|caution|stop|risk|danger|fail|error|issue/.test(l)) return '🛑';
  if (/great|excellent|success|win|best|top|strong/.test(l)) return '😉';
  return '😎';
}
