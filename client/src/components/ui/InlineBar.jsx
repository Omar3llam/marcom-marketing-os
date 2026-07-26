// ============================================================
// MARCOM / Lumi — Inline horizontal bar (no chart library)
// ------------------------------------------------------------
// 1.5px height proportional fill. Color tier picked from value.
//
// The scale is HIGHER = BETTER, always: red below 40%, gold to 70%, green
// above. There is deliberately no `inverted` prop — a metric where higher is
// worse (wasted spend) is the CALLER's problem to state, by passing the value
// it actually wants shown. Business meaning does not belong in a bar.
// ============================================================
import { cn } from '@/lib/utils.js';

export default function InlineBar({ value = 0, max = 100, ariaLabel }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color =
    value < 0.4 * max ? 'bg-signal-kill'
    : value < 0.7 * max ? 'bg-lumi-gold'
    : 'bg-signal-scale';

  return (
    <div
      className="h-1.5 w-full rounded-full bg-lumi-border overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={ariaLabel || `${value} of ${max}`}
    >
      <div className={cn('h-full transition-[width] duration-300', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
