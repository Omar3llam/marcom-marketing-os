// ============================================================
// MARCOM — Smart CSV Parser
// ============================================================
// Resilient CSV parsing for Meta / Google Ads exports.
// Handles:
//   - Fuzzy header mapping with multi-language aliases
//   - Garbage row filtering (Totals, Summary, etc.)
//   - Graceful defaults for missing columns
//   - Case-insensitive, whitespace-tolerant matching
// ============================================================

/**
 * Fuzzy header alias map.
 * Each internal key maps to an array of variations it should match.
 * Lower-cased for comparison.
 */
const HEADER_ALIASES = {
  campaign_name: [
    'campaign name',
    'campaign',
    'campaign id name',
    'ad set name',
    'ad group',
    'اسم الحملة',
    'nom de campagne',
  ],
  campaign_id: [
    'campaign id',
    'id',
    'campaign identifier',
    'adset id',
    'ad group id',
  ],
  spend: [
    'amount spent',
    'amount spent (usd)',
    'amount spent (egp)',
    'spend',
    'cost',
    'total spend',
    'budget spent',
    'coût',
    'montant dépensé',
    'المبلغ المنفق',
  ],
  impressions: [
    'impressions',
    'imp',
    'impr',
  ],
  reach: [
    'reach',
    'réachable',
    'الوصول',
  ],
  frequency: [
    'frequency',
    'freq',
    'avg. frequency',
    'average frequency',
    'fréquence',
    'تكرار',
  ],
  clicks: [
    'clicks',
    'link clicks',
    'click count',
    'total clicks',
    'clics',
    'نقرات',
  ],
  ctr: [
    'ctr',
    'ctr (all)',
    'click-through rate',
    'link ctr',
    'taux de clic',
    'معدل النقر',
  ],
  cpc: [
    'cpc',
    'cost per click',
    'cost/click',
    'coût par clic',
    'تكلفة كل نقرة',
  ],
  cpm: [
    'cpm',
    'cost per 1000 impressions',
    'cost per thousand impressions',
    'coût pour 1000 impressions',
  ],
  results: [
    'results',
    'conversions',
    'actions',
    'total conversions',
    'résultats',
    'تحويلات',
  ],
  cost_per_result: [
    'cost per result',
    'cost per conversion',
    'cpa',
    'cost / conv',
    'cost/conversion',
    'coût par résultat',
    'تكلفة كل تحويل',
  ],
  roas: [
    'roas',
    'purchase roas',
    'return on ad spend',
    'conversion value / cost',
    'conversions value / cost',
    'conv. value / cost',
    'roaa',
    'رواس',
  ],
  revenue: [
    'revenue',
    'conversion value',
    'purchases conversion value',
    'total conversion value',
    'revenu',
    'الإيرادات',
  ],
  status: [
    'status',
    'delivery',
    'état',
    'حالة',
  ],
  start_date: [
    'start date',
    'date start',
    'reporting starts',
    'date de début',
    'تاريخ البداية',
  ],
  end_date: [
    'end date',
    'date end',
    'reporting ends',
    'date de fin',
    'تاريخ النهاية',
  ],
};

/**
 * Build a normalized header map: given raw CSV headers,
 * return an object { internalKey: rawHeaderFromCsv }.
 * Allows fuzzy matching across columns.
 *
 * @param {string[]} headers - raw CSV column names
 * @returns {object} - { campaign_name: 'Campaign Name', spend: 'Amount Spent (USD)', ... }
 */
export function buildHeaderMap(headers) {
  const map = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  // For each internal key, try to find a matching header
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = lowerHeaders.findIndex((h) => h.includes(alias));
      if (idx !== -1) {
        // Found a match; store the original header and break inner loop
        map[key] = headers[idx];
        break;
      }
    }
  }

  return map;
}

/**
 * Extract a value from a row using the header map.
 * Returns the raw string value or undefined if not found.
 *
 * @param {object} row - CSV row as { 'Campaign Name': 'Acme Q4', ... }
 * @param {object} headerMap - result of buildHeaderMap()
 * @param {string} key - internal key like 'campaign_name'
 * @returns {string|undefined}
 */
export function getColumnValue(row, headerMap, key) {
  const header = headerMap[key];
  if (!header) return undefined;
  const val = row[header];
  return val != null ? String(val).trim() : undefined;
}

/**
 * Determine if a row is "garbage" (summary, total, etc).
 * Checks campaign_name for keywords like "Total", "Summary", etc.
 * Supports English and Arabic.
 *
 * @param {string} campaignName - the campaign name from the row
 * @returns {boolean} - true if it's garbage, false if it's valid
 */
export function isGarbageRow(campaignName) {
  if (!campaignName || campaignName === '') return true;

  const lower = String(campaignName).toLowerCase();

  // Keywords indicating a summary/total row (English + Arabic)
  const garbagePatterns = [
    'total',
    'summary',
    'all campaigns',
    'grand total',
    'subtotal',
    'الإجمالي', // Arabic: Total
    'ملخص', // Arabic: Summary
    'جميع الحملات', // Arabic: All Campaigns
  ];

  return garbagePatterns.some((pattern) => lower.includes(pattern));
}

/**
 * Safe numeric extraction.
 * Removes commas, $ signs, % signs, etc.
 * Returns 0 if cannot parse or value is null/empty.
 *
 * @param {*} value
 * @returns {number}
 */
export function parseNumber(value) {
  if (value == null || value === '') return 0;
  const s = String(value)
    .replace(/[^\d.\-]/g, '') // Keep only digits, decimal point, minus
    .trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse a date string (flexible: handles common formats).
 * Returns as-is if valid-looking, otherwise returns empty string.
 *
 * @param {*} value
 * @returns {string}
 */
export function parseDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  // Very lenient: if it looks date-ish (has /, -, or 4 digits), keep it
  if (/[\d\/\-]{4,}/.test(s)) {
    return s;
  }
  return '';
}

/**
 * Smart row normalizer.
 * Applies header mapping, extracts metrics with graceful defaults,
 * filters garbage rows early.
 *
 * @param {object} row - raw CSV row
 * @param {object} headerMap - result of buildHeaderMap()
 * @param {string} platform - 'META' or 'GOOGLE'
 * @returns {object|null} - normalized row or null if garbage
 */
export function smartNormalizeRow(row, headerMap, platform) {
  // Extract primary identifiers
  const campaignName = getColumnValue(row, headerMap, 'campaign_name');
  const campaignId = getColumnValue(row, headerMap, 'campaign_id');

  // Early filter: skip garbage rows
  if (isGarbageRow(campaignName)) {
    return null;
  }

  // Ensure we have at least a campaign name
  if (!campaignName) {
    return null;
  }

  // Fall back to generated ID if missing
  const finalCampaignId = campaignId || `csv:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

  return {
    campaignId: String(finalCampaignId),
    campaignName: String(campaignName),
    platform,
    status: getColumnValue(row, headerMap, 'status') || 'ACTIVE',
    metrics: {
      impressions: parseNumber(getColumnValue(row, headerMap, 'impressions')),
      reach: parseNumber(getColumnValue(row, headerMap, 'reach')),
      frequency: parseNumber(getColumnValue(row, headerMap, 'frequency')),
      clicks: parseNumber(getColumnValue(row, headerMap, 'clicks')),
      ctr: parseNumber(getColumnValue(row, headerMap, 'ctr')),
      cpc: parseNumber(getColumnValue(row, headerMap, 'cpc')),
      cpm: parseNumber(getColumnValue(row, headerMap, 'cpm')),
      spend: parseNumber(getColumnValue(row, headerMap, 'spend')),
      results: parseNumber(getColumnValue(row, headerMap, 'results')),
      costPerResult: parseNumber(getColumnValue(row, headerMap, 'cost_per_result')),
      roas: parseNumber(getColumnValue(row, headerMap, 'roas')),
      revenue: parseNumber(getColumnValue(row, headerMap, 'revenue')),
    },
    dateRange: {
      start: parseDate(getColumnValue(row, headerMap, 'start_date')),
      end: parseDate(getColumnValue(row, headerMap, 'end_date')),
    },
  };
}

/**
 * Main entry point: parse raw CSV rows into normalized campaign objects.
 * Applies header mapping, garbage filtering, and safe metric extraction.
 *
 * @param {Array<object>} rawRows - result of csv-parse (columns: true)
 * @param {string} platform - 'META' or 'GOOGLE'
 * @returns {Array<object>} - normalized rows, with garbage filtered out
 */
export function parseSmartCSV(rawRows, platform = 'META') {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return [];
  }

  // Build header map from first row
  const firstRow = rawRows[0];
  const headers = Object.keys(firstRow);
  const headerMap = buildHeaderMap(headers);

  // Process all rows
  const normalized = [];
  for (const row of rawRows) {
    const cleaned = smartNormalizeRow(row, headerMap, platform);
    if (cleaned !== null) {
      normalized.push(cleaned);
    }
  }

  return normalized;
}
