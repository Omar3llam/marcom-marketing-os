import { Cpu } from 'lucide-react';

const MACHINE_ACTORS = ['lumi', 'worker', 'api', 'retry_policy', 'supervisor', 'timeout_handler', 'system', 'reconciliation'];

export function ActorBadge({ name }) {
  if (!name) return null;
  const isMachine = MACHINE_ACTORS.some((x) => name.toLowerCase().includes(x));
  return (
    <span
      className="font-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: isMachine ? 'rgba(246,201,69,0.10)' : 'var(--c-surface-elevated)',
        color: 'var(--c-text-soft)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'lowercase',
        overflowWrap: 'anywhere',
      }}
    >
      {isMachine && <Cpu size={9} />}
      {name}
    </span>
  );
}
