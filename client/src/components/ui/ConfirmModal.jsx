// ============================================================
// MARCOM / Lumi — ConfirmModal
// ------------------------------------------------------------
// A blocking confirmation for a consequential, hard-to-undo action. Replaces
// window.confirm, which cannot state consequences in the product's own voice
// and is unstyleable and untestable.
//
// Deliberately dumb: no portal, no focus trap library, no animation. It renders
// nothing when closed, so mounting it costs nothing.
// ============================================================
import { useEffect, useRef } from 'react';

const VARIANTS = {
  warning: { title: 'text-lumi-gold',   confirm: 'bg-lumi-gold text-dark-base hover:bg-lumi-deep' },
  danger:  { title: 'text-signal-kill', confirm: 'bg-signal-kill text-lumi-surface hover:opacity-90' },
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  variant = 'warning',
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  // Escape cancels, and focus lands on the dialog rather than staying behind it.
  // Both effects are unconditional (hooks can't be conditional) and no-op closed.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const c = VARIANTS[variant] ?? VARIANTS.warning;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark-base/60 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        // Stop the backdrop's dismiss handler from firing on clicks inside.
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-lumi-border bg-lumi-surface p-6 shadow-card"
      >
        <h2 className={`font-display text-base font-semibold mb-2 ${c.title}`}>{title}</h2>
        <p className="text-sm text-lumi-muted mb-6 leading-relaxed">{description}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-lumi-border px-4 py-2 text-sm text-lumi-muted hover:bg-lumi-elevated transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${c.confirm}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
