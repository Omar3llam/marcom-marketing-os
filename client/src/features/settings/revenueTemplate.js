// ============================================================
// MARCOM / Lumi — revenue CSV template (pure, client-side)
// ------------------------------------------------------------
// Builds the starter CSV for Settings · Revenue data. When connector campaigns
// are loaded, the rows are the user's REAL campaigns that still need revenue
// (conversion campaigns without measured revenue — the existing `needsRevenue`
// flag), highest spend first, so the operator only fills in the revenue column.
// No campaigns → generic placeholder rows. Generated entirely in the browser —
// never a network call, never a backend endpoint.
// ============================================================

// The three columns the mapping step expects (identifier, revenue, optional
// conversions).
export const TEMPLATE_HEADER = ['Campaign Name', 'Revenue Amount', 'Conversions (optional)'];

// Fallback rows for an account with no campaigns loaded yet — generic names
// the operator overwrites, never fake "real-looking" campaigns.
const PLACEHOLDER_ROWS = [
  ['Your Campaign Name Here', '5000', '10'],
  ['Another Campaign', '3500', '7'],
];

/**
 * Campaigns worth pre-filling: those that need revenue data, biggest spenders
 * first (missing spend sinks last), blank names dropped (nothing to match on).
 */
export function templateCampaignsFor(campaigns = []) {
  return campaigns
    .filter((c) => c?.needsRevenue && typeof c.name === 'string' && c.name.trim() !== '')
    .sort((a, b) => (b.spendMinor ?? -1) - (a.spendMinor ?? -1));
}

/** RFC-4180: quote a field containing comma/quote/newline, doubling quotes. */
export function escapeCsvField(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Header + one row per campaign — real name filled in, revenue/conversions left
 * blank for the operator. Empty list → the generic placeholder template.
 */
export function buildTemplateCsv(campaigns = []) {
  const rows = campaigns.length > 0
    ? campaigns.map((c) => [escapeCsvField(c.name), '', ''])
    : PLACEHOLDER_ROWS;
  return [TEMPLATE_HEADER, ...rows].map((r) => r.join(',')).join('\n');
}

/** Trigger a browser download of the template CSV. */
export function downloadTemplate(campaigns = []) {
  const blob = new Blob([buildTemplateCsv(campaigns)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lumi-revenue-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}
