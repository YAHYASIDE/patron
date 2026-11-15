'use client';

import Link from 'next/link';
import { shop } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money } from '@/lib/format';
import { useT, useLang } from '@/lib/i18n';
import type { Cursored, Order } from '@/lib/types';
import { ChevronIcon } from '@/components/icons';
import { chip } from './status';
import { day } from './when';

const SHOWN = 10;

/**
 * "مشترياتك السابقة": the owner wants a customer who has just bought to see
 * everything they bought before. Lists the orders placed before `before`
 * (the order on screen), newest first, each linking to its page. Renders
 * nothing for a first purchase or when the list cannot load.
 */
export default function PastPurchases({ excludeId, before }: { excludeId?: string; before?: string }) {
  const t = useT();
  const lang = useLang();
  const res = useFetch<Cursored<Order>>(() => shop.orders({ limit: SHOWN + 2 }), [excludeId]);

  const earlier = (res.data?.data ?? []).filter(
    (o) => o.id !== excludeId && (!before || o.createdAt <= before),
  );
  if (res.error || earlier.length === 0) return null;
  const more = earlier.length > SHOWN || !!res.data?.meta.hasMore;

  return (
    <section className="mt-8" aria-labelledby="past-purchases">
      <div className="flex items-end justify-between gap-3">
        <h2 id="past-purchases" className="text-lg font-extrabold">
          {t('مشترياتك السابقة')}
        </h2>
        <Link href="/orders" className="flex-none text-sm font-bold text-teal hover:underline">
          {t('كل طلباتي')}
        </Link>
      </div>
      <div className="mt-3 space-y-2.5">
        {earlier.slice(0, SHOWN).map((o) => {
          const c = chip(o.status);
          return (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="surface flex items-center gap-3 rounded-2xl p-3.5 shadow-card transition hover:shadow-float"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-bold" dir="ltr">
                    {o.orderNumber}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.c}`}>{t(c.t)}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm">
                  {o.items
                    .map(
                      (it) =>
                        `${lang === 'ar' ? it.productNameAr || it.productNameEn : it.productNameEn || it.productNameAr} ×${it.quantity}`,
                    )
                    .join(lang === 'ar' ? '، ' : ', ')}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span>{day(o.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span className="tnum font-bold text-[rgb(var(--text))]">{money(o.total, o.currency)}</span>
                </div>
              </div>
              <ChevronIcon size={16} className="flex-none text-muted ltr:rotate-180" />
            </Link>
          );
        })}
      </div>
      {more && (
        <Link
          href="/orders"
          className="mt-3 block rounded-xl border border-[rgb(var(--line))] py-2.5 text-center text-sm font-bold text-muted transition hover:text-[rgb(var(--text))]"
        >
          {t('عرض كل الطلبات')}
        </Link>
      )}
    </section>
  );
}
