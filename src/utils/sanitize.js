// ============================================================
// MARCOM — Input Sanitization
// Strips known prompt-injection phrases before text reaches Claude.
// ============================================================

// Phrases that signal prompt-injection attempts
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|context)/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/gi,
  /you\s+are\s+now\s+(?!MARCOM)/gi,
  /forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|training|rules)/gi,
  /act\s+as\s+(?!a\s+marketing)/gi,
  /new\s+persona\s*:/gi,
  /system\s*prompt\s*:/gi,
  /\[SYSTEM\]/gi,
  /\[INST\]/gi,
  /<\|system\|>/gi,
  /<\|user\|>/gi,
  /<\|assistant\|>/gi,
  /jailbreak/gi,
  /DAN\s*mode/gi,
];

const MAX_MESSAGE_LENGTH = 8_000;
const MAX_URL_LENGTH     = 2_048;

/**
 * Sanitize a user chat message before it enters any system prompt.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeMessage(text) {
  if (typeof text !== 'string') return '';

  let clean = text.slice(0, MAX_MESSAGE_LENGTH);

  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, '[removed]');
  }

  return clean.trim();
}

/**
 * Validate and sanitize a URL before scraping.
 * @param {string} url
 * @returns {string}  — the normalised URL
 * @throws  {Error}   — if the URL is invalid or disallowed
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) {
    throw new Error('Invalid URL');
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Malformed URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Disallowed protocol: ${parsed.protocol}`);
  }

  return parsed.href;
}
