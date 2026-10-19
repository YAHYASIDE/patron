/** Arabic-locale formatting helpers. The API reports money in the base currency (USD). */

// Arabic words with Latin ("French") digits: the owner reads 1 250, not ١٬٢٥٠.
const LOCALE = 'ar-EG-u-nu-latn';

export function num(n: number | string | null | undefined, digits = 0): string {
  const v = typeof n === 'string' ? parseFloat(n) : n ?? 0;
  if (!isFinite(v as number)) return '—';
  return (v as number).toLocaleString(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function money(n: number | string | null | undefined, symbol = '$'): string {
  return `${num(n, 2)} ${symbol}`;
}

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', MRU: 'أوقية' };

/** An amount in its own currency (orders and payments carry the customer's currency). */
export function moneyIn(n: number | string | null | undefined, currency: string): string {
  const v = typeof n === 'string' ? parseFloat(n) : n ?? 0;
  // ouguiya amounts are whole (MRU rounds to 1): no ",00"
  const digits = currency === 'MRU' && Number.isInteger(v) ? 0 : 2;
  return `${num(v, digits)} ${SYMBOLS[currency] ?? currency}`;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(LOCALE, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  PAID: { label: 'مدفوع', cls: 'bg-ok/12 text-ok' },
  COMPLETED: { label: 'مكتمل', cls: 'bg-ok/12 text-ok' },
  PENDING: { label: 'قيد الانتظار', cls: 'bg-warn/12 text-warn' },
  AWAITING_PAYMENT: { label: 'بانتظار الدفع', cls: 'bg-warn/12 text-warn' },
  PENDING_PAYMENT: { label: 'بانتظار الدفع', cls: 'bg-warn/12 text-warn' },
  PARTIALLY_COMPLETED: { label: 'مكتمل جزئيًّا', cls: 'bg-teal/12 text-teal' },
  DELIVERED: { label: 'تم التسليم', cls: 'bg-ok/12 text-ok' },
  PROCESSING: { label: 'قيد المعالجة', cls: 'bg-teal/12 text-teal' },
  FAILED: { label: 'فشل', cls: 'bg-bad/12 text-bad' },
  CANCELLED: { label: 'ملغي', cls: 'bg-ink-400/15 text-muted' },
  REFUNDED: { label: 'مُسترجع', cls: 'bg-ink-400/15 text-muted' },
};

export function statusChip(status: string): { label: string; cls: string } {
  return ORDER_STATUS[status] ?? { label: status, cls: 'bg-ink-400/15 text-muted' };
}

/** Payment statuses, worded for a manual transfer (the common case for this shop). */
export const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  INITIATED: { label: 'لم يُرسل التحويل بعد', cls: 'bg-ink-400/15 text-muted' },
  AUTHORIZED: { label: 'بانتظار تأكيدك', cls: 'bg-warn/12 text-warn' },
  CAPTURED: { label: 'مدفوع', cls: 'bg-ok/12 text-ok' },
  FAILED: { label: 'مرفوض', cls: 'bg-bad/12 text-bad' },
  REFUNDED: { label: 'مُسترجع', cls: 'bg-ink-400/15 text-muted' },
};

export function paymentChip(status: string): { label: string; cls: string } {
  return PAYMENT_STATUS[status] ?? { label: status, cls: 'bg-ink-400/15 text-muted' };
}

export const GATEWAY_LABEL: Record<string, string> = {
  MANUAL: 'تحويل يدوي',
  WALLET: 'المحفظة',
  STRIPE: 'بطاقة بنكية',
};

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}
