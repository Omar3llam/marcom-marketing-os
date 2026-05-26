// ============================================================
// MARCOM UI Primitive — StatCard
// ============================================================
// Displays a single metric with icon, label, value, and optional gauge.
// Used in Home page for account pulse stats.
//
// Props:
//   label: string (e.g., "Total spend")
//   value: string (e.g., "$12,500" or "72/100")
//   sub: string (secondary text, e.g., "last 30 days")
//   Icon: Lucide icon component
//   tone: 'positive' | 'danger' | 'warn' | 'neutral' (optional)
//   gauge: number 0-100 (optional, renders progress bar)
// ============================================================

export default function StatCard({ label, value, sub, Icon, tone, gauge }) {
  const toneCfg = {
    positive: { color: 'var(--c-scale-text)', bg: 'var(--c-scale-bg)' },
    danger:   { color: 'var(--c-kill-text)',  bg: 'var(--c-kill-bg)' },
    warn:     { color: 'var(--c-hold-text)',  bg: 'var(--c-hold-bg)' },
    neutral:  { color: 'var(--c-text-base)',  bg: 'rgba(246,201,69,0.10)' },
  }[tone] || { color: 'var(--c-text-base)', bg: 'rgba(246,201,69,0.10)' };

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-4 shadow-card relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-dark-muted">
          {label}
        </span>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: toneCfg.bg, color: toneCfg.color }}
        >
          <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
        </div>
      </div>

      {/* Value */}
      <div
        className="font-display font-bold text-[26px] leading-none tracking-tight tabular-nums text-dark-base"
        style={{ letterSpacing: '-0.02em' }}
      >
        {value}
      </div>

      {/* Sub text */}
      <div
        className="font-mono text-[11px] mt-1.5"
        style={{ color: toneCfg.color }}
      >
        {sub}
      </div>

      {/* Optional gauge */}
      {gauge != null && (
        <div className="mt-2.5 h-[3px] rounded-sm bg-surface-elevated overflow-hidden">
          <div
            className="h-full rounded-sm"
            style={{
              width: `${gauge}%`,
              background: 'linear-gradient(90deg, var(--c-kill), var(--c-hold), var(--c-scale))',
            }}
          />
        </div>
      )}
    </div>
  );
}
