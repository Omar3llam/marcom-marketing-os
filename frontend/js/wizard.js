// ============================================================
// MARCOM — Onboarding Wizard  (frontend/js/wizard.js)
// Uses window._app.send() and window._app.toast() to avoid
// circular imports with app.js.
// ============================================================
import { hideEmpty } from './renderers.js';

let wiz = { industry: '', country: '', url: '' };

const INDUSTRIES = [
  { id: 'Ecommerce',   ico: '🛍️', lbl: 'E-commerce' },
  { id: 'B2B_SaaS',   ico: '💻', lbl: 'B2B & SaaS' },
  { id: 'RealEstate', ico: '🏠', lbl: 'Real Estate' },
  { id: 'Healthcare', ico: '🏥', lbl: 'Healthcare' },
  { id: 'Education',  ico: '🎓', lbl: 'Education' },
  { id: 'Services',   ico: '🤝', lbl: 'Services' },
  { id: 'FnB',        ico: '🍽️', lbl: 'F&B' },
  { id: 'Government', ico: '🏛️', lbl: 'Government' },
  { id: 'Other',      ico: '✨', lbl: 'Other' },
];

const COUNTRIES = [
  'United Arab Emirates','Saudi Arabia','Egypt','United States','United Kingdom',
  'Canada','Germany','France','India','Pakistan','Nigeria','Kenya','South Africa',
  'Singapore','Australia','Brazil','Mexico','Jordan','Kuwait','Qatar','Bahrain',
  'Morocco','Algeria','Turkey','Indonesia','Malaysia','Philippines','Other',
];

export function showWizard() {
  hideEmpty();
  document.getElementById('wizardWrap')?.remove();
  const msgs = document.getElementById('msgs');
  const wrap = document.createElement('div');
  wrap.className = 'wizard-wrap'; wrap.id = 'wizardWrap';
  const card = document.createElement('div');
  card.className = 'wizard-card'; card.id = 'wizardCard';
  wrap.appendChild(card); msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  renderWizStep(1);
}

export function renderWizStep(step) {
  const card = document.getElementById('wizardCard');
  if (!card) return;

  const stepsHTML = `
    <div class="wiz-steps">
      <div class="wstep ${step > 1 ? 'done' : step === 1 ? 'active' : ''}">1</div>
      <div class="wline"></div>
      <div class="wstep ${step > 2 ? 'done' : step === 2 ? 'active' : ''}">2</div>
      <div class="wline"></div>
      <div class="wstep ${step === 3 ? 'active' : ''}">3</div>
    </div>`;

  let inner = '';

  if (step === 1) {
    inner = `${stepsHTML}
      <div class="wiz-title">🏢 What's your industry?</div>
      <div class="wiz-desc">Lumi tailors every strategy to your sector.</div>
      <div class="tile-grid">
        ${INDUSTRIES.map(i => `<div class="tile ${wiz.industry === i.id ? 'sel' : ''}" onclick="window._app.selTile('industry','${i.id}',this)">
          <span class="tile-ico">${i.ico}</span><span class="tile-lbl">${i.lbl}</span></div>`).join('')}
      </div>
      <div class="wiz-actions">
        <button class="wbtn ghost" onclick="document.getElementById('wizardWrap')?.remove()">Cancel</button>
        <button class="wbtn primary" id="wn1" onclick="window._app.wNext(1)" ${!wiz.industry ? 'disabled' : ''}>Next →</button>
      </div>`;
  } else if (step === 2) {
    inner = `${stepsHTML}
      <div class="wiz-title">🌍 Target Country</div>
      <div class="wiz-desc">Lumi uses this for platform strategy and cultural calendar.</div>
      <select class="wiz-select" id="wizCountry" onchange="window._app.wizSetCountry(this.value)">
        <option value="">— Select a country —</option>
        ${COUNTRIES.map(c => `<option value="${c}" ${wiz.country === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <div class="wiz-actions">
        <button class="wbtn ghost" onclick="window._app.renderWizStep(1)">← Back</button>
        <button class="wbtn primary" id="wn2" onclick="window._app.wNext(2)" ${!wiz.country ? 'disabled' : ''}>Next →</button>
      </div>`;
  } else if (step === 3) {
    inner = `${stepsHTML}
      <div class="wiz-title">🌐 Your Website URL</div>
      <div class="wiz-desc">Lumi analyzes your site and builds your full context automatically.</div>
      <input class="wiz-input" id="wizUrl" type="url" placeholder="https://yourcompany.com" value="${wiz.url}"
             oninput="window._app.setWizUrl(this.value)">
      <div class="wiz-actions">
        <button class="wbtn ghost" onclick="window._app.renderWizStep(2)">← Back</button>
        <button class="wbtn primary" onclick="window._app.wizDone()">🚀 Analyze & Lock Context</button>
      </div>
      <div style="text-align:center;margin-top:4px;">
        <span style="font-size:12px;color:var(--ink-3);cursor:pointer;text-decoration:underline;"
              onclick="window._app.wizManual()">Skip — enter details manually</span>
      </div>`;
  }
  card.innerHTML = inner;
  document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight;
}

export function selTile(field, val, el) {
  wiz[field] = val;
  el.closest('.tile-grid').querySelectorAll('.tile').forEach(t => t.classList.remove('sel'));
  el.classList.add('sel');
  const nb = document.getElementById(field === 'industry' ? 'wn1' : 'wn2');
  if (nb) nb.disabled = false;
}

export function wizSetCountry(val) { wiz.country = val; }
export function setWizUrl(val)     { wiz.url = val; }

export function wNext(from) {
  if (from === 1) {
    if (!wiz.industry) { window._app.toast('Select an industry first.'); return; }
    renderWizStep(2);
  } else if (from === 2) {
    const sel = document.getElementById('wizCountry');
    wiz.country = sel?.value || wiz.country;
    if (!wiz.country) { window._app.toast('Select a country first.'); return; }
    renderWizStep(3);
  }
}

export function wizManual() {
  document.getElementById('wizardWrap')?.remove();
  document.getElementById('msgInput').value =
    `I want to enter my company details manually.\nIndustry: ${wiz.industry || 'not specified'}\nCountry: ${wiz.country || 'not specified'}`;
  window._app.send();
}

export async function wizDone() {
  wiz.url = document.getElementById('wizUrl')?.value?.trim() || wiz.url;
  document.getElementById('wizardWrap')?.remove();
  const msg = wiz.url
    ? `Analyze and build my context from this website: ${wiz.url}\nIndustry: ${wiz.industry}\nTarget Country: ${wiz.country}`
    : `Build my marketing context.\nIndustry: ${wiz.industry}\nTarget Country: ${wiz.country}\nPlease ask me the remaining questions.`;
  document.getElementById('msgInput').value = msg;
  await window._app.send();
  wiz = { industry: '', country: '', url: '' };
}
