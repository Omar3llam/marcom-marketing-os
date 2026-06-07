// ============================================================
// NetworkEngine — gated, anonymized cross-account aggregation
// ============================================================
// Public API:
//   aggregateNetwork({ contributions, config })
//
// DETERMINISM CONTRACT: same input → same output. No randomness, no DB.
//
// HONESTY BY CONSTRUCTION (the network must never lie or leak):
//   • k-anonymity — a cohort insight is suppressed unless ≥ K DISTINCT
//     consenting workspaces contribute. One client's pattern can never be
//     reverse-identified from an aggregate.
//   • bands, not points — the held-rate is reported as a Wilson interval
//     [lo, hi], never a single confident number.
//   • no identities — the output carries only an anonymized COUNT of
//     contributing workspaces, never a workspace id.
//   • insufficient data is honest — below the gate it returns
//     INSUFFICIENT_DATA, not a fabricated "across the market…" claim.
// ============================================================
import { NETWORK_STATUS, DEFAULT_K, DEFAULT_MIN_SUPPORT } from './networkTypes.js';
import { logger } from '../../utils/logger.js';

const Z = 1.96; // 95% confidence
const round2 = (n) => Math.round(n * 100) / 100;
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Wilson score interval for a proportion p over effective sample n. */
function wilsonBand(p, n) {
  if (n <= 0) return [0, 1];
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (Z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [round2(clamp01(center - margin)), round2(clamp01(center + margin))];
}

function weightedMedian(pairs) {
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return sorted.length ? sorted[Math.floor(sorted.length / 2)].value : 0;
  let acc = 0;
  for (const p of sorted) { acc += p.weight; if (acc >= total / 2) return p.value; }
  return sorted[sorted.length - 1].value;
}

/**
 * Aggregate anonymized per-workspace pattern contributions into gated,
 * banded cohort insights.
 *
 * @param {object} args
 * @param {Array}  args.contributions — [{ cohortTag, workspaceKey, kind, metric, threshold, accuracy, weight }]
 *   `workspaceKey` is an opaque/anonymized id used ONLY to count distinct
 *   contributors for k-anonymity; it never appears in the output.
 * @param {object} [args.config] — { k, minSupport }
 * @returns {Array} insights — [{ status, cohortTag, kind, metric, ... }]
 */
export function aggregateNetwork({ contributions = [], config = {} } = {}) {
  const k = config.k ?? DEFAULT_K;
  const minSupport = config.minSupport ?? DEFAULT_MIN_SUPPORT;

  const groups = new Map(); // cohort|kind|metric → { rows, workspaces:Set }
  for (const c of contributions) {
    if (c.accuracy == null) continue;
    const key = `${c.cohortTag}|${c.kind}|${c.metric}`;
    if (!groups.has(key)) groups.set(key, { cohortTag: c.cohortTag, kind: c.kind, metric: c.metric, rows: [], workspaces: new Set() });
    const g = groups.get(key);
    g.rows.push({ threshold: c.threshold, accuracy: c.accuracy, weight: c.weight ?? 1 });
    if (c.workspaceKey != null) g.workspaces.add(c.workspaceKey);
  }

  const insights = [];
  for (const [, g] of groups) {
    const distinct = g.workspaces.size;
    const totalWeight = g.rows.reduce((s, r) => s + r.weight, 0);

    // Gate: k-anonymity AND minimum support. Suppress otherwise.
    if (distinct < k || totalWeight < minSupport) {
      insights.push({
        status: NETWORK_STATUS.INSUFFICIENT_DATA,
        cohortTag: g.cohortTag, kind: g.kind, metric: g.metric,
        contributingWorkspaces: distinct, needed: k,
      });
      continue;
    }

    const holdRate = round2(g.rows.reduce((s, r) => s + r.weight * r.accuracy, 0) / totalWeight);
    const band = wilsonBand(holdRate, distinct); // n = distinct workspaces (conservative)
    const threshold = weightedMedian(g.rows.map((r) => ({ value: r.threshold, weight: r.weight })));

    insights.push({
      status: NETWORK_STATUS.OK,
      cohortTag: g.cohortTag, kind: g.kind, metric: g.metric,
      contributingWorkspaces: distinct,
      threshold: Math.round(threshold * 10) / 10,
      holdRate,
      accuracyBand: band,
      statement: `Across ${distinct} consenting ${g.cohortTag} accounts, this ${g.kind.replace(/_/g, ' ').toLowerCase()} ` +
                 `held in ~${Math.round(holdRate * 100)}% of cases (${Math.round(band[0] * 100)}–${Math.round(band[1] * 100)}%).`,
    });
  }

  // Deterministic order.
  insights.sort((a, b) =>
    a.cohortTag.localeCompare(b.cohortTag) || a.kind.localeCompare(b.kind) || a.metric.localeCompare(b.metric));
  logger.debug({ insights: insights.length }, '[NetworkEngine] aggregated');
  return insights;
}
