// ============================================================
// MARCOM / Lumi — Radar Strip
// ------------------------------------------------------------
// Live countdown + alert pulse indicator
// Displayed at bottom of sidebar navigation (above footer)
// ============================================================
import { Radar } from 'lucide-react';

export default function RadarStrip({ countdown, hasHighAlerts }) {
  // Format countdown (seconds to M:SS)
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const countdownStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="px-3 py-2 border-t border-lumi-border/50">
      <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-lumi-elevated/60 border border-lumi-border/70">
        <div className="flex items-center gap-2">
          <Radar className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
          <span className="font-mono text-[10px] text-lumi-muted">
            Next sweep
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasHighAlerts && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-signal-kill"
              style={{
                boxShadow: '0 0 6px var(--c-kill)',
                animation: 'pulse 1.6s ease-in-out infinite',
              }}
            />
          )}
          <span className="font-mono text-[11px] font-semibold text-lumi-text tabular-nums">
            {countdownStr}
          </span>
        </div>
      </div>
    </div>
  );
}
