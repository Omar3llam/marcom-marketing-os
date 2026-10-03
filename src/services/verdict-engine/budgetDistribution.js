import { classifyCurrencyHomogeneity, CURRENCY_HOMOGENEITY, currencyUnavailableReason } from '../../lib/currencyHomogeneity.js';

const LANES = Object.freeze({ KILL: 'kill', SCALE: 'scale', HOLD: 'hold', WATCH: 'hold', REALLOCATE: 'hold', REFRESH: 'hold' });
const withheld = (status, reason) => ({
  status, reason, currency: null, totalSpendMinor: null,
  killSpendMinor: null, holdSpendMinor: null, scaleSpendMinor: null,
  killPct: null, holdPct: null, scalePct: null,
});

// One rounding rule, on the server: nearest hundredth of a percentage point.
// Independently rounded lanes can sum to 99.99 or 100.01; no lane is repaired.
const percentage = (amount, total) => Math.round((amount / total) * 10000) / 100;

/** Read-only publication over THIS evaluation's verdict-bearing campaign rows.
 * Engine currency/amount defaults never enter the evidence or denominator.
 */
export function projectBudgetDistribution({ campaigns = [], annotated = null } = {}) {
  const byId = new Map(campaigns.map((row) => [row.entityId, row]));
  const contributors = [];
  for (const node of annotated?.children ?? []) {
    if (!node.verdict) continue;
    const row = byId.get(node.id);
    if (!Number.isFinite(row?.spendMinor) || row.spendMinor <= 0) continue;
    const lane = Object.hasOwn(LANES, node.verdict) ? LANES[node.verdict] : null;
    if (!lane) throw new Error('Budget distribution encountered an undeclared verdict');
    contributors.push({ ...row, lane });
  }
  if (!contributors.length) return withheld('EMPTY', 'NO_SCORED_SPEND');
  const homogeneity = classifyCurrencyHomogeneity(contributors, {
    amountField: 'spendMinor', requireAuthoritative: true,
  });
  if (homogeneity.status !== CURRENCY_HOMOGENEITY.HOMOGENEOUS_AUTHORITATIVE) {
    return withheld('UNAVAILABLE', currencyUnavailableReason(homogeneity.status));
  }
  const lanes = { kill: 0, hold: 0, scale: 0 };
  for (const row of contributors) lanes[row.lane] += row.spendMinor;
  const total = lanes.kill + lanes.hold + lanes.scale;
  if (!Number.isFinite(total)) throw new Error('Budget distribution spend exceeds finite range');
  return {
    status: 'AVAILABLE', reason: null, currency: homogeneity.currency,
    totalSpendMinor: total, killSpendMinor: lanes.kill, holdSpendMinor: lanes.hold, scaleSpendMinor: lanes.scale,
    killPct: percentage(lanes.kill, total), holdPct: percentage(lanes.hold, total), scalePct: percentage(lanes.scale, total),
  };
}
