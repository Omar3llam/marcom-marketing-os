// ============================================================
// MARCOM UI Primitive — EmptyPanel
// ============================================================
// Empty state display for panels with optional icon and message.
//
// Props:
//   text: string (empty state message)
//   Icon: Lucide icon component (optional)
// ============================================================

export default function EmptyPanel({ text, Icon }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      {Icon && (
        <div className="w-12 h-12 mb-3 flex items-center justify-center rounded-xl bg-surface-elevated text-dark-subtle">
          <Icon className="w-6 h-6" strokeWidth={1.5} />
        </div>
      )}
      <p className="text-sm text-dark-subtle font-mono">{text}</p>
    </div>
  );
}
