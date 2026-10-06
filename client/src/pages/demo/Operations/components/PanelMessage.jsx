export function PanelMessage({ icon: Icon, title, hint }) {
  return (
    <div style={{
      background: 'var(--c-surface-card)',
      border: '1px dashed var(--c-surface-border-strong)',
      borderRadius: 14,
      padding: '40px 24px',
      textAlign: 'center',
      color: 'var(--c-text-muted)',
    }}>
      {Icon && <Icon size={24} style={{ color: 'var(--c-text-subtle)', marginBottom: 8 }} />}
      <div className="font-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-base)' }}>{title}</div>
      {hint && <div className="font-mono" style={{ fontSize: 12, marginTop: 6, color: 'var(--c-text-muted)', overflowWrap: 'anywhere' }}>{hint}</div>}
    </div>
  );
}
