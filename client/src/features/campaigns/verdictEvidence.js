// ============================================================
// MARCOM / Lumi — verdictEvidence (pure)
// ------------------------------------------------------------
// Turns the verdict engine's EXISTING fields (rationale, confidence, verdict,
// roas, spendMinor) into the marketer-facing evidence strings the Campaigns UI
// shows. Surfacing only: every figure quoted here was written by the backend
// into the rationale, or is the campaign's own snapshot metric — nothing is
// recomputed or invented on the client.
// ============================================================
import { formatCurrency } from '@/lib/money';

// Shown whenever a KILL/SCALE was reached with no measured revenue.
export const NO_REVENUE_DISCLAIMER =
  'No revenue data found — recommendation based on CTR, Frequency and Spend only.';

/** The engine's numeric confidence (0–1) → a marketer label. Null-safe. */
export function confidenceLabel(confidence) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.6) return 'Medium';
  return 'Low';
}

/**
 * The measurable evidence the engine already wrote: the rationale's leading
 * clause (before the " — " commentary), e.g. "Lowest CTR in the conversion
 * group (0.85% vs 1.42% group average)". Null when there is no rationale —
 * the caller renders nothing rather than inventing a reason.
 */
export function evidenceClause(rationale) {
  if (typeof rationale !== 'string') return null;
  const clause = rationale.split(' — ')[0].trim().replace(/\.$/, '');
  return clause || null;
}

/**
 * Compact form for the table badge: the evidence clause without its
 * parenthetical numbers, with the engine's cohort label shortened
 * ("the conversion group" → "its group"). String surgery on the backend's
 * own words only — never a synthesized claim.
 */
export function shortEvidence(rationale) {
  const clause = evidenceClause(rationale);
  if (!clause) return null;
  return clause
    .replace(/\s*\(.*\)$/, '')
    .replace(/\bthe (awareness|conversion) group\b/, 'its group');
}

/** The next step a KILL/SCALE asks for. Null for every other verdict. */
export function nextActionFor(verdict) {
  if (verdict === 'KILL') return 'Pause and reallocate budget';
  if (verdict === 'SCALE') return 'Increase budget or expand audience';
  return null;
}

/**
 * "What happens if I ignore it?" — phrased only from real figures. spendMinor
 * is the synced-window total (the window varies per sync), so it is quoted as
 * spend-so-far, never extrapolated into a per-month rate the data can't support.
 */
export function ignoreCostFor({ verdict, roas = null, spendMinor = null, currency = 'USD' } = {}) {
  if (verdict === 'KILL') {
    if (roas != null) {
      return `Continuing to spend here returns ${roas.toFixed(2)}x — below break-even, so every unit spent loses money.`;
    }
    return spendMinor != null
      ? `Continuing to spend here grows the ${formatCurrency(spendMinor, currency)} already spent with no revenue measured.`
      : 'Continuing to spend here wastes budget with no revenue measured.';
  }
  if (verdict === 'SCALE') {
    return roas != null
      ? 'Not scaling misses the highest-return opportunity in your portfolio.'
      : 'Not scaling misses the strongest-engagement campaign in your portfolio.';
  }
  return null;
}
