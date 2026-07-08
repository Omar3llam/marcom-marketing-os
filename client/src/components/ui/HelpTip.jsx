// ============================================================
// MARCOM / Lumi — HelpTip  (inline term explainer)
// ------------------------------------------------------------
// Self-contained help affordance — NO external dep (the app has no
// shadcn/Radix tooltip or popover; the design system is hand-rolled lumi-*
// tokens, so a dropped-in shadcn component would be unstyled + fail token lint).
//
// Two modes:
//   variant="tooltip" (default) → hover / focus, short one-liner (a string).
//   variant="popover"           → click, { title, description, link? }.
//
// The trigger is a real <button> (keyboard-focusable); the popover closes on
// outside-click or Escape. The floating bubble is a dark, self-consistent
// element so it reads on BOTH the dark app shell and the light Overview surface.
// It never takes layout space (inline, absolutely-positioned bubble) and never
// blocks its neighbour. All copy lives in lib/helpContent.js — never inline.
// ============================================================
import { useState, useRef, useEffect, useId } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils.js';

// Reset the label context these often sit inside (section-label = uppercase +
// tracked + tiny) so the explanation itself reads as normal prose.
const RESET = 'normal-case tracking-normal font-normal';

export function HelpTip({ variant = 'tooltip', content, size = 12, side = 'bottom', className = '', iconClassName, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const tipId = useId();
  const isPopover = variant === 'popover';

  // Popover only: dismiss on outside-click + Escape.
  useEffect(() => {
    if (!isPopover || !open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [isPopover, open]);

  if (content == null) return null;

  const ariaText = label || (isPopover ? content.title : content);
  const pos = side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';

  const handlers = isPopover
    ? { onClick: () => setOpen((o) => !o) }
    : {
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
      };

  return (
    <span ref={ref} className={cn('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={typeof ariaText === 'string' ? `Help: ${ariaText}` : 'Help'}
        aria-expanded={isPopover ? open : undefined}
        aria-describedby={open ? tipId : undefined}
        className={cn('inline-flex transition-colors', iconClassName || 'text-lumi-muted hover:text-lumi-text', isPopover ? 'cursor-pointer' : 'cursor-help')}
        {...handlers}
      >
        <HelpCircle size={size} strokeWidth={2} aria-hidden="true" />
      </button>

      {open && !isPopover && (
        <span
          id={tipId}
          role="tooltip"
          className={cn('absolute z-50 left-1/2 -translate-x-1/2 w-max max-w-[220px] rounded-md border border-lumi-border bg-lumi-elevated px-2.5 py-1.5 shadow-card', pos)}
        >
          <span className={cn('block text-xs leading-snug text-lumi-text', RESET)}>{content}</span>
        </span>
      )}

      {open && isPopover && (
        <span
          id={tipId}
          role="dialog"
          className={cn('absolute z-50 left-1/2 -translate-x-1/2 w-72 rounded-lg border border-lumi-border bg-lumi-surface p-3.5 text-left shadow-card', pos)}
        >
          <span className={cn('mb-1 block text-sm font-semibold text-lumi-text', RESET)}>{content.title}</span>
          <span className={cn('block text-xs leading-relaxed text-lumi-muted', RESET)}>{content.description}</span>
          {content.link && (
            <a href={content.link} className={cn('mt-2 inline-block text-xs text-lumi-gold hover:underline', RESET)}>Learn more →</a>
          )}
        </span>
      )}
    </span>
  );
}

export default HelpTip;
