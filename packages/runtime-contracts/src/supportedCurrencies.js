// The supported ISO-4217 vocabulary used by both backend validation and
// explicit frontend monetary inputs. This is a list of accepted codes, not a
// source of a default denomination.
export const SUPPORTED_CURRENCY_CODES = Object.freeze([
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'CAD', 'AUD',
  'EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'MAD',
  'TRY', 'ZAR', 'BRL', 'MXN', 'RUB', 'CHF', 'SEK', 'NOK',
  'DKK', 'PLN', 'THB', 'MYR', 'SGD', 'HKD', 'NZD', 'KRW',
]);
