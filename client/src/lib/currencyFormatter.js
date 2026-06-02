// ============================================================
// MARCOM — Global Currency Formatter
// ============================================================
// Dynamic currency formatting based on ISO 4217 currency codes.
// Replaces hardcoded USD with detected currency from campaigns.
// ============================================================

/**
 * Currency symbol mapping for major currencies.
 * Falls back to Intl.NumberFormat for others.
 */
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
  EGP: 'E£',
  SAR: 'SAR',
  AED: 'AED',
  KWD: 'KWD',
  QAR: 'QAR',
  BHD: 'BHD',
  OMR: 'OMR',
  JOD: 'JOD',
};

/**
 * Locale mapping for currency-specific number formatting.
 * Ensures proper thousands/decimal separators.
 */
const CURRENCY_LOCALES = {
  USD: 'en-US',
  EUR: 'de-DE',  // European format (1.234,56)
  GBP: 'en-GB',
  EGP: 'ar-EG',  // Egyptian locale
  SAR: 'ar-SA',  // Saudi Arabia
  AED: 'ar-AE',  // UAE
  KWD: 'ar-KW',
  QAR: 'ar-QA',
  BHD: 'ar-BH',
  OMR: 'ar-OM',
  JOD: 'ar-JO',
};

/**
 * Format a monetary value with currency code.
 *
 * @param {number} value - Numeric amount
 * @param {string} currency - ISO 4217 currency code (e.g., "EGP", "USD")
 * @param {object} options - Formatting options
 * @param {number} options.decimals - Number of decimal places (default: 2)
 * @param {boolean} options.compact - Use compact notation for large numbers (default: false)
 * @returns {string} - Formatted currency string (e.g., "E£ 4,242.07", "$1,234.56")
 */
export function formatCurrency(value, currency = 'USD', options = {}) {
  const {
    decimals = 2,
    compact = false,
  } = options;

  // Handle invalid inputs
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  // Normalize currency code
  const currencyCode = (currency || 'USD').toUpperCase().trim();

  // Get locale for this currency
  const locale = CURRENCY_LOCALES[currencyCode] || 'en-US';

  try {
    // Use Intl.NumberFormat for proper localization
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      notation: compact ? 'compact' : 'standard',
    });

    return formatter.format(value);
  } catch (error) {
    // Fallback: manual formatting if currency not supported
    console.warn(`[currencyFormatter] Intl.NumberFormat failed for ${currencyCode}:`, error.message);

    const symbol = CURRENCY_SYMBOLS[currencyCode] || currencyCode;
    const formatted = value.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    // Symbol placement: Arabic currencies typically go after number
    if (locale.startsWith('ar-')) {
      return `${formatted} ${symbol}`;
    }

    return `${symbol} ${formatted}`;
  }
}

/**
 * Format currency with abbreviated suffix for large numbers.
 * Examples: E£ 1.2K, E£ 4.5M, E£ 1.2B
 *
 * @param {number} value - Numeric amount
 * @param {string} currency - ISO 4217 currency code
 * @returns {string} - Abbreviated currency string
 */
export function formatCurrencyCompact(value, currency = 'USD') {
  return formatCurrency(value, currency, { compact: true, decimals: 1 });
}

/**
 * Format currency without decimals (for whole numbers).
 *
 * @param {number} value - Numeric amount
 * @param {string} currency - ISO 4217 currency code
 * @returns {string} - Formatted currency string without decimals
 */
export function formatCurrencyWhole(value, currency = 'USD') {
  return formatCurrency(value, currency, { decimals: 0 });
}

/**
 * Extract currency code from a campaign object.
 * Tries multiple possible locations where currency might be stored.
 *
 * @param {object} campaign - Campaign data object
 * @returns {string} - ISO 4217 currency code or "USD" fallback
 */
export function getCampaignCurrency(campaign) {
  if (!campaign) return 'USD';

  // Try different possible locations
  return (
    campaign.currency ||
    campaign.account_currency ||
    campaign.sourceMetrics?.currency ||
    campaign._rawDecision?.currency ||
    'USD'
  );
}

/**
 * Batch format multiple currency values from campaigns array.
 * Auto-detects currency from first campaign with valid currency.
 *
 * @param {Array<object>} campaigns - Array of campaign objects
 * @returns {object} - { currency: string, formatter: function }
 */
export function createCurrencyFormatter(campaigns) {
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return {
      currency: 'USD',
      format: (value, options) => formatCurrency(value, 'USD', options),
    };
  }

  // Find first campaign with valid currency
  let currency = 'USD';
  for (const campaign of campaigns) {
    const detected = getCampaignCurrency(campaign);
    if (detected && detected !== 'USD') {
      currency = detected;
      break;
    }
  }

  return {
    currency,
    format: (value, options) => formatCurrency(value, currency, options),
  };
}
