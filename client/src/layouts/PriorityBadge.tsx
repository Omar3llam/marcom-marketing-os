// ============================================================
// MARCOM v4.1 — PriorityBadge
// ------------------------------------------------------------
// Semantic component for displaying alert priority (HIGH/MEDIUM/LOW).
// Architecture role: Visual priority indicator.
//
// FROZEN CONTRACT:
// - Props based on BACKEND-CONTRACTS.md § Lumi Feed → Alert
// - Uses types from @/types (Phase B)
//
// USAGE:
//   <PriorityBadge priority={alert.priority} />
// ============================================================

export interface PriorityBadgeProps {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * PriorityBadge — Displays alert priority.
 *
 * Semantic role: Visual priority indicator.
 * Replaces: <Badge color={...}>{priority}</Badge>
 */
export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const priorityColors = {
    HIGH: 'var(--color-status-danger)',
    MEDIUM: 'var(--color-status-warning)',
    LOW: 'var(--color-status-neutral)',
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: 'var(--spacing-xs) var(--spacing-sm)',
        background: priorityColors[priority],
        color: 'var(--color-text-on-accent)',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 600,
        borderRadius: 'var(--radius-sm)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {priority}
    </span>
  );
}
