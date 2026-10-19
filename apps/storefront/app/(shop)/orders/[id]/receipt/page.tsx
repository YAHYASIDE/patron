'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, shop } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useMe } from '@/lib/session';
import { money } from '@/lib/format';
import { gatewayLabel } from '@/lib/payments';
import type { Order } from '@/lib/types';
import { useT, useLang } from '@/lib/i18n';
import { ChevronIcon } from '@/components/icons';
import { chip } from '@/components/my/status';
import { dayTime } from '@/components/my/when';

// The order as the API returns it, with the frozen money lines the shared type leaves out.
type ReceiptOrder = Order & { subtotal?: string; discount?: string; fees?: string; taxAmount?: string };

/* Paper: only the receipt prints (no header, footer, WhatsApp button or buttons), black on white. */
const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  html, body { background: #fff !important; color: #000 !important; }
  body > div > :not(main), .no-print, a[href^="https://wa.me"] { display: none !important; }
  main { padding: 0 !important; }
  .receipt { box-shadow: none !important; border: 0 !important; padding: 0 !important; max-width: none !important; }
  .receipt * { color: #000 !important; }
}`;

/** A printable receipt for an order (#25). */
export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  useEffect(() => {
    if (!isAuthed()) router.replace(`/login?next=/orders/${id}/receipt`);
  }, [router, id]);

  const res = useFetch<ReceiptOrder>(() => shop.order(id), [id]);
  const { me } = useMe();
  const order = res.data;

  if (res.loading && !order)
    return <div className="mx-auto max-w-page px-4 py-16 text-center text-muted">{t('جارٍ التحميل…')}</div>;
  if (res.error || !order)
    return (
      <div className="mx-auto max-w-page px-4 py-20 text-center">
        <p className="text-muted">{res.error ?? t('الطلب غير موجود.')}</p>
        <Link href="/orders" className="mt-4 inline-block font-bold text-teal hover:underline">
          {t('طلباتي')}
        </Link>
      </div>
    );

  const cur = order.currency;
  const paid = [...(order.payments ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .find((p) => ['CAPTURED', 'AUTHORIZED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status));
  const num = (v?: string) => (v === undefined ? 0 : parseFloat(v) || 0);
  const lines: { label: string; value: string; strong?: boolean }[] = [];
  if (order.subtotal !== undefined) lines.push({ label: t('المجموع'), value: money(order.subtotal, cur) });
  if (num(order.discount) > 0) lines.push({ label: t('الخصم'), value: `- ${money(order.discount, cur)}` });
  if (num(order.fees) > 0) lines.push({ label: t('رسوم'), value: money(order.fees, cur) });
  if (num(order.taxAmount) > 0) lines.push({ label: t('ضريبة'), value: money(order.taxAmount, cur) });
  lines.push({ label: t('الإجمالي'), value: money(order.total, cur), strong: true });

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <style>{PRINT_CSS}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[720px] flex-wrap items-center justify-between gap-3">
        <Link href={`/orders/${order.id}`} className="flex items-center gap-1 text-sm font-bold text-muted hover:text-[rgb(var(--text))]">
          <ChevronIcon size={16} className="rotate-180 ltr:rotate-0" />
          {t('العودة إلى الطلب')}
        </Link>
        <button onClick={() => window.print()} className="btn-brand rounded-xl px-5 py-2.5 text-sm font-bold">
          {t('طباعة الإيصال')}
        </button>
      </div>

      <article className="receipt surface mx-auto max-w-[720px] rounded-2xl p-5 shadow-card sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[rgb(var(--line))] pb-5">
          <div>
            <div className="text-xl font-extrabold">
              {t('باترون')}
              <span className="text-gold">.</span>
            </div>
            <div className="text-sm text-muted">{t('إيصال طلب')}</div>
          </div>
          <div className="text-end text-sm">
            <div className="font-bold" dir="ltr">
              {order.orderNumber}
            </div>
            <div className="text-muted">{dayTime(order.createdAt)}</div>
            <div className="mt-1 font-bold">{t(chip(order.status).t)}</div>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-2 border-b border-[rgb(var(--line))] py-4 text-sm sm:grid-cols-2">
          {me && (
            <div>
              <dt className="text-muted">{t('العميل')}</dt>
              <dd className="font-bold">
                {me.fullName}
                {me.phone && (
                  <span className="block font-normal text-muted">
                    <bdi dir="ltr">{me.phone}</bdi>
                  </span>
                )}
              </dd>
            </div>
          )}
          {paid && (
            <div>
              <dt className="text-muted">{t('وسيلة الدفع')}</dt>
              <dd className="font-bold">{gatewayLabel(paid.gateway, t)}</dd>
            </div>
          )}
          {order.paidAt && (
            <div>
              <dt className="text-muted">{t('تاريخ الدفع')}</dt>
              <dd className="font-bold">{dayTime(order.paidAt)}</dd>
            </div>
          )}
        </dl>

        <table className="mt-4 w-full table-fixed text-sm">
          <thead>
            <tr className="text-muted">
              <th className="pb-2 text-start font-semibold">{t('المنتج')}</th>
              <th className="w-12 pb-2 text-center font-semibold">{t('الكمية')}</th>
              <th className="w-28 pb-2 text-end font-semibold">{t('المبلغ')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--line))]">
            {order.items.map((it) => (
              <tr key={it.id} className="align-top">
                <td className="break-words py-2.5 pe-2">
                  <div className="font-bold">
                    {lang === 'ar' ? it.productNameAr || it.productNameEn : it.productNameEn || it.productNameAr}
                  </div>
                  {it.quantity > 1 && (
                    <div className="text-xs text-muted tnum">
                      {t('سعر الوحدة: {amount}', { amount: money(it.unitPrice, cur) })}
                    </div>
                  )}
                </td>
                <td className="tnum py-2.5 text-center">{it.quantity}</td>
                <td className="tnum py-2.5 text-end font-semibold">{money(it.lineTotal, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ms-auto mt-4 max-w-[300px] space-y-1.5 border-t border-[rgb(var(--line))] pt-4 text-sm">
          {lines.map((l) => (
            <div key={l.label} className="flex items-center justify-between gap-4">
              <dt className={l.strong ? 'font-bold' : 'text-muted'}>{l.label}</dt>
              <dd className={`tnum ${l.strong ? 'text-lg font-extrabold' : 'font-semibold'}`}>{l.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 text-center text-xs text-muted">{t('شكرًا لشرائك من باترون.')}</p>
      </article>
    </div>
  );
}
