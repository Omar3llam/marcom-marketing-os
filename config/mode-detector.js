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
  // Validate any frontend-supplied mode — must be integer 1–5
  if (forceMode && [1, 2, 3, 4, 5].includes(parseInt(forceMode, 10))) {
    return parseInt(forceMode, 10);
  }

  // Context must be locked before leaving Mode 1 — UNLESS the message is
  // clearly a tool/content request that already has conversation context to
  // work from. This prevents normal words like "rebuild" or "rewrite" from
  // being misread as system resets.
  if (!session.context_locked) {
    const msg = message.toLowerCase();
    // If the message is only a neutral word on its own (< 4 words, matches a
    // neutral keyword) AND there's no prior conversation, treat it as mode 1.
    // In all other cases, still route to mode 1 until context is locked — but
    // mode 1 itself is now smart enough to handle mid-conversation messages.
    return 1;
  }

  const msg = message.toLowerCase();

  // Mode 3: Social calendar
  const social = [
    'social media calendar', 'content calendar', 'social strategy',
    '4-week calendar', 'tool 03', 'linkedin calendar', 'instagram calendar',
  ];
  if (social.some(t => msg.includes(t))) return 3;

  // Mode 4: Content interrogation
  const content = [
    'interrogate', 'evaluate content', 'check my content', 'score my content',
    'content interrogation', 'tool 09', 'rate this', 'caption',
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
