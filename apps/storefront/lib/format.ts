/** Arabic-locale formatting helpers for the storefront. */

// Arabic words with Latin ("French") digits, the way customers here write numbers.
export const LOCALE = 'ar-EG-u-nu-latn';

export function num(n: number | string | null | undefined, digits = 0): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (!isFinite(v as number)) return '—';
  return (v as number).toLocaleString(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Money with a currency symbol/code. Defaults to the API base ($). */
export function money(
  n: number | string | null | undefined,
  currency = 'USD',
  digits = 2,
): string {
  const sym = SYMBOLS[currency] ?? currency;
  // ouguiya prices are whole numbers (MRU rounds to 1): no ",00"
  const whole = currency === 'MRU' && Number.isInteger(typeof n === 'string' ? parseFloat(n) : n);
  return `${num(n, whole ? 0 : digits)} ${sym}`;
}

const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  LYD: 'د.ل',
  SAR: 'ر.س',
  AED: 'د.إ',
  EGP: 'ج.م',
  MRU: 'أوقية',
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code;
}
