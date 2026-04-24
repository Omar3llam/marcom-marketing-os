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

export function detectMode(session, message, forceMode) {
  // Validate any frontend-supplied mode — must be integer 1–5
  if (forceMode && [1, 2, 3, 4, 5].includes(parseInt(forceMode, 10))) {
    return parseInt(forceMode, 10);
  }

  // Context must be locked before leaving Mode 1
  if (!session.context_locked) return 1;

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
