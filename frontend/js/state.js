// ============================================================
// MARCOM — Application State  (frontend/js/state.js)
// ============================================================

export const S = {
  sid: null, mode: 1, section: 0, service: 0,
  locked: false, msgs: 0, loading: false, forceMode: null,
  backend: localStorage.getItem('mc_backend') || '',
  img: null,  // { base64, mediaType, name }
  // In-memory canonical conversation for the active session.
  // Single source of truth that the save endpoint reads from.
  history: [],
  // Per-tool isolated chat histories (hub-and-spoke pattern)
  toolChats: {},  // { toolId: [{role, content, meta}, ...], ... }
  // ── Hub-and-Spoke routing ─────────────────────────────────
  // 'hub'         — Tools Hub landing screen (default after boot)
  // 'tool-active' — Dedicated chat workspace for a chosen tool
  // 'workspace'   — Project profile / context review screen
  currentView: 'hub',
  activeTool:  null,  // 'tools' | 'score' | 'analysis' | 'calendar' | 'brief' | 'chat'
};

export function updateUI() {
  // The mode chip and hint bar were retired alongside chat-based
  // onboarding — they sit guarded so the function tolerates either
  // markup variant during deploy rollovers.
  // SID display was removed from the UI (technical detail — not user-facing).
  // S.sid is still maintained in state for all API calls.

  // Progress bar (Mode 1 onboarding indicator) is retired.
  const pbar = document.getElementById('pbar');
  if (pbar) pbar.classList.remove('visible');

  // ── Interrogation Mode indicator ───────────────────────────
  // Show a subtle badge in the chat header when the user is in
  // Mode 4 (content scoring/analysis) with context locked.
  // Hides automatically when the mode changes.
  const badge = document.getElementById('interrogation-badge');
  if (badge) {
    badge.style.display = (S.mode === 4 && S.locked) ? 'inline-flex' : 'none';
  }
}
