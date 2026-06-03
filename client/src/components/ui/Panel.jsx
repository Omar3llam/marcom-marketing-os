// ============================================================
// MARCOM UI Primitive — Panel
// ============================================================
// Generic content panel with title, icon, and optional meta text.
// Used for Alerts, AI Insight, Quick Actions sections in Home page.
//
// Props:
//   title: string (panel heading)
//   Icon: Lucide icon component
//   iconTone: 'gold' | 'kill' | 'scale' | 'hold' (optional)
//   meta: string (optional, e.g., "3 high priority")
//   children: React.ReactNode (panel content)
// ============================================================

export default function Panel({ title, Icon, iconTone, meta, children }) {
  const tone = {
    gold:    { color: 'var(--c-gold-deep)',   bg: 'rgba(246,201,69,0.10)' },
    kill:    { color: 'var(--c-kill-text)',   bg: 'var(--c-kill-bg)' },
    scale:   { color: 'var(--c-scale-text)',  bg: 'var(--c-scale-bg)' },
    hold:    { color: 'var(--c-hold-text)',   bg: 'var(--c-hold-bg)' },
    neutral: { color: 'var(--c-text-soft)',   bg: 'var(--c-surface-elevated)' },
  }[iconTone] || { color: 'var(--c-gold-deep)', bg: 'rgba(246,201,69,0.10)' };

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-[18px] shadow-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2.5">
          <div
            className="w-[26px] h-[26px] rounded-lg flex items-center justify-center"
            style={{ background: tone.bg, color: tone.color }}
          >
            <Icon className="w-[13px] h-[13px]" strokeWidth={1.5} />
          </div>
          <h3 className="font-display font-bold text-sm text-dark-base tracking-tight">
            {title}
          </h3>
        </div>
        {meta && (
          <span className="font-mono text-[10px] text-dark-subtle">
            {meta}
          </span>
        )}
      </div>

      {/* Content */}
      <div>{children}</div>
    </div>
  );
}
