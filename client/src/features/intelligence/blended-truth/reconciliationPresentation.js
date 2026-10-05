import { formatCurrency } from '@/lib/money';
import { isKnownCurrency } from '@/lib/monetaryCurrency.js';
import { gapPresentation } from './gapPresentation.js';

const REASONS = {
  ACTUAL_REVENUE_UNAVAILABLE: 'No actual revenue evidence is available for comparison.',
  MONETARY_BASIS_UNAVAILABLE: 'Platform and actual revenue do not share a proven monetary basis.',
  MEASUREMENT_WINDOW_UNKNOWN: 'A revenue measurement period is unknown.',
  MEASUREMENT_WINDOW_MISMATCH: 'Platform and actual revenue measure different periods.',
  PORTFOLIO_WINDOW_MISMATCH: 'Comparable channels do not share one evidence period.',
  PORTFOLIO_CURRENCY_MISMATCH: 'Comparable channels do not share one currency.',
  NO_COMPARABLE_CHANNELS: 'No channel has comparable platform and actual revenue evidence.',
};
export const ratioText = value => Number.isFinite(value) ? `${value.toFixed(1)}×` : '—';

// Expression of admitted facts only. No subtraction, division, window comparison
// or use of coverage/confidence/selected-revenue availability to authorize a gap.
export function reconciliationPresentation(reconciliation) {
  const r = reconciliation;
  if (r?.status !== 'AVAILABLE') return {
    label: r?.status === 'UNVERIFIED' ? 'Unverified' : 'Unavailable', gap: '—', period: null,
    reason: REASONS[r?.reason] ?? 'Revenue reconciliation is unavailable.',
  };
  if (!isKnownCurrency(r.currency) || !Number.isFinite(r.gapMinor)) return {
    label: 'Unavailable', gap: '—', period: null, reason: 'Revenue reconciliation is unavailable.',
  };
  // A missing percentage never becomes a displayed percentage. The existing
  // formatter may still express the direction of the proven absolute amount.
  const gap = gapPresentation(r.gapPct ?? 0, r.gapMinor);
  const money = formatCurrency(gap.magnitudeMinor, r.currency);
  const direction = gap.direction === 'MATCH' ? 'Match'
    : `${r.gapPct === null ? '' : `${gap.pctText} `}${gap.direction === 'ABOVE' ? 'above' : 'below'}`;
  return { label: 'Reconciled', gap: `${direction} · ${money} difference`,
    period: `${r.window.windowStart.slice(0, 10)} → ${r.window.windowEnd.slice(0, 10)}`,
    reason: r.gapPctReason === 'ZERO_PLATFORM_DENOMINATOR'
      ? 'Percentage unavailable because platform-reported revenue is zero.' : null };
}

export function channelPresentation(c) {
  return { id: c.channelId, name: c.name ?? c.channel ?? c.channelId, channel: c.channel ?? c.channelId,
    platformRoas: ratioText(c.platformRoas), blendedEfficiency: ratioText(c.blendedRevenueEfficiency?.value),
    reconciliation: reconciliationPresentation(c.reconciliation) };
}
