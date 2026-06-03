// ============================================================
// MARCOM / Lumi — Health Bar
// ============================================================
// Mini progress bar with percentage (0-100)
// ============================================================

export default function HealthBar({ health }) {
  const color = health < 40 ? 'var(--c-kill)' : health < 70 ? 'var(--c-hold)' : 'var(--c-scale)';

  return (
    <div className="flex items-center gap-2">
      <div className="w-[60px] h-1 rounded-sm bg-surface-border overflow-hidden">
        <div
          className="h-full rounded-sm"
          style={{ width: `${health}%`, background: color }}
        />
      </div>
      <span className="font-mono tabular-nums text-[11px] font-semibold text-dark-base">
        {health}
      </span>
    </div>
  );
}
