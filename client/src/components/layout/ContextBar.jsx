// ============================================================
// MARCOM / Lumi — ContextBar  (44px fixed bottom strip)
// ------------------------------------------------------------
// Three-up: context lock pill (left), AI status (center),
// session id (right). Always visible across the /app/* shell.
// ============================================================
import { Circle, Zap } from 'lucide-react';
import { useUser } from '@clerk/clerk-react';

export default function ContextBar() {
  const { user } = useUser();
  // Truncated Clerk session/user id is fine as a pseudo-session marker
  // until we wire the real ChatSession id from the backend.
  const sid = (user?.id || '').replace(/^user_/, '').slice(0, 6).toUpperCase() || 'NSD87T';

  return (
    <div className="flex items-center justify-between h-11 px-4 border-t border-lumi-border bg-lumi-surface/80 backdrop-blur-sm flex-shrink-0">
      {/* Left: context lock */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-signal-scale/10 border border-signal-scale/25">
          <Circle className="w-2 h-2 fill-signal-scale text-signal-scale" strokeWidth={0} />
          <span className="text-xs font-display font-semibold text-signal-scale tracking-wide">
            Context: Locked
          </span>
        </div>
      </div>

      {/* Center: AI ready */}
      <div className="flex items-center gap-1.5 text-lumi-subtle">
        <Zap className="w-3 h-3" strokeWidth={1.5} />
        <span className="text-xs font-body">Dual-Agent Ready</span>
      </div>

      {/* Right: session id */}
      <div className="text-xs font-mono text-lumi-subtle">
        SID <span className="text-lumi-muted">_{sid}</span>
      </div>
    </div>
  );
}
