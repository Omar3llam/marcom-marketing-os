// ============================================================
// MARCOM / Lumi — clipboard
// ------------------------------------------------------------
// One copy path for the whole app. The async Clipboard API is unavailable in an
// insecure context (plain-http staging, some embedded webviews) and can be
// permission-denied even in a secure one, so the legacy execCommand path is kept
// as a fallback.
//
// ALWAYS resolves — never throws and never silently swallows. The caller gets
// { ok: false } and is expected to SAY the copy failed: a button that reports
// "Copied" when nothing reached the clipboard is the worst outcome here.
// ============================================================

/**
 * Write `text` to the clipboard.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
    // Fallback: a hidden textarea + execCommand. Deprecated, but it is the only
    // path available without a secure context.
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const success = document.execCommand?.('copy') ?? false;
    document.body.removeChild(el);
    return success ? { ok: true } : { ok: false, error: 'execCommand failed' };
  } catch (err) {
    return { ok: false, error: err?.message ?? 'Clipboard unavailable' };
  }
}
