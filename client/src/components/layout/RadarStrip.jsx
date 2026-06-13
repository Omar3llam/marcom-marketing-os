// ============================================================
// MARCOM / Lumi — Radar Strip
// ------------------------------------------------------------
// Honest monitoring status + alert pulse indicator.
// Displayed at bottom of sidebar navigation (above footer).
// NOTE: previously rendered a fabricated "Next sweep" countdown
// (a hardcoded 47s UI timer with no real schedule behind it).
// Removed — we don't have a real next-sweep timestamp wired, so
// we show an honest status instead of a fake ticking clock.
// ============================================================
import { Radar } from 'lucide-react';

export default function RadarStrip({ hasHighAlerts }) {
  return (
    <div className="px-3 py-2 border-t border-lumi-border/50">
      <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-lumi-elevated/60 border border-lumi-border/70">
        <div className="flex items-center gap-2">
          <Radar className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
          <span className="font-mono text-[10px] text-lumi-muted">
            Radar
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
          <span className="font-mono text-[11px] font-semibold text-lumi-text">
            {hasHighAlerts ? 'Alerts active' : 'Monitoring'}
          </span>
        </div>
      </div>
    </div>
  );
}
