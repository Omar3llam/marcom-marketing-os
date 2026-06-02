// ============================================================
// MARCOM — Currency Detection Utility
// ============================================================
// Extracts currency codes from CSV headers and Meta account data.
// Supports: EGP, USD, SAR, AED, EUR, GBP, and other ISO 4217 codes.
// ============================================================

/**
 * Extract currency code from CSV headers.
 * Looks for patterns like:
 *   - "Amount spent (EGP)"
 *   - "Amount spent (USD)"
 *   - "Cost (SAR)"
 *   - "Spend (AED)"
 *
 * @param {Array<string>} headers - CSV column headers
 * @returns {string} - ISO 4217 currency code (e.g., "EGP", "USD") or "USD" fallback
 */
export function detectCurrencyFromHeaders(headers) {
  if (!Array.isArray(headers) || headers.length === 0) {
    console.warn('[currencyDetector] No headers provided, using USD fallback');
    return 'USD';
  }

  // Common monetary column patterns
  const monetaryColumns = [
    'amount spent',
    'spend',
    'cost',
    'amount',
    'budget',
    'cost per result',
    'cpa',
    'cpc',
  ];

  // Regex to extract currency code in parentheses: (EGP), (USD), (SAR), etc.
  const currencyPattern = /\(([A-Z]{3})\)/i;

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();

    // Check if this is a monetary column
    const isMonetary = monetaryColumns.some((col) => normalized.includes(col));

    if (isMonetary) {
      const match = header.match(currencyPattern);
      if (match) {
        const currency = match[1].toUpperCase();
        console.log(`[currencyDetector] Detected currency: ${currency} from header: ${header}`);
        return currency;
      }
    }
  }

  console.warn('[currencyDetector] No currency found in headers, using USD fallback');
  return 'USD';
}

/**
 * Detect currency from Meta Ad Account API response.
 * Meta returns account.currency as ISO 4217 code.
 *
 * @param {object} accountData - Meta Ad Account object
 * @returns {string} - ISO 4217 currency code or "USD" fallback
 */
export function detectCurrencyFromMetaAccount(accountData) {
  if (!accountData) {
    console.warn('[currencyDetector] No account data provided, using USD fallback');
    return 'USD';
  }

  const currency = accountData.currency || accountData.account_currency;

  if (currency && typeof currency === 'string' && currency.length === 3) {
    console.log(`[currencyDetector] Detected currency from Meta account: ${currency}`);
    return currency.toUpperCase();
  }

  console.warn('[currencyDetector] No valid currency in Meta account data, using USD fallback');
  return 'USD';
}

/**
 * Validate currency code against common ISO 4217 codes.
 * Returns the code if valid, otherwise "USD".
 *
 * @param {string} code - Currency code to validate
 * @returns {string} - Validated currency code or "USD"
 */
export function validateCurrencyCode(code) {
  if (!code || typeof code !== 'string') return 'USD';

  const validCurrencies = new Set([
    'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'CAD', 'AUD',
    'EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD',
    'TRY', 'ZAR', 'BRL', 'MXN', 'RUB', 'CHF', 'SEK', 'NOK',
    'DKK', 'PLN', 'THB', 'MYR', 'SGD', 'HKD', 'NZD', 'KRW',
  ]);

  const normalized = code.toUpperCase().trim();

  if (validCurrencies.has(normalized)) {
    return normalized;
  }

  console.warn(`[currencyDetector] Unknown currency code: ${code}, using USD fallback`);
  return 'USD';
}
