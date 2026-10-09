/** Arabic-locale formatting helpers. The API reports money in the base currency (USD). */

export function num(n: number | string | null | undefined, digits = 0): string {
  const v = typeof n === 'string' ? parseFloat(n) : n ?? 0;
  if (!isFinite(v as number)) return '—';
  return (v as number).toLocaleString('ar-EG', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function money(n: number | string | null | undefined, symbol = '$'): string {
  return `${num(n, 2)} ${symbol}`;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('ar-EG', {
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
  PROCESSING: { label: 'قيد المعالجة', cls: 'bg-teal/12 text-teal' },
  FAILED: { label: 'فشل', cls: 'bg-bad/12 text-bad' },
  CANCELLED: { label: 'ملغي', cls: 'bg-ink-400/15 text-muted' },
  REFUNDED: { label: 'مُسترجع', cls: 'bg-ink-400/15 text-muted' },
};

export function statusChip(status: string): { label: string; cls: string } {
  return ORDER_STATUS[status] ?? { label: status, cls: 'bg-ink-400/15 text-muted' };
}
