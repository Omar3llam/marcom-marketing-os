// ============================================================
// MARCOM / Lumi — ConfirmationModal
// ------------------------------------------------------------
// "Trust Builder" final-step modal. Shows the AI-recommended
// action, an optional reference visual, and gates execution
// behind an explicit Confirm.
// ============================================================
import { AlertTriangle, Loader2, X, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export default function ConfirmationModal({
  open,
  onClose,
  onConfirm,
  selectedDecision,
  loading,
}) {
  if (!open || !selectedDecision) return null;

  const plan     = selectedDecision.actionPlan ?? {};
  const imageUrl = plan.imageUrl;
  const refPrompt = plan.referencePrompt;

  // Click-outside dismisses (unless mid-execution)
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !loading) onClose?.();
  };

  return (
    <div
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold text-white">Confirm Execution</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── AI Solution Preview ────────────────────────────── */}
        <div className="mt-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            AI recommended action
          </p>
          <p className="mt-2 text-sm font-medium text-white">{plan.action}</p>

          {/* Visual or placeholder */}
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="AI-generated reference"
              className="mt-4 w-full max-h-48 rounded-xl object-cover"
            />
          ) : (
            <div className="mt-4 flex w-full max-h-48 h-40 items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-800/40 text-gray-500">
              <div className="flex flex-col items-center gap-1">
                <ImageIcon className="h-5 w-5" />
                <span className="text-xs">No visual generated</span>
              </div>
            </div>
          )}

          {refPrompt && (
            <p className="mt-2 text-xs italic text-gray-500">{refPrompt}</p>
          )}
        </div>

        {/* ── Warning ───────────────────────────────────────── */}
        <div className="mt-5 flex items-center gap-2 text-sm text-yellow-400">
          <AlertTriangle className="h-4 w-4" />
          <span>This action will be executed immediately. Confirm?</span>
        </div>

        {/* ── Buttons ───────────────────────────────────────── */}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium',
              'text-gray-300 hover:bg-gray-800',
              'disabled:opacity-40',
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold',
              'bg-blue-600 text-white hover:bg-blue-500',
              'disabled:opacity-70 disabled:cursor-not-allowed',
            )}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Executing…' : 'Execute'}
          </button>
        </div>
      </div>
    </div>
  );
}
