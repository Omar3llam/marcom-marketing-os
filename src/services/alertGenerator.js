// ============================================================
// MARCOM / Lumi — Alert Generator
// ------------------------------------------------------------
// Takes a normalized campaign object (after classification) and
// emits zero or more alert objects. Each alert is the seed for
// an Action row (status: PENDING) the orchestrator can later
// expand into a full strategic + creative recommendation.
//
// Alert shape (consumed by /api/lumi/feed):
//   { priority, verdict, rootCause, rationale }
// ============================================================

/**
 * @param {object} campaign — normalized campaign (see CSV pipeline)
 * @param {string} campaign.stage
 * @param {object} campaign.metrics
 * @returns {Array<{priority,verdict,rootCause,rationale}>}
 */
export function generateAlerts(campaign = {}) {
  const alerts = [];
  const m     = campaign.metrics ?? {};
  const stage = campaign.stage;
  const roas  = numberOr(m.roas, 0);
  const ctr   = numberOr(m.ctr, 0);
  const freq  = numberOr(m.frequency, 0);

  // ── DYING → KILL ─────────────────────────────────────────────
  if (stage === 'DYING') {
    alerts.push({
      priority:  'HIGH',
      verdict:   'KILL',
      rootCause: 'CRITICAL_PERFORMANCE_DECLINE',
      rationale:
        `ROAS ${fmt(roas, 'x')} is below break-even. ` +
        `Frequency ${fmt(freq)} indicates severe creative fatigue.`,
    });
  }

  // ── FATIGUED → HOLD + refresh creative ──────────────────────
  if (stage === 'FATIGUED') {
    alerts.push({
      priority:  'MEDIUM',
      verdict:   'HOLD',
      rootCause: 'CREATIVE_FATIGUE',
      rationale:
        `Frequency ${fmt(freq)} is exceeding the healthy threshold. ` +
        `CTR has fallen to ${fmt(ctr, '%')}.`,
    });
  }

  // ── SCALING opportunity (independent of stage label) ────────
  if (roas >= 3.0 && ctr >= 2.0) {
    alerts.push({
      priority:  'LOW',
      verdict:   'SCALE',
      rootCause: 'SCALING_OPPORTUNITY',
      rationale:
        `Strong ROAS ${fmt(roas, 'x')} with healthy CTR ${fmt(ctr, '%')}. ` +
        `Budget increase recommended.`,
    });
  }

  return alerts;
}

// ── helpers ──────────────────────────────────────────────────
function numberOr(v, f) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : f;
}
function fmt(n, suffix = '') {
  if (!Number.isFinite(n)) return 'n/a';
  // Strip trailing zeros for cleaner copy in the rationale
  return `${parseFloat(n.toFixed(2))}${suffix}`;
}
