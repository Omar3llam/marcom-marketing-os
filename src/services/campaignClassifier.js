// ============================================================
// MARCOM / Lumi — Campaign Stage Classifier
// ------------------------------------------------------------
// Pure function. Takes the normalized metric block produced by
// the CSV upload pipeline and returns one of:
//   DYING | FATIGUED | TESTING | SCALING | STABLE
//
// Order of evaluation matters — the most severe condition wins.
// ============================================================

/**
 * @param {object} metrics
 * @param {number} metrics.roas       — return on ad spend (multiplier)
 * @param {number} metrics.ctr        — click-through rate (percent, e.g. 1.5 = 1.5 %)
 * @param {number} metrics.frequency  — average impressions per user
 * @param {number} [metrics.cpc]
 * @param {number} [metrics.spend]
 */
export function classifyCampaignStage(metrics = {}) {
  const roas      = numberOr(metrics.roas, 0);
  const ctr       = numberOr(metrics.ctr, 0);
  const frequency = numberOr(metrics.frequency, 0);

  // ── DYING — critical decline, kill candidate ────────────────
  if (roas < 0.5 || (ctr < 0.5 && frequency > 4)) return 'DYING';

  // ── FATIGUED — under target, recoverable with refresh ───────
  if (roas < 1.0 || frequency > 3 || ctr < 1.0) return 'FATIGUED';

  // ── SCALING — strong performance, ready for budget lift ─────
  if (roas >= 3.0 && ctr >= 2.0 && frequency < 2) return 'SCALING';

  // ── STABLE — meeting targets, hold steady ───────────────────
  if (roas >= 1.5 && ctr >= 1.5) return 'STABLE';

  // ── TESTING — default; not enough signal yet ────────────────
  return 'TESTING';
}

function numberOr(v, fallback) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
