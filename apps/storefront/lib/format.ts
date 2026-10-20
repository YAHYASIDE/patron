/** Formatting helpers for the storefront, in the page's language (Latin digits always). */

import { getLang, localeOf, translate } from './i18n';

/** Arabic words with Latin ("French") digits, or the French / English locale. */
export const locale = () => localeOf(getLang());

export function num(n: number | string | null | undefined, digits = 0): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (!isFinite(v as number)) return '—';
  return (v as number).toLocaleString(locale(), {
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
  const sym = currencySymbol(currency);
  // ouguiya, franc and dinar prices are whole numbers: no ",00"
  const whole = WHOLE.has(currency) && Number.isInteger(typeof n === 'string' ? parseFloat(n) : n);
  return `${num(n, whole ? 0 : digits)} ${sym}`;
}

const WHOLE = new Set(['MRU', 'XOF', 'DZD']);

const SYMBOLS: Record<string, string> = {
  XOF: 'FCFA',
  DZD: 'د.ج',
  USD: '$',
  EUR: '€',
  LYD: 'د.ل',
  SAR: 'ر.س',
  AED: 'د.إ',
  EGP: 'ج.م',
  MRU: 'أوقية',
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ? translate(getLang(), SYMBOLS[code]) : code;
}
