// ============================================================
// MARCOM — Forgiving CSV Parser
// ============================================================
// Minimal, fast CSV parsing for Meta / Google Ads exports.
// Philosophy: Parse liberally, let Claude do semantic understanding.
//
// Strategy:
//   - Strip BOM from headers
//   - Minimal column name normalization (for spend, name, results)
//   - Filter only rows with zero/missing spend OR empty campaign name
//   - Pass raw row data to LLM as-is for context understanding
// ============================================================

/**
 * Minimal attempt to find a spend column.
 * Looks for: 'Amount spent', 'Amount sp', 'Spend', 'Cost'
 * Returns the raw header name if found, or undefined.
 *
 * @param {object} row
 * @param {string[]} headers
 * @returns {string|undefined}
 */
function findSpendColumn(row, headers) {
  const lower = headers.map((h) => h.toLowerCase());
  const patterns = ['amount spent', 'amount sp', 'spend', 'cost'];
  
  for (const pattern of patterns) {
    const idx = lower.findIndex((h) => h.includes(pattern));
    if (idx !== -1) return headers[idx];
  }
  return undefined;
}

/**
 * Minimal attempt to find a campaign name column.
 * Looks for: 'Campaign name', 'Campaign', 'Ad set name'
 * Returns the raw header name if found, or undefined.
 *
 * @param {string[]} headers
 * @returns {string|undefined}
 */
function findNameColumn(headers) {
  const lower = headers.map((h) => h.toLowerCase());
  const patterns = ['campaign name', 'campaign', 'ad set name', 'ad group'];
  
  for (const pattern of patterns) {
    const idx = lower.findIndex((h) => h.includes(pattern));
    if (idx !== -1) return headers[idx];
  }
  return undefined;
}

/**
 * Minimal attempt to find a results/conversions column.
 * Looks for: 'Results', 'Conversions', 'Actions'
 * Returns the raw header name if found, or undefined.
 *
 * @param {string[]} headers
 * @returns {string|undefined}
 */
function findResultsColumn(headers) {
  const lower = headers.map((h) => h.toLowerCase());
  const patterns = ['results', 'conversions', 'actions', 'total conversions'];
  
  for (const pattern of patterns) {
    const idx = lower.findIndex((h) => h.includes(pattern));
    if (idx !== -1) return headers[idx];
  }
  return undefined;
}

/**
 * Safe numeric parse: strips symbols, returns 0 on failure.
 *
 * @param {*} value
 * @returns {number}
 */
function toNumber(value) {
  if (value == null || value === '') return 0;
  const s = String(value).replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Strip BOM and normalize header names minimally.
 * Only normalizes keys for spend, name, results.
 * Passes everything else through as-is.
 *
 * @param {object} row - raw CSV row
 * @param {string[]} headers - raw CSV headers
 * @param {string} platform - 'META' or 'GOOGLE'
 * @returns {object} - normalized row or null if garbage
 */
function forgivingNormalizeRow(row, headers, platform) {
  // Find columns by loose pattern matching
  const spendCol = findSpendColumn(row, headers);
  const nameCol = findNameColumn(headers);
  const resultsCol = findResultsColumn(headers);

  // Extract basic fields
  const spend = toNumber(row[spendCol]);
  const campaignName = nameCol ? String(row[nameCol] || '').trim() : '';
  const results = toNumber(row[resultsCol]);

  // Minimal filtering: skip if no spend OR no campaign name
  if (spend === 0 || !campaignName) {
    return null;
  }

  // Skip obvious totals rows (case-insensitive)
  const lower = campaignName.toLowerCase();
  if (lower.includes('total') || lower.includes('summary') || lower.includes('الإجمالي')) {
    return null;
  }

  // Normalize: create a row with standard keys, pass raw data as meta
  return {
    campaignId: `csv:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`,
    campaignName,
    platform,
    spend,
    results,
    // Pass entire raw row for Claude to parse
    rawData: row,
    rawHeaders: headers,
  };
}

/**
 * Main entry point: parse raw CSV rows with extreme forgiveness.
 * Strip BOM, minimal filtering, pass raw data to LLM.
 *
 * @param {Array<object>} rawRows - result of csv-parse (columns: true)
 * @param {string} platform - 'META' or 'GOOGLE'
 * @returns {Array<object>} - forgivingly normalized rows
 */
export function parseSmartCSV(rawRows, platform = 'META') {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return [];
  }

  // Get headers from first row, strip BOM
  const firstRow = rawRows[0];
  const rawHeaders = Object.keys(firstRow);
  const headers = rawHeaders.map((h) => h.replace(/^\ufeff/, '').trim());

  // Process all rows with forgiving strategy
  const normalized = [];
  for (const row of rawRows) {
    // Rebuild row with cleaned headers (BOM stripped)
    const cleanRow = {};
    for (let i = 0; i < rawHeaders.length; i++) {
      const cleanKey = headers[i];
      cleanRow[cleanKey] = row[rawHeaders[i]];
    }

    const cleaned = forgivingNormalizeRow(cleanRow, headers, platform);
    if (cleaned !== null) {
      normalized.push(cleaned);
    }
  }

  return normalized;
}
