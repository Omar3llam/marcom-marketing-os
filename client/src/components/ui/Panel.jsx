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
  const iconColorCfg = {
    gold:  'text-lumi-accent',
    kill:  'text-signal-kill',
    scale: 'text-signal-scale',
    hold:  'text-signal-hold',
  }[iconTone] || 'text-lumi-accent';

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`${iconColorCfg}`}>
            <Icon className="w-4 h-4" strokeWidth={1.5} />
          </div>
          <h3 className="font-display font-semibold text-[15px] text-dark-base">
            {title}
          </h3>
        </div>
        {meta && (
          <span className="font-mono text-[10px] text-dark-subtle uppercase tracking-[0.08em]">
            {meta}
          </span>
        )}
      </div>

      {/* Content */}
      <div>{children}</div>
    </div>
  );
}
