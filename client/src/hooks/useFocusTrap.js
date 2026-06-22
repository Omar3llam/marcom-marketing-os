// ============================================================
// MARCOM / Lumi — useFocusTrap
// ------------------------------------------------------------
// Accessibility hook for MODAL dialogs (role="dialog" aria-modal).
// Handles focus management only — no visual, copy, or logic change:
//
//   1. Moves focus to the first focusable element inside the modal
//      when it opens (unless focus is already inside, e.g. an input
//      that auto-focused itself).
//   2. Traps Tab / Shift+Tab within the modal while it is open.
//   3. Returns focus to the element that opened the modal on close.
//   4. (Optional) calls `onEscape` when Escape is pressed inside the
//      modal — pass this only for modals that don't already handle
//      Escape themselves, to avoid double-close.
//
// NOTE: This is for modal dialogs, NOT popovers/menus. A non-modal
// popover (e.g. NotificationPopover) must NOT trap focus per ARIA APG.
//
// Usage:
//   const trapRef = useFocusTrap(open);
//   return open ? <div ref={trapRef} role="dialog" aria-modal="true">…</div> : null;
// ============================================================
import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * @param {boolean} active - whether the modal is currently open
 * @param {() => void} [onEscape] - optional Escape handler (only for modals
 *   that don't already implement their own Escape-to-close)
 * @returns {import('react').RefObject<HTMLElement>} ref for the modal container
 */
export function useFocusTrap(active, onEscape) {
  const containerRef = useRef(null);
  // Keep the latest onEscape without re-running the effect on every render.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    // Remember what had focus so we can restore it when the modal closes.
    const previouslyFocused = document.activeElement;

    const getFocusable = () =>
      Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));

    // Move focus inside, unless the modal already owns it (e.g. a search
    // input that focused itself on open).
    if (!container.contains(document.activeElement)) {
      const focusable = getFocusable();
      (focusable[0] || container).focus();
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && onEscapeRef.current) {
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing to focus but the container — keep focus from leaving.
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);

    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // Restore focus to the trigger if it is still in the document.
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === 'function' &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return containerRef;
}
