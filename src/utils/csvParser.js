// ============================================================
// MARCOM — Pass-Through CSV Parser
// ============================================================
// 100% transparent CSV parsing. No filtering, no validation.
// Just strip BOM from headers and return all rows as-is.
// Claude handles all semantic understanding on the backend.
// ============================================================

/**
 * Main entry point: parse CSV rows with ZERO filtering.
 * Strip BOM from headers. Return every row.
 * If it parses, it passes.
 *
 * @param {Array<object>} rawRows - result of csv-parse (columns: true)
 * @param {string} platform - 'META' or 'GOOGLE'
 * @returns {Array<object>} - all rows, BOM-cleaned headers
 */
export function parseSmartCSV(rawRows, platform = 'META') {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return [];
  }

  // Get raw headers from first row
  const firstRow = rawRows[0];
  const rawHeaders = Object.keys(firstRow);
  
  // Strip BOM from header names
  const cleanHeaders = rawHeaders.map((h) => h.replace(/^\ufeff/, '').trim());

  // Rebuild all rows with clean headers, pass through as-is
  const result = [];
  for (const row of rawRows) {
    const cleanRow = {};
    for (let i = 0; i < rawHeaders.length; i++) {
      cleanRow[cleanHeaders[i]] = row[rawHeaders[i]];
    }
    result.push({
      rowData: cleanRow,
      headers: cleanHeaders,
      platform,
    });
  }

  return result;
}
