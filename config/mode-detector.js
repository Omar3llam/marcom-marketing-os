// ============================================================
// MARCOM — Server-Side Mode Detector
// Called from master router; frontend mode suggestion is only
// used after validation here — never trusted directly.
// Mode 1: Context gathering (onboarding)
// Mode 2: Marketing tools & frameworks
// Mode 3: Social media calendar
// Mode 4: Content scoring / interrogation
// Mode 5: Campaign decision engine
// ============================================================

// Keywords that are normal English words but should NEVER force a mode change.
// If a user says "rebuild", "reset", "clear", "restart" in a sentence, it's almost
// certainly directed at their content/strategy — not a system command.
// Mode changes happen via explicit UI actions (New Chat / sidebar tool select) only.
const NEUTRAL_WORDS = ['rebuild', 'reset', 'clear', 'restart', 'start over', 'redo', 'refresh'];

export function detectMode(session, message, forceMode) {
  const fm = forceMode ? parseInt(forceMode, 10) : 0;

  // forceMode 2–5: always honour — these come from explicit UI tool selections.
  if ([2, 3, 4, 5].includes(fm)) return fm;

  // forceMode 1 (or no forceMode): only send to Mode 1 if context is not yet
  // locked. When context IS locked, ignore the force-1 signal entirely so that
  // a history-replayed mode=1 never re-triggers the onboarding flow for a
  // returning user whose project context is already saved.
  if (!session.context_locked) return 1;

  // ── Context is locked — natural keyword detection ──────────
  const msg = message.toLowerCase();

  // Mode 3: Social calendar
  const social = [
    'social media calendar', 'content calendar', 'social strategy',
    '4-week calendar', 'tool 03', 'linkedin calendar', 'instagram calendar',
  ];
  if (social.some(t => msg.includes(t))) return 3;

  // Mode 4: Content interrogation / scoring / evaluation
  // Cast a wide net — "Evaluate this content", "Score this", "Analyze my post",
  // "Interrogate this caption" must all reach Mode 4, not fall through to Mode 2.
  const content = [
    'interrogate', 'interrogation',
    'evaluate content', 'evaluate this', 'evaluate my',
    'check my content', 'check this content',
    'score my content', 'score this', 'score content', 'content score',
    'analyze this content', 'analyze my content', 'analyse this', 'analyse my',
    'content analysis', 'content interrogation',
    'rate this', 'rate my content',
    'tool 09', 'tool09',
  ];
  if (content.some(t => msg.includes(t))) return 4;

  // Mode 5: Campaign decision engine
  const campaign = [
    'campaign metrics', 'campaign results', 'ad performance', 'campaign analysis',
    'meta metrics', 'google ads metrics', 'tool 06', 'roas', 'cac', 'cpm', 'ctr',
    'mer ', 'adset', 'ad set', 'meta ads', 'google ads',
  ];
  if (campaign.some(t => msg.includes(t))) return 5;

  // Default after context lock: Mode 2 (tools & frameworks)
  return 2;
}
