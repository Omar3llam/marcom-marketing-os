// ============================================================
// MARCOM — Onboarding Wizard logic
// Drives /onboarding.html. Auth-gates with Clerk, walks the user
// through the 3-card form, compiles the locked context snapshot,
// persists to localStorage + backend, then redirects to /app.html.
// ============================================================

// ── State ────────────────────────────────────────────────────
let currentStep = 1;
const TOTAL_STEPS = 3;
const state = {
  companyName:    '',
  industry:       '',
  websiteUrl:     '',
  primaryMarket:  '',
  businessModel:  '',
  targetAudience: '',
  locations:      '',
  competitor:     '',
  brandTone:      '',
  monthlyGoal:    '',
  neverDo:        '',
};

// ── Auth gate + skip-if-onboarded ────────────────────────────
window.addEventListener('load', async () => {
  // Wait for Clerk to load
  if (!window.Clerk) {
    setLoadingText('Auth service unavailable — refresh to retry.');
    return;
  }
  try {
    await window.Clerk.load({
      appearance: {
        variables: {
          colorPrimary: '#FFD300',
          colorBackground: '#181830',
          colorText: '#E8E8F0',
          borderRadius: '16px',
          fontFamily: 'Poppins',
        },
      },
    });
  } catch (err) {
    console.error('[Onboarding] Clerk load failed:', err);
    setLoadingText('Auth service unavailable — refresh to retry.');
    return;
  }

  // Step 1: must be authenticated
  if (!window.Clerk.user) {
    window.location.replace('/');
    return;
  }

  // Step 2: skip the wizard if user already has at least one project
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/projects/list', { headers });
    if (res.ok) {
      const projects = await res.json();
      if (Array.isArray(projects) && projects.length > 0) {
        window.location.replace('/app.html');
        return;
      }
    }
  } catch (err) {
    // Network blip — proceed with wizard so user can onboard
    console.warn('[Onboarding] Projects check failed:', err?.message);
  }

  // Mount Clerk user button (top-right)
  if (window.Clerk.mountUserButton) {
    try {
      window.Clerk.mountUserButton(document.getElementById('user-button'), {
        appearance: {
          elements: {
            userButtonAvatarBox: 'width:32px;height:32px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.18);',
          },
        },
      });
    } catch (err) {
      console.warn('[Onboarding] mountUserButton failed:', err?.message);
    }
  }

  // Reveal the wizard
  document.getElementById('loading-screen').remove();
  document.getElementById('wizard-shell').style.visibility = 'visible';

  initWizard();
});

// ── Auth header helper (mirrors app.js) ──────────────────────
async function getAuthHeaders() {
  const token = await window.Clerk?.session?.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };
}

function setLoadingText(t) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = t;
}

// ── Wizard wiring ────────────────────────────────────────────
function initWizard() {
  // Click delegation on the rail handles every navigation button.
  document.getElementById('card-rail').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'next')   handleNext();
    if (action === 'back')   handleBack();
    if (action === 'finish') handleFinish(btn);
  });

  // Radio card selection (B2B/B2C/Both, brand tones)
  document.querySelectorAll('.radio-card').forEach(card => {
    card.addEventListener('click', () => {
      const group = card.closest('.radio-row');
      group.querySelectorAll('.radio-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const input = card.querySelector('input[type="radio"]');
      if (input) input.checked = true;
      // Persist into state immediately
      const fieldName = card.closest('.field').dataset.name;
      if (fieldName) state[fieldName] = card.dataset.value;
      clearError(card.closest('.field'));
    });
  });

  // Live state binding for text/select/textarea inputs
  bindField('f-company',    'companyName');
  bindField('f-industry',   'industry');
  bindField('f-website',    'websiteUrl');
  bindField('f-market',     'primaryMarket');
  bindField('f-audience',   'targetAudience');
  bindField('f-locations',  'locations');
  bindField('f-competitor', 'competitor');
  bindField('f-goal',       'monthlyGoal');
  bindField('f-never',      'neverDo');

  // Restore any previously-entered values (e.g. user refreshed mid-wizard)
  hydrateFromState();

  updateProgress();
}

function bindField(elId, stateKey) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.addEventListener('input', () => {
    state[stateKey] = el.value;
    clearError(el.closest('.field'));
  });
  el.addEventListener('change', () => {
    state[stateKey] = el.value;
    clearError(el.closest('.field'));
  });
}

function hydrateFromState() {
  // Repaint inputs from `state` so Back navigation never loses values.
  const map = {
    'f-company':    state.companyName,
    'f-industry':   state.industry,
    'f-website':    state.websiteUrl,
    'f-market':     state.primaryMarket,
    'f-audience':   state.targetAudience,
    'f-locations':  state.locations,
    'f-competitor': state.competitor,
    'f-goal':       state.monthlyGoal,
    'f-never':      state.neverDo,
  };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }
  // Radio selections
  if (state.businessModel) selectRadio('businessModel', state.businessModel);
  if (state.brandTone)     selectRadio('brandTone',     state.brandTone);
}

function selectRadio(name, value) {
  const card = document.querySelector(`.radio-card[data-value="${CSS.escape(value)}"] input[name="${name}"]`)?.closest('.radio-card');
  if (!card) return;
  card.closest('.radio-row').querySelectorAll('.radio-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  const input = card.querySelector('input[type="radio"]');
  if (input) input.checked = true;
}

// ── Step navigation ──────────────────────────────────────────
function goToStep(n) {
  currentStep = Math.max(1, Math.min(TOTAL_STEPS, n));
  document.getElementById('card-rail').style.transform =
    `translateX(-${(currentStep - 1) * 33.3333}%)`;
  updateProgress();
  // Move focus to the first input of the new card for keyboard users
  const card = document.querySelector(`.card[data-step="${currentStep}"]`);
  const firstInput = card?.querySelector('input, select, textarea');
  if (firstInput) setTimeout(() => firstInput.focus({ preventScroll: true }), 480);
}

function updateProgress() {
  document.getElementById('progress-fill').style.width = `${(currentStep / TOTAL_STEPS) * 100}%`;
  document.getElementById('progress-label').textContent = `Step ${currentStep} of ${TOTAL_STEPS}`;
}

function handleNext() {
  if (!validateStep(currentStep)) return;
  goToStep(currentStep + 1);
}
function handleBack() {
  goToStep(currentStep - 1);
}

// ── Validation ───────────────────────────────────────────────
const REQUIRED_BY_STEP = {
  1: ['companyName', 'industry', 'primaryMarket'],
  2: ['businessModel', 'targetAudience'],
  3: ['brandTone', 'monthlyGoal'],
};

function validateStep(step) {
  let ok = true;
  const required = REQUIRED_BY_STEP[step] || [];
  for (const name of required) {
    if (!state[name] || !String(state[name]).trim()) {
      showError(name);
      ok = false;
    }
  }
  // URL format check (only when non-empty)
  if (step === 1 && state.websiteUrl && !isLikelyUrl(state.websiteUrl)) {
    showError('websiteUrl');
    ok = false;
  }
  return ok;
}

function showError(name) {
  const field = document.querySelector(`.field[data-name="${name}"]`);
  if (field) field.classList.add('has-error');
}
function clearError(fieldEl) {
  if (fieldEl) fieldEl.classList.remove('has-error');
}
function isLikelyUrl(value) {
  try {
    const u = new URL(value.match(/^https?:\/\//) ? value : `https://${value}`);
    return Boolean(u.hostname && u.hostname.includes('.'));
  } catch { return false; }
}

// ── Compile + Save ───────────────────────────────────────────
function compileContext() {
  const t = (s) => (s && String(s).trim()) ? String(s).trim() : '—';
  return [
    '--- LUMI CONTEXT SNAPSHOT ---',
    `Company: ${t(state.companyName)}`,
    `Industry: ${t(state.industry)}`,
    `Website: ${t(state.websiteUrl)}`,
    `Primary Market: ${t(state.primaryMarket)}`,
    `Business Model: ${t(state.businessModel)}`,
    `Target Audience: ${t(state.targetAudience)}`,
    `Key Locations: ${t(state.locations)}`,
    `Main Competitor: ${t(state.competitor)}`,
    `Brand Tone: ${t(state.brandTone)}`,
    `Monthly Goal: ${t(state.monthlyGoal)}`,
    `Constraints: ${t(state.neverDo)}`,
    `Onboarding Completed: ${new Date().toISOString()}`,
    '-----------------------------',
  ].join('\n');
}

async function handleFinish(btn) {
  if (!validateStep(3)) return;
  // Re-validate earlier steps in case user used dev tools to skip
  if (!validateStep(1)) { goToStep(1); return; }
  if (!validateStep(2)) { goToStep(2); return; }

  const compiled  = compileContext();
  const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const name      = state.companyName || 'My Project';

  // Lock the button to prevent double-submit
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">✨</span> Creating project…';
  }

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/projects/create', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ projectId, name, context: compiled }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    // Mark as active in localStorage so app.html loads straight into it
    localStorage.setItem('lumi:activeProjectId', projectId);

    // Clean up legacy keys (forward-compat)
    localStorage.removeItem('lumi_context');
    localStorage.removeItem('context_locked');

  } catch (err) {
    console.error('[Onboarding] project create failed:', err?.message);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Launch Lumi →';
    }
    // Surface error to user
    const errEl = document.createElement('p');
    errEl.style.cssText = 'color:#e74c3c;font-size:13px;margin-top:8px;text-align:center;';
    errEl.textContent = 'Failed to create project — please try again.';
    btn?.parentElement?.appendChild(errEl);
    return;
  }

  window.location.replace('/app.html');
}
