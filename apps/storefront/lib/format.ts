/** Arabic-locale formatting helpers for the storefront. */

export function num(n: number | string | null | undefined, digits = 0): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (!isFinite(v as number)) return '—';
  return (v as number).toLocaleString('ar-EG', {
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
  return `${num(n, digits)} ${sym}`;
}

const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  LYD: 'د.ل',
  SAR: 'ر.س',
  AED: 'د.إ',
  EGP: 'ج.م',
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code;
}
