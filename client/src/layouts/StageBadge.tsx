// ============================================================
// MARCOM v4.1 — StageBadge
// ------------------------------------------------------------
// Semantic component for displaying campaign stage.
// Architecture role: Campaign health indicator.
//
// FROZEN CONTRACT:
// - Props based on BACKEND-CONTRACTS.md § Lumi Feed → Campaign
// - Uses types from @/types (Phase B)
//
// USAGE:
//   <StageBadge stage={campaign.stage} />
// ============================================================

import type { CampaignStage } from '@/types';

export interface StageBadgeProps {
  stage: CampaignStage;
}

/**
 * StageBadge — Displays campaign stage.
 *
 * Semantic role: Campaign health indicator.
 * Replaces: <StatusBadge>{stage}</StatusBadge>
 */
export function StageBadge({ stage }: StageBadgeProps) {
  const stageColors = {
    DYING: 'var(--color-status-danger)',
    FATIGUED: 'var(--color-status-warning)',
    TESTING: 'var(--color-status-neutral)',
    SCALING: 'var(--color-status-positive)',
    STABLE: 'var(--color-status-positive)',
  };

  const stageIcons = {
    DYING: '🔻',
    FATIGUED: '⚠️',
    TESTING: '🧪',
    SCALING: '📈',
    STABLE: '✅',
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--spacing-xs)',
        padding: 'var(--spacing-xs) var(--spacing-sm)',
        background: stageColors[stage],
        color: 'var(--color-text-on-accent)',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 600,
        borderRadius: 'var(--radius-sm)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      <span>{stageIcons[stage]}</span>
      <span>{stage}</span>
    </span>
  );
}
