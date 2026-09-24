import { SUPPORTED_CURRENCY_CODES } from '@marcom/runtime-contracts';

// A missing or malformed unit cannot be repaired by the formatter's USD default.
export const isKnownCurrency = (currency) =>
  typeof currency === 'string' && SUPPORTED_CURRENCY_CODES.includes(currency);

export const isKnownMinorAmount = (amount) =>
  typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0;
