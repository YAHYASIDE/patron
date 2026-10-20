/**
 * Order and item statuses as the customer reads them (Arabic keys, translated
 * with t() where shown). Shared by the orders list, the order page, the
 * receipt and the "earlier purchases" list so they always agree.
 */
export const ORDER_STATUS: Record<string, { t: string; c: string }> = {
  COMPLETED: { t: 'مكتمل', c: 'bg-ok/12 text-ok' },
  PAID: { t: 'مدفوع', c: 'bg-ok/12 text-ok' },
  PROCESSING: { t: 'قيد المعالجة', c: 'bg-teal/12 text-teal' },
  DELIVERED: { t: 'تم التسليم', c: 'bg-ok/12 text-ok' },
  PENDING_PAYMENT: { t: 'بانتظار الدفع', c: 'bg-warn/12 text-warn' },
  PENDING: { t: 'بانتظار', c: 'bg-ink-400/15 text-muted' },
  PARTIALLY_COMPLETED: { t: 'مكتمل جزئيًا', c: 'bg-teal/12 text-teal' },
  AWAITING_PAYMENT: { t: 'بانتظار الدفع', c: 'bg-warn/12 text-warn' },
  FAILED: { t: 'فشل', c: 'bg-bad/12 text-bad' },
  CANCELLED: { t: 'ملغي', c: 'bg-ink-400/15 text-muted' },
  REFUNDED: { t: 'مُسترجع', c: 'bg-ink-400/15 text-muted' },
};

export function chip(s: string) {
  return ORDER_STATUS[s] ?? { t: s, c: 'bg-ink-400/15 text-muted' };
}

/**
 * The status an order page shows: an unpaid order whose transfer the customer
 * already sent is "being checked", not "awaiting payment" — the badge must not
 * contradict the timeline under it.
 */
export function orderChip(order: { status: string; payments?: { gateway: string; status: string; createdAt: string }[] }) {
  if (order.status === 'PENDING_PAYMENT') {
    const latest = [...(order.payments ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (latest?.gateway === 'MANUAL' && latest.status === 'AUTHORIZED') {
      return { t: 'نراجع تحويلك', c: 'bg-teal/12 text-teal' };
    }
  }
  return chip(order.status);
}

/** The filter groups on the orders page. */
export const ORDER_GROUPS: { id: string; t: string; statuses: string[] }[] = [
  { id: 'pending', t: 'بانتظار الدفع', statuses: ['PENDING_PAYMENT'] },
  { id: 'progress', t: 'قيد التنفيذ', statuses: ['PAID', 'PROCESSING', 'PARTIALLY_COMPLETED'] },
  { id: 'done', t: 'مكتملة', statuses: ['COMPLETED'] },
  { id: 'ended', t: 'ملغاة', statuses: ['CANCELLED', 'FAILED', 'REFUNDED'] },
];

/** An item the customer has received (its code can be revealed, and reviewed). */
export function isDelivered(it: { status: string; results?: { hasValue: boolean }[] }) {
  return it.status === 'DELIVERED' || it.status === 'COMPLETED' || (it.results?.some((r) => r.hasValue) ?? false);
}
