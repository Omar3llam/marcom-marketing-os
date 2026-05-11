// ============================================================
// MARCOM / Lumi — CSV Column Aliases Registry
// ============================================================
// Centralized mapping for Meta's inconsistent CSV headers.
// Handles:
//   - Multiple currencies (EGP, USD, SAR, AED, GBP, EUR)
//   - Localized headers (English, Spanish, French, Arabic)
//   - Varied terminology (spend vs cost, results vs conversions)
//   - Whitespace and punctuation variations
// ============================================================

export const COLUMN_ALIASES = {
  spend: [
    'spend',
    'amount spent',
    'amount spent (usd)',
    'amount spent (egp)',
    'amount spent (aed)',
    'amount spent (sar)',
    'amount spent (gbp)',
    'amount spent (eur)',
    'amount spent (cad)',
    'amount spent (aud)',
    'cost',
    'total spend',
    'total cost',
    'importe gastado',
    'coût',
    'المبلغ المنفق', // Arabic: "amount spent"
  ],

  results: [
    'results',
    'purchases',
    'leads',
    'conversions',
    'actions',
    'link clicks',
    'landing page views',
    'sign ups',
    'registrations',
    'resultados',
    'résultats',
  ],

  costPerResult: [
    'cost per result',
    'cpa',
    'cost per purchase',
    'cost per lead',
    'cost per conversion',
    'cost per action',
    'cpp',
    'cost per results',
    'coste por resultado',
    'coût par résultat',
  ],

  impressions: [
    'impressions',
    'impr.',
    'impression',
    'impresiones',
  ],

  clicks: [
    'clicks',
    'link clicks',
    'outbound clicks',
    'all clicks',
    'clics',
  ],

  ctr: [
    'ctr',
    'click-through rate',
    'link ctr',
    'ctr (link click-through rate)',
  ],

  campaignName: [
    'campaign name',
    'campaign',
    'ad campaign name',
    'nombre de campaña',
    'nom de campagne',
  ],

  campaignId: [
    'campaign id',
    'campaign_id',
    'id',
  ],

  adsetName: [
    'ad set name',
    'adset name',
    'ad set',
    'conjunto de anuncios',
  ],

  reach: [
    'reach',
    'unique reach',
    'alcance',
    'portée',
  ],

  frequency: [
    'frequency',
    'frecuencia',
    'fréquence',
  ],

  roas: [
    'roas',
    'purchase roas',
    'website purchase roas',
    'return on ad spend',
    'retorno de inversión publicitaria',
  ],

  deliveryStatus: [
    'delivery status',
    'delivery',
    'status',
    'estado de entrega',
    'statut de diffusion',
  ],
};

/**
 * Resolve a raw CSV header to a standardized field name.
 * Uses fuzzy matching with normalization to handle:
 *   - Extra whitespace
 *   - Smart quotes ("" vs "")
 *   - Case variations
 *   - Partial matches (e.g., "Amount spent (USD)" → "spend")
 *
 * @param {string} rawHeader - The exact header from CSV
 * @param {object} aliases - COLUMN_ALIASES mapping
 * @returns {string|null} - Standardized field name, or null if no match
 */
export function resolveHeader(rawHeader, aliases = COLUMN_ALIASES) {
  if (!rawHeader) return null;

  // Normalize: lowercase, collapse whitespace, strip smart quotes
  const normalized = String(rawHeader)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')           // collapse multiple spaces
    .replace(/[""]/g, '')           // strip smart quotes
    .replace(/['']/g, "'");         // normalize apostrophes

  // Try exact match first (fastest path)
  for (const [field, variants] of Object.entries(aliases)) {
    if (variants.some((v) => normalized === v)) {
      return field;
    }
  }

  // Fuzzy fallback: substring match
  // Prioritize longer variants to avoid false positives
  // (e.g., "cost per result" before "cost")
  for (const [field, variants] of Object.entries(aliases)) {
    const sortedVariants = [...variants].sort((a, b) => b.length - a.length);
    for (const variant of sortedVariants) {
      if (normalized.includes(variant) || variant.includes(normalized)) {
        return field;
      }
    }
  }

  return null;
}

/**
 * Clean and parse a monetary value from CSV.
 * Handles:
 *   - Currency symbols ($, €, £, EGP, SAR, AED)
 *   - Thousands separators (1,234 or 1.234)
 *   - Decimal formats (1,234.56 or 1.234,56)
 *   - Empty/null/N/A values
 *   - Negative values
 *
 * @param {string|number} raw - Raw cell value
 * @returns {number} - Parsed float, or 0 if unparseable
 */
export function cleanMonetaryValue(raw) {
  if (raw === null || raw === undefined || raw === '' || raw === '-' || raw === 'N/A') {
    return 0;
  }

  let str = String(raw).trim();

  // Handle parentheses notation for negative (e.g., "(500)" = -500)
  const isNegative = str.startsWith('(') && str.endsWith(')');
  if (isNegative) {
    str = str.slice(1, -1);
  }

  // Strip currency symbols and letters (except decimal separators)
  // Keep only digits, dots, commas, and minus sign
  str = str.replace(/[^\d.,-]/g, '');

  // Detect decimal separator format:
  // "1,234.56" (US) vs "1.234,56" (EU)
  // Rule: if there's a comma after the last dot, it's EU format
  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');

  if (lastComma > lastDot) {
    // EU format: "1.234,56" → remove thousands sep, convert comma to dot
    str = str.replace(/\./g, '').replace(',', '.');
  } else {
    // US format: "1,234.56" → just remove commas
    str = str.replace(/,/g, '');
  }

  const parsed = parseFloat(str);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return isNegative ? -parsed : parsed;
}
