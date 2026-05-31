export function fmtCurrency(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
export function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}
export function roasColor(v) {
  if (v < 1.0) return 'text-trend-danger';
  if (v < 2.5) return 'text-trend-warning';
  return 'text-trend-positive';
}
export function freqColor(v) {
  if (v > 5)   return 'text-trend-danger';
  if (v > 3.5) return 'text-trend-warning';
  return 'text-lumi-text';
}
