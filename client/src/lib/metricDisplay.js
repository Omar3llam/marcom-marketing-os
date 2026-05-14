// ============================================================
// MARCOM / Lumi — Metric Display Utilities
// ------------------------------------------------------------
// Canonical metric display utility.
// Enforces: real data or honest dash — never fake numbers.
// ============================================================

/**
 * Display a metric value with formatting.
 * @param {number|null|undefined} value - The value to display
 * @param {object} options - Display options
 * @param {'number'|'currency'|'percent'} options.format - Format type
 * @param {string} options.prefix - Prefix (e.g., 'EGP ')
 * @param {string} options.suffix - Suffix (e.g., '%')
 * @param {string} options.fallback - What to show when value is null/undefined
 * @returns {string} Formatted metric or fallback
 */
export function displayMetric(value, { format = 'number', prefix = '', suffix = '', fallback = '—' } = {}) {
  if (value === null || value === undefined || (value === 0 && fallback !== '0')) {
    return fallback;
  }
  const rounded = Math.round(value * 100) / 100;
  if (format === 'currency') {
    return `${prefix}${rounded.toLocaleString('en-EG', { maximumFractionDigits: 0 })}`;
  }
  if (format === 'percent') return `${rounded > 0 ? '+' : ''}${rounded}%`;
  return `${prefix}${rounded}${suffix}`;
}

/**
 * Display spend amount in EGP currency format.
 * @param {number|null|undefined} spend - Spend amount
 * @returns {string} Formatted spend or '—'
 */
export function displaySpend(spend) {
  return displayMetric(spend, { format: 'currency', prefix: 'EGP ', fallback: '—' });
}

/**
 * Display ROAS delta as percentage with +/- sign.
 * @param {number|null|undefined} delta - ROAS delta
 * @returns {string} Formatted delta or '—'
 */
export function displayRoasDelta(delta) {
  return displayMetric(delta, { format: 'percent', fallback: '—' });
}

/**
 * Display CPA (cost per acquisition) in EGP currency format.
 * @param {number|null|undefined} cpa - CPA value
 * @returns {string} Formatted CPA or '—'
 */
export function displayCpa(cpa) {
  return displayMetric(cpa, { format: 'currency', prefix: 'EGP ', fallback: '—' });
}

/**
 * Display a count with optional label.
 * @param {number|null|undefined} count - Count value
 * @param {string} label - Label (e.g., 'active')
 * @returns {string} Formatted count or '—'
 */
export function displayCount(count, label = '') {
  if (count === null || count === undefined) return '—';
  return label ? `${count} ${label}` : `${count}`;
}
